#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

#include <elem/GraphNode.h>
#include <elem/SingleWriterSingleReaderQueue.h>

#include "../third_party/framelib/FrameLib_Dependencies/Interpolation.hpp"
#include "../third_party/framelib/FrameLib_Dependencies/SpectralFunctions.hpp"
#include "../third_party/framelib/FrameLib_Dependencies/SpectralProcessor.hpp"
#include "../third_party/framelib/FrameLib_Dependencies/tlsf/tlsf.h"

namespace elem
{
    template <typename T>
    struct FrameLibSplitBuffer {
        using Split = typename FFTTypes<T>::Split;

        explicit FrameLibSplitBuffer(size_t size = 0)
            : real(size, T(0))
            , imag(size, T(0))
        {}

        Split split()
        {
            return Split { real.data(), imag.data() };
        }

        void clear()
        {
            std::fill(real.begin(), real.end(), T(0));
            std::fill(imag.begin(), imag.end(), T(0));
        }

        std::vector<T> real;
        std::vector<T> imag;
    };

    template <typename T>
    struct FrameLibMagnitudeMovingAverage {
        explicit FrameLibMagnitudeMovingAverage(size_t size = 0)
            : average(size, T(0))
        {}

        void reset()
        {
            std::fill(average.begin(), average.end(), T(0));
            initialized = false;
        }

        T process(size_t bin, T input, T alpha)
        {
            if (!initialized) {
                average[bin] = input;
                return input;
            }

            average[bin] = linear_interp<T>()(alpha, average[bin], input);
            return average[bin];
        }

        void finishFrame()
        {
            initialized = true;
        }

        std::vector<T> average;
        bool initialized{false};
    };

    struct FrameLibTlsfAllocator {
        struct State {
            explicit State(size_t bytes)
                : storage(std::malloc(bytes))
                , size(bytes)
                , tlsf(storage != nullptr ? tlsf_create_with_pool(storage, bytes) : nullptr)
            {}

            ~State()
            {
                if (tlsf != nullptr) {
                    tlsf_destroy(tlsf);
                }
                std::free(storage);
            }

            void* storage{nullptr};
            size_t size{0};
            tlsf_t tlsf{nullptr};
        };

        explicit FrameLibTlsfAllocator(size_t bytes = defaultPoolBytes)
            : state(std::make_shared<State>(std::max(bytes, defaultPoolBytes)))
        {}

        template <typename T>
        T* allocate(size_t count)
        {
            auto* ptr = state && state->tlsf ? tlsf_memalign(state->tlsf, alignof(T), count * sizeof(T)) : nullptr;
            return static_cast<T*>(ptr);
        }

        template <typename T>
        void deallocate(T*& ptr)
        {
            if (ptr != nullptr && state && state->tlsf) {
                tlsf_free(state->tlsf, ptr);
                ptr = nullptr;
            }
        }

        static constexpr size_t defaultPoolBytes = 1024 * 1024;
        std::shared_ptr<State> state;
    };

    template <typename T>
    struct FrameLibSpectralConvolver {
        using Split = typename FFTTypes<T>::Split;

        FrameLibSpectralConvolver(size_t partitionSize, std::vector<T> const& ir)
            : partSize(std::max<size_t>(16, partitionSize))
            , fftSize(partSize * 2)
            , fftLog2(spectral_processor<T, FrameLibTlsfAllocator>::calc_fft_size_log2(fftSize))
            , spectrumSize(fftSize >> 1)
            , allocator(requiredPoolBytes(fftSize))
            , processor(allocator, fftSize)
            , inputBlock(fftSize, T(0))
            , fftOutput(fftSize, T(0))
            , overlap(partSize, T(0))
            , blockOutput(partSize, T(0))
            , currentInput(spectrumSize)
            , accum(spectrumSize)
            , processedIr(spectrumSize)
            , multiplyTemp(spectrumSize)
            , magnitudeAverage(spectrumSize + 1)
        {
            auto const safeIrSize = std::max<size_t>(1, ir.size());
            partitionCount = (safeIrSize + partSize - 1) / partSize;
            irSpectra.reserve(partitionCount);
            inputSpectra.reserve(partitionCount);

            for (size_t i = 0; i < partitionCount; ++i) {
                irSpectra.emplace_back(spectrumSize);
                inputSpectra.emplace_back(spectrumSize);
            }

            std::vector<T> frame(fftSize, T(0));
            for (size_t partition = 0; partition < partitionCount; ++partition) {
                std::fill(frame.begin(), frame.end(), T(0));
                auto const offset = partition * partSize;
                auto const copyCount = offset < ir.size() ? std::min(partSize, ir.size() - offset) : size_t(0);
                if (copyCount > 0) {
                    std::copy_n(ir.data() + offset, copyCount, frame.data());
                }

                auto split = irSpectra[partition].split();
                processor.rfft(split, frame.data(), fftSize, fftLog2);
            }
        }

