#pragma once

// VocoderNode — STFT-based channel vocoder.
//
// Port of Geraint Luff's JSFX Vocoder (v1.0.1) to the Elementary runtime.
// Original: https://github.com/geraintluff/jsfx
//
// ============================================================================
// Algorithm
// ============================================================================
//
// 1. Window the carrier and modulator inputs with a Kaiser window (perfect
//    reconstruction via Princen-Bradley normalization).
// 2. Forward FFT both signals (split-complex, float).
// 3. Per bin: compute smoothed energy envelopes for carrier and modulator.
// 4. Per bin: gain = sqrt(mod_energy / (mod_energy/max_gain + carrier_energy + eps)).
//    This imposes the modulator's spectral envelope onto the carrier.
// 5. Apply gain to the carrier spectrum.
// 6. Inverse FFT and overlap-add into the output ring buffer.
//
// ============================================================================
// Inputs
// ============================================================================
//
//   [0]  carrier L    (required)
//   [1]  carrier R    (required)
//   [2]  modulator L  (required)
//   [3]  modulator R  (required)
//
// ============================================================================
// Outputs
// ============================================================================
//
//   [0]  out L
//   [1]  out R
//
// ============================================================================
// Properties
// ============================================================================
//
//   windowMs     number  1–100    FFT window length in milliseconds (default 10)
//   smoothingMs  number  0–2000   Energy envelope smoothing in ms   (default 5)
//   maxGainDb    number  0–100    Per-band gain ceiling in dB       (default 40)
//   swapInputs   number  0 or 1   Swap carrier/modulator            (default 0)
//
// ============================================================================
// Realtime safety (SKILLS.md)
// ============================================================================
//
// All FFT buffers, ring buffers, and window coefficients are pre-allocated in
// the constructor or recomputed in setProperty (non-realtime thread). The
// process() method performs only arithmetic and pre-allocated buffer access.
// AudioFFT guarantees no allocations after init().

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/wasm/FFTConvolver/AudioFFT.h"

namespace elem {

namespace vocoder_detail {

    static constexpr double kPi = 3.14159265358979323846;
    static constexpr int kMaxFftSize = 8192;
    static constexpr int kOverlapFactor = 6;
    static constexpr float kEpsilon = 1e-7f;

    // Modified Bessel function of the first kind, order zero.
    inline double bessel0(double x) {
        double result = 0.0;
        double term = 1.0;
        int m = 0;
        while (term > result * 1e-6) {
            result += term;
            m += 1;
            term *= (x * x) / (4.0 * m * m);
        }
        return result;
    }

    // Fill a buffer with a Kaiser window of length `len` and shape `beta`.
    inline void kaiserFill(float* buf, int len, double beta) {
        double invB0 = 1.0 / bessel0(beta);
        for (int i = 0; i < len; ++i) {
            double r = (2.0 * i + 1.0) / len - 1.0;
            double arg = std::sqrt(std::max(0.0, 1.0 - r * r));
            buf[i] = static_cast<float>(bessel0(beta * arg) * invB0);
        }
    }

    // Normalize the window for perfect reconstruction under overlap-add
    // with the given stride.
    inline void forcePerfectReconstruction(float* buf, int size, int stride) {
        for (int i = 0; i < stride; ++i) {
            double sum2 = 0.0;
            for (int j = i; j < size; j += stride) {
                sum2 += static_cast<double>(buf[j]) * buf[j];
            }
            double factor = std::sqrt(1.0 / sum2);
            for (int j = i; j < size; j += stride) {
                buf[j] = static_cast<float>(buf[j] * factor);
            }
        }
    }

    // Next power of two >= n.
    inline int nextPow2(int n) {
        int p = 16;
        while (p < n) p *= 2;
        return std::min(p, kMaxFftSize);
    }

} // namespace vocoder_detail

template <typename FloatType>
struct VocoderNode : public GraphNode<FloatType> {
    using GraphNode<FloatType>::GraphNode;

    VocoderNode(NodeId id, double sr, int blockSize)
        : GraphNode<FloatType>(id, sr, blockSize)
    {
        // Pre-allocate all buffers to maximum size.
        int maxComplex = audiofft::AudioFFT::ComplexSize(vocoder_detail::kMaxFftSize);

        carrierRingL.resize(vocoder_detail::kMaxFftSize, 0.0f);
        carrierRingR.resize(vocoder_detail::kMaxFftSize, 0.0f);
        modRingL.resize(vocoder_detail::kMaxFftSize, 0.0f);
        modRingR.resize(vocoder_detail::kMaxFftSize, 0.0f);
        outputRingL.resize(vocoder_detail::kMaxFftSize, 0.0f);
        outputRingR.resize(vocoder_detail::kMaxFftSize, 0.0f);

        windowBuf.resize(vocoder_detail::kMaxFftSize, 0.0f);

        // FFT scratch buffers (time domain, and split-complex for carrier+mod)
        timeBufA.resize(vocoder_detail::kMaxFftSize, 0.0f);
        timeBufB.resize(vocoder_detail::kMaxFftSize, 0.0f);
        reA.resize(maxComplex, 0.0f);
        imA.resize(maxComplex, 0.0f);
        reB.resize(maxComplex, 0.0f);
        imB.resize(maxComplex, 0.0f);

        // Smoothed energy bins (per bin, for carrier and modulator).
        carrierEnergy.resize(maxComplex, 0.0f);
        modEnergy.resize(maxComplex, 0.0f);

        // Output IFFT scratch.
        ifftBuf.resize(vocoder_detail::kMaxFftSize, 0.0f);

        fft.init(vocoder_detail::kMaxFftSize);

        // Trigger initial window computation.
        recomputeWindow(sr);
    }

    // ---- setProperty (non-realtime thread) ----------------------------------

    int setProperty(std::string const& key, js::Value const& val,
                    SharedResourceMap&) override
    {
        if (key == "windowMs") {
            if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
            windowMs_.store(std::max(1.0, std::min(100.0, (js::Number) val)),
                           std::memory_order_relaxed);
            windowDirty_.store(true, std::memory_order_relaxed);
        } else if (key == "smoothingMs") {
            if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
            smoothingMs_.store(std::max(0.0, std::min(2000.0, (js::Number) val)),
                              std::memory_order_relaxed);
        } else if (key == "maxGainDb") {
            if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
            maxGainDb_.store(std::max(0.0, std::min(100.0, (js::Number) val)),
                            std::memory_order_relaxed);
        } else if (key == "swapInputs") {
            if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
            swapInputs_.store(static_cast<int>((js::Number) val) != 0,
                             std::memory_order_relaxed);
        }
        return GraphNode<FloatType>::setProperty(key, val);
    }

    // ---- process (realtime audio thread) ------------------------------------