        void reset()
        {
            magnitudeAverage.reset();
        }

        void process(T const* input, T const* tiltInput, T const* blurInput, T* output, size_t count, T gain)
        {
            for (size_t i = 0; i < count; ++i) {
                output[i] = blockOutput[outputRead++];

                auto const sample = input[i];
                inputBlock[inputFill++] = std::isfinite(static_cast<double>(sample)) ? sample : T(0);

                if (inputFill == partSize) {
                    auto const tilt = readControl(tiltInput, i, T(0));
                    auto const blur = readControl(blurInput, i, T(0));
                    processPartition(gain, tilt, blur);
                }
            }
        }

    private:
        static T readControl(T const* signal, size_t index, T fallback)
        {
            if (signal == nullptr) {
                return fallback;
            }

            auto const value = signal[index];
            return std::isfinite(static_cast<double>(value)) ? value : fallback;
        }

        void processPartition(T gain, T tiltDb, T blurAmount)
        {
            blurAmount = std::max(T(0), std::min(T(0.999), blurAmount));
            std::fill(inputBlock.begin() + static_cast<std::ptrdiff_t>(partSize), inputBlock.end(), T(0));

            auto currentSplit = currentInput.split();
            processor.rfft(currentSplit, inputBlock.data(), fftSize, fftLog2);

            std::copy(currentInput.real.begin(), currentInput.real.end(), inputSpectra[writeIndex].real.begin());
            std::copy(currentInput.imag.begin(), currentInput.imag.end(), inputSpectra[writeIndex].imag.begin());

            accum.clear();
            auto accumSplit = accum.split();
            auto tempSplit = multiplyTemp.split();
            auto const scale = T(0.25) / static_cast<T>(fftSize);
            auto const blurAlpha = movingAverageAlpha(blurAmount);
            // magnitudeAverage.reset() removed here to allow temporal persistence
            // magnitudeAverage should only be reset when parameters change significantly or on start

            for (size_t partition = 0; partition < partitionCount; ++partition) {
                auto const inputIndex = (writeIndex + partitionCount - partition) % partitionCount;
                auto inputSplit = inputSpectra[inputIndex].split();
                auto irSplit = irSpectra[partition].split();
                auto processedIrSplit = processedIr.split();
                processIrSpectrum(processedIrSplit, irSplit, gain, tiltDb, blurAlpha, partition);
                ir_convolve_real(&tempSplit, &inputSplit, &processedIrSplit, fftSize, scale);

                for (size_t bin = 0; bin < spectrumSize; ++bin) {
                    accum.real[bin] += multiplyTemp.real[bin];
                    accum.imag[bin] += multiplyTemp.imag[bin];
                }
            }

            processor.rifft(fftOutput.data(), accumSplit, fftLog2);

            for (size_t i = 0; i < partSize; ++i) {
                auto const wet = fftOutput[i] + overlap[i];
                blockOutput[i] = std::isfinite(static_cast<double>(wet)) ? wet : T(0);
                overlap[i] = fftOutput[i + partSize];
            }

            std::fill(inputBlock.begin(), inputBlock.begin() + static_cast<std::ptrdiff_t>(partSize), T(0));
            inputFill = 0;
            outputRead = 0;
            writeIndex = (writeIndex + 1) % partitionCount;
        }

        void processIrSpectrum(Split& output, Split const& input, T gain, T tiltDb, T blurAlpha, size_t partition)
        {
            // Bin 0 in FrameLib's real FFT format contains DC in the real part and Nyquist in the imaginary part.
            // We pass them through with the overall gain applied, but without tilt or blurring.
            output.realp[0] = input.realp[0] * gain;
            output.imagp[0] = input.imagp[0] * gain;

            for (size_t bin = 1; bin < spectrumSize; ++bin) {
                auto const real = static_cast<double>(input.realp[bin]);
                auto const imag = static_cast<double>(input.imagp[bin]);
                auto const magnitude = std::sqrt(real * real + imag * imag);
                auto const smoothedMagnitude = static_cast<double>(magnitudeAverage.process(bin, static_cast<T>(magnitude), blurAlpha));

                auto const binGain = spectralBinGain(bin, spectrumSize, static_cast<double>(tiltDb)) * static_cast<double>(gain);
                auto const scaledMagnitude = smoothedMagnitude * binGain;

                auto const phaseScale = magnitude > 1.0e-20 ? scaledMagnitude / magnitude : 0.0;
                output.realp[bin] = static_cast<T>(real * phaseScale);
                output.imagp[bin] = static_cast<T>(imag * phaseScale);
            }

            magnitudeAverage.finishFrame();
        }

        static double randomPhase(size_t partition, size_t bin)
        {
            auto x = static_cast<uint64_t>(partition + 1) * 0x9E3779B97F4A7C15ULL;
            x ^= static_cast<uint64_t>(bin + 1) * 0xBF58476D1CE4E5B9ULL;
            x ^= x >> 30;
            x *= 0xBF58476D1CE4E5B9ULL;
            x ^= x >> 27;
            x *= 0x94D049BB133111EBULL;
            x ^= x >> 31;
            auto const unit = static_cast<double>(x >> 11) * (1.0 / 9007199254740992.0);
            return unit * 6.28318530717958647692;
        }

        static T movingAverageAlpha(T blurAmount)
        {
            auto const clamped = std::max(T(0), std::min(T(0.999), blurAmount));
            return T(1) - clamped;
        }

        static double dbToGain(double db)
        {
            return std::pow(10.0, db / 20.0);
        }

        static double spectralBinGain(size_t bin, size_t maxBin, double tiltDb)
        {
            if (std::abs(tiltDb) < 1.0e-12 || maxBin <= 1) {
                return 1.0;
            }

            // Note: bin 0 (DC/Nyquist) is handled outside this function in processIrSpectrum
            if (bin == 0) {
                return 1.0;
            }

            auto const normalized = static_cast<double>(bin) / static_cast<double>(maxBin);
            if (tiltDb > 0.0) {
                // High-shelf/Tilt up: higher bins get more gain.
                // At Nyquist (bin == maxBin, normalized == 1.0), octavesFromNyquist is 0, gain is 1.0 (0dB).
                // Lower bins get less gain.
                auto const octavesFromNyquist = std::log2(std::max(normalized, 1.0 / static_cast<double>(maxBin)));
                return dbToGain(tiltDb * octavesFromNyquist);
            }

            // Tilt down: lower bins get more gain.
            // At bin 1 (lowest non-DC bin), octavesFromLowestBin is 0, gain is 1.0 (0dB).
            // Higher bins get less gain (tiltDb is negative).
            auto const octavesFromLowestBin = std::log2(std::max(1.0, static_cast<double>(bin)));
            return dbToGain(tiltDb * octavesFromLowestBin);
        }

        static size_t requiredPoolBytes(size_t fftSize)
        {
            return std::max<size_t>(FrameLibTlsfAllocator::defaultPoolBytes, fftSize * 32);
        }

        size_t partSize;
        size_t fftSize;
        uintptr_t fftLog2;
        size_t spectrumSize;
        size_t partitionCount{0};
        size_t writeIndex{0};
        size_t inputFill{0};
        size_t outputRead{0};

        FrameLibTlsfAllocator allocator;
        spectral_processor<T, FrameLibTlsfAllocator> processor;
        std::vector<T> inputBlock;
        std::vector<T> fftOutput;
        std::vector<T> overlap;
        std::vector<T> blockOutput;
        FrameLibSplitBuffer<T> currentInput;
        FrameLibSplitBuffer<T> accum;
        FrameLibSplitBuffer<T> processedIr;
        FrameLibSplitBuffer<T> multiplyTemp;
        FrameLibMagnitudeMovingAverage<T> magnitudeAverage;
        std::vector<FrameLibSplitBuffer<T>> irSpectra;
        std::vector<FrameLibSplitBuffer<T>> inputSpectra;
    };