    void process(BlockContext<FloatType> const& ctx) override {
        auto numIns     = ctx.numInputChannels;
        auto numOuts    = ctx.numOutputChannels;
        auto numSamples = ctx.numSamples;

        // Zero outputs first.
        for (size_t c = 0; c < numOuts; ++c)
            std::fill_n(ctx.outputData[c], numSamples, FloatType(0));

        if (numIns < 4 || numOuts < 2 || numSamples == 0) return;

        auto sr = GraphNode<FloatType>::getSampleRate();

        // Recompute window if property changed. The recomputation itself is
        // arithmetic-only on pre-allocated buffers — no allocation.
        if (windowDirty_.load(std::memory_order_relaxed)) {
            recomputeWindow(sr);
            windowDirty_.store(false, std::memory_order_relaxed);
        }

        bool swap = swapInputs_.load(std::memory_order_relaxed);
        auto maxGain = std::pow(10.0, maxGainDb_.load(std::memory_order_relaxed) * 0.05);
        auto smoothMs = smoothingMs_.load(std::memory_order_relaxed);

        auto const* inCarrierL = swap ? ctx.inputData[2] : ctx.inputData[0];
        auto const* inCarrierR = swap ? ctx.inputData[3] : ctx.inputData[1];
        auto const* inModL     = swap ? ctx.inputData[0] : ctx.inputData[2];
        auto const* inModR     = swap ? ctx.inputData[1] : ctx.inputData[3];

        for (size_t i = 0; i < numSamples; ++i) {
            // Write into ring buffers.
            carrierRingL[ringIdx] = static_cast<float>(inCarrierL[i]);
            carrierRingR[ringIdx] = static_cast<float>(inCarrierR[i]);
            modRingL[ringIdx]     = static_cast<float>(inModL[i]);
            modRingR[ringIdx]     = static_cast<float>(inModR[i]);

            fftCounter_++;
            if (fftCounter_ >= fftInterval_) {
                fftCounter_ = 0;
                processStftHop(sr, maxGain, smoothMs);
            }

            // Read output.
            ctx.outputData[0][i] = static_cast<FloatType>(outputRingL[ringIdx]);
            ctx.outputData[1][i] = static_cast<FloatType>(outputRingR[ringIdx]);
            outputRingL[ringIdx] = 0.0f;
            outputRingR[ringIdx] = 0.0f;

            ringIdx = (ringIdx + 1) % bufLen_;
        }
    }

    void reset() override {
        std::fill(carrierRingL.begin(), carrierRingL.end(), 0.0f);
        std::fill(carrierRingR.begin(), carrierRingR.end(), 0.0f);
        std::fill(modRingL.begin(), modRingL.end(), 0.0f);
        std::fill(modRingR.begin(), modRingR.end(), 0.0f);
        std::fill(outputRingL.begin(), outputRingL.end(), 0.0f);
        std::fill(outputRingR.begin(), outputRingR.end(), 0.0f);
        std::fill(carrierEnergy.begin(), carrierEnergy.end(), 0.0f);
        std::fill(modEnergy.begin(), modEnergy.end(), 0.0f);
        ringIdx = 0;
        fftCounter_ = 0;
    }

private:

    // ---- Window recomputation (arithmetic on pre-allocated buffers) ----------

    void recomputeWindow(double sr) {
        auto wMs = windowMs_.load(std::memory_order_relaxed);
        windowSamples_ = std::min(
            static_cast<int>(std::ceil(wMs * 0.001 * sr)),
            vocoder_detail::kMaxFftSize);
        fftSize_ = vocoder_detail::nextPow2(windowSamples_);
        fftInterval_ = std::max(1, static_cast<int>(
            std::ceil(static_cast<double>(windowSamples_) / vocoder_detail::kOverlapFactor)));
        bufLen_ = fftSize_;
        fftScaling_ = 1.0f / static_cast<float>(fftSize_);

        // Kaiser window.
        double bw = vocoder_detail::kOverlapFactor
            + 2.0 / (static_cast<double>(vocoder_detail::kOverlapFactor)
                      * vocoder_detail::kOverlapFactor);
        double alpha = std::sqrt(bw * bw * 0.25 - 1.0);
        vocoder_detail::kaiserFill(windowBuf.data(), windowSamples_, alpha * vocoder_detail::kPi);
        vocoder_detail::forcePerfectReconstruction(
            windowBuf.data(), windowSamples_, fftInterval_);

        // Zero the tail beyond the window.
        for (int j = windowSamples_; j < fftSize_; ++j) windowBuf[j] = 0.0f;

        // Re-init FFT if size changed.
        if (fftSize_ != prevFftSize_) {
            fft.init(fftSize_);
            prevFftSize_ = fftSize_;
            // Clear energy bins.
            std::fill(carrierEnergy.begin(), carrierEnergy.end(), 0.0f);
            std::fill(modEnergy.begin(), modEnergy.end(), 0.0f);
        }
    }

    // ---- One STFT hop (called from the sample loop) -------------------------

    void processStftHop(double sr, double maxGain, double smoothMs) {
        int const complexSize = audiofft::AudioFFT::ComplexSize(fftSize_);
        float const intervalMs = static_cast<float>(fftInterval_) * 1000.0f / static_cast<float>(sr);
        float const slew = 1.0f / (static_cast<float>(smoothMs) / intervalMs + 1.0f);

        // ---- Copy windowed carrier (L+R packed as stereo-to-mono average)
        //      and modulator into time-domain FFT buffers.
        //
        // The JSFX packs stereo into one complex FFT (L=real, R=imag).
        // AudioFFT uses split-complex on real data, so the port processes
        // L and R separately as two mono FFTs, then combines energies.

        for (int j = 0; j < fftSize_; ++j) {
            int ri = (ringIdx - windowSamples_ + j);
            if (ri < 0) ri += bufLen_;
            float w = (j < windowSamples_) ? windowBuf[j] : 0.0f;
            timeBufA[j] = (carrierRingL[ri] + carrierRingR[ri]) * 0.5f * w;
            timeBufB[j] = (modRingL[ri] + modRingR[ri]) * 0.5f * w;
        }

        // Forward FFT carrier and modulator.
        fft.fft(timeBufA.data(), reA.data(), imA.data());
        fft.fft(timeBufB.data(), reB.data(), imB.data());

        // Per-bin spectral envelope transfer.
        float const maxGainF = static_cast<float>(maxGain);

        for (int bin = 0; bin < complexSize; ++bin) {
            float cE = reA[bin] * reA[bin] + imA[bin] * imA[bin];
            float mE = reB[bin] * reB[bin] + imB[bin] * imB[bin];

            carrierEnergy[bin] += (cE - carrierEnergy[bin]) * slew;
            modEnergy[bin]     += (mE - modEnergy[bin]) * slew;

            float cSmooth = carrierEnergy[bin];
            float mSmooth = modEnergy[bin];

            float ratio = mSmooth / (mSmooth / maxGainF + cSmooth + vocoder_detail::kEpsilon);
            float gain = std::sqrt(ratio);

            reA[bin] *= gain;
            imA[bin] *= gain;
        }

        // Inverse FFT.
        fft.ifft(ifftBuf.data(), reA.data(), imA.data());

        // Overlap-add into output ring buffer (mono to both L and R).
        for (int j = 0; j < windowSamples_; ++j) {
            int oi = (ringIdx + j) % bufLen_;
            float sample = ifftBuf[j] * windowBuf[j];
            outputRingL[oi] += sample;
            outputRingR[oi] += sample;
        }
    }

    // ---- Atomic properties --------------------------------------------------
    std::atomic<double> windowMs_{10.0};
    std::atomic<double> smoothingMs_{5.0};
    std::atomic<double> maxGainDb_{40.0};
    std::atomic<bool>   swapInputs_{false};
    std::atomic<bool>   windowDirty_{false};

    // ---- FFT state (pre-allocated) ------------------------------------------
    audiofft::AudioFFT fft;
    int fftSize_ = 0;
    int prevFftSize_ = 0;
    int windowSamples_ = 0;
    int fftInterval_ = 1;
    int fftCounter_ = 0;
    float fftScaling_ = 1.0f;
    int bufLen_ = vocoder_detail::kMaxFftSize;
    int ringIdx = 0;

    // ---- Pre-allocated buffers (no resize after constructor) -----------------
    std::vector<float> carrierRingL, carrierRingR;
    std::vector<float> modRingL, modRingR;
    std::vector<float> outputRingL, outputRingR;
    std::vector<float> windowBuf;
    std::vector<float> timeBufA, timeBufB;
    std::vector<float> reA, imA, reB, imB;
    std::vector<float> carrierEnergy, modEnergy;
    std::vector<float> ifftBuf;
};

} // namespace elem