    template <typename FloatType>
    struct SpectralConvolutionNode : public GraphNode<FloatType> {
        SpectralConvolutionNode(NodeId id, FloatType const sr, int const blockSize)
            : GraphNode<FloatType>::GraphNode(id, sr, blockSize)
        {
            scratchIn.resize(blockSize);
            scratchOut.resize(blockSize);
            scratchTilt.resize(blockSize);
            scratchBlur.resize(blockSize);
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "path") {
                if (!val.isString()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const nextPath = std::string((js::String) val);
                if (!resources.has(nextPath)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                path = nextPath;
                return rebuildConvolver(resources);
            }

            if (key == "partitionSize") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 16.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                partitionSize.store(nextPowerOf2(static_cast<size_t>(parsed)), std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "magnitudeGainDb") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                magnitudeGain.store(dbToGain(parsed), std::memory_order_relaxed);
                return elem::ReturnCode::Ok();
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            if (convolver) {
                convolver->reset();
            }
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto** inputData = ctx.inputData;
            auto* outputData = ctx.outputData[0];
            auto numChannels = ctx.numInputChannels;
            auto numSamples = ctx.numSamples;

            while (convolverQueue.size() > 0) {
                convolverQueue.pop(convolver);
            }

            if (numChannels == 0 || convolver == nullptr) {
                std::fill_n(outputData, numSamples, FloatType(0));
                return;
            }

            auto const hasControlInputs = numChannels >= 3;
            auto const* tiltInput = hasControlInputs ? inputData[0] : nullptr;
            auto const* blurInput = hasControlInputs ? inputData[1] : nullptr;
            auto const* sourceInput = hasControlInputs ? inputData[2] : inputData[0];

            if constexpr (std::is_same_v<FloatType, float>) {
                for (size_t i = 0; i < numSamples; ++i) {
                    auto const source = static_cast<double>(sourceInput[i]);
                    scratchIn[i] = std::isfinite(source) ? source : 0.0;
                }

                double const* tiltData = nullptr;
                double const* blurData = nullptr;
                if (hasControlInputs) {
                    for (size_t i = 0; i < numSamples; ++i) {
                        auto const tilt = static_cast<double>(tiltInput[i]);
                        auto const blurValue = static_cast<double>(blurInput[i]);
                        scratchTilt[i] = std::isfinite(tilt) ? tilt : 0.0;
                        scratchBlur[i] = std::isfinite(blurValue) ? blurValue : 0.0;
                    }
                    tiltData = scratchTilt.data();
                    blurData = scratchBlur.data();
                }

                convolver->process(scratchIn.data(), tiltData, blurData, scratchOut.data(), numSamples,
                                   magnitudeGain.load(std::memory_order_relaxed));

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const wet = scratchOut[i];
                    outputData[i] = std::isfinite(wet) ? static_cast<FloatType>(wet) : FloatType(0);
                }
            }

            if constexpr (std::is_same_v<FloatType, double>) {
                auto* scratchDataIn = scratchIn.data();
                auto* scratchDataOut = scratchOut.data();

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const source = static_cast<double>(sourceInput[i]);
                    scratchDataIn[i] = std::isfinite(source) ? source : 0.0;
                }

                convolver->process(scratchDataIn, tiltInput, blurInput, scratchDataOut, numSamples,
                                   magnitudeGain.load(std::memory_order_relaxed));

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const wet = static_cast<double>(scratchDataOut[i]);
                    outputData[i] = std::isfinite(wet) ? static_cast<FloatType>(wet) : FloatType(0);
                }
            }
        }

        SingleWriterSingleReaderQueue<std::shared_ptr<FrameLibSpectralConvolver<double>>> convolverQueue;
        std::shared_ptr<FrameLibSpectralConvolver<double>> convolver;

        std::vector<double> scratchIn;
        std::vector<double> scratchOut;
        std::vector<double> scratchTilt;
        std::vector<double> scratchBlur;

    private:
        int rebuildConvolver(SharedResourceMap& resources)
        {
            if (path.empty()) {
                return elem::ReturnCode::Ok();
            }

            auto resource = resources.get(path);
            if (resource == nullptr) {
                return elem::ReturnCode::InvalidPropertyValue();
            }

            auto bufferView = resource->getChannelData(0);
            auto preparedIr = prepareSpectralIr(bufferView);

            auto const headSize = partitionSize.load(std::memory_order_relaxed);
            auto co = std::make_shared<FrameLibSpectralConvolver<double>>(headSize, preparedIr);
            convolverQueue.push(std::move(co));
            return elem::ReturnCode::Ok();
        }

        std::vector<double> prepareSpectralIr(BufferView<float> const& bufferView) const
        {
            auto const irLen = bufferView.size();
            if (irLen == 0) {
                return {0.0};
            }

            auto const partSize = std::max<size_t>(16, partitionSize.load(std::memory_order_relaxed));
            auto const partitionCount = (irLen + partSize - 1) / partSize;
            std::vector<double> prepared(partitionCount * partSize, 0.0);

            for (size_t i = 0; i < irLen; ++i) {
                prepared[i] = static_cast<double>(bufferView.data()[i]);
            }

            return prepared;
        }

        static size_t nextPowerOf2(size_t value)
        {
            size_t result = 1;
            while (result < value) {
                result <<= 1;
            }
            return result;
        }

        static double dbToGain(double db)
        {
            return std::pow(10.0, db / 20.0);
        }

        std::string path;
        std::atomic<size_t> partitionSize{512};
        std::atomic<double> magnitudeGain{1.0};
    };

} // namespace elem
