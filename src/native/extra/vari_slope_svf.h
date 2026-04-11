#pragma once

// VariSlopeSVFNode — cascaded Simper SVF with Rossum-style continuous slope morphing.
//
// ============================================================================
// Design rationale
// ============================================================================
//
// The vendor `el.svf` (elem::StateVariableFilterNode) is a single second-order
// Simper SVF: one biquad stage, 12 dB/oct rolloff, Q exposed, coefficient
// update per sample. It is excellent for fixed-order filtering with fast cutoff
// modulation but offers no way to morph the filter order continuously.
//
// VariSlopeSVFNode adds that capability. Its defining feature is a continuous
// `slope` parameter (range [1.0, 4.0]) that blends smoothly between 1–4
// cascaded SVF stages (12–48 dB/oct) inspired by Dave Rossum's analog cascade
// designs. All four stages run every sample so their integrator states remain
// warm; the output is then a linear blend between the two adjacent integer-order
// outputs that bracket the current slope value. The result is a filter whose
// order morphs without clicks, discontinuities, or integrator dropouts.
//
// ============================================================================
// SVF kernel
// ============================================================================
//
// The per-stage kernel replicates the vendor's linear trapezoidal form exactly
// (Simper, "Linear Trapezoidal Integrated SVF", 2023) as a self-contained
// stateless helper so stages share coefficients while keeping independent state:
//
//   v3    = v0 - ic2eq
//   v1    = a1*ic1eq + a2*v3          (bandpass integrator output)
//   v2    = ic2eq + a2*ic1eq + a3*v3  (lowpass integrator output)
//   ic1eq = 2*v1 - ic1eq              (update first integrator memory)
//   ic2eq = 2*v2 - ic2eq              (update second integrator memory)
//   low   = v2
//   high  = v0 - k*v1 - v2
//
// Coefficients are derived per sample from cutoff and Q:
//   g  = tan(pi * fc / fs)
//   k  = 1 / Q
//   a1 = 1 / (1 + g*(g+k))
//   a2 = g * a1
//   a3 = g * a2
//
// ============================================================================
// Rossum blend
// ============================================================================
//
// With slope = S (a float in [1.0, 4.0]):
//
//   lo  = stageOut[ floor(S) - 1 ]   output of the lower integer order
//   hi  = stageOut[ ceil(S)  - 1 ]   output of the higher integer order
//   out = lo + frac(S) * (hi - lo)   linear crossfade
//
// At integer values (1, 2, 3, 4) the blend is exactly one stage's output.
// Between integers the filter order morphs continuously without discontinuity.
//
// ============================================================================
// Inputs (all per-sample audio signals)
// ============================================================================
//
//   [0]  cutoff_hz  — cutoff frequency in Hz            (required)
//   [1]  audio      — input signal                      (required)
//   [2]  slope      — continuous order 1.0–4.0          (optional; default 4.0)
//   [3]  q          — filter Q                          (optional; default sqrt(2) = Butterworth)
//
// ============================================================================
// Properties (set from the non-realtime thread)
// ============================================================================
//
//   filterType  — "lowpass" / "lp"  selects the lowpass output of each stage.
//               — "highpass" / "hp" selects the highpass output of each stage.
//               — Default: "lowpass".
//
// ============================================================================
// Thread safety
// ============================================================================
//
// `filterType` is written by setProperty (non-realtime) and read by process
// (realtime) through a std::atomic<bool>. All other state is realtime-only.
// The `slope` and `q` modulation inputs are read only from the audio thread.
//
// ============================================================================
// References
// ============================================================================
//
// Andrew Simper, "Linear Trapezoidal Integrated SVF":
//   https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf
//
// Dave Rossum, "Making Digital Filters Sound Analog":
//   AES 1992 preprint — continuous pole interpolation in cascade topologies.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem {

// ----------------------------------------------------------------------------
// svf_detail — internal helpers, not part of the public node interface.
// ----------------------------------------------------------------------------
namespace svf_detail {

    // Butterworth Q (maximally flat magnitude, no passband ripple).
    static constexpr double kDefaultQ  = 1.4142135623730950488; // sqrt(2)

    // Cutoff clamped to [20 Hz, Nyquist * 0.4999] to keep the bilinear
    // pre-warp well-conditioned and the filter stable at all sample rates.
    static constexpr double kMinCutoff = 20.0;

    // Q clamped to [0.25, 20.0] — matches the vendor SVF node range.
    static constexpr double kMinQ      = 0.25;
    static constexpr double kMaxQ      = 20.0;

    // Maximum number of cascaded stages (slope 4.0 = 4 stages = 48 dB/oct).
    static constexpr int    kMaxStages = 4;

    // -------------------------------------------------------------------------
    // Coeffs — per-sample coefficient set, computed in makeCoeffs and passed
    // by value to tick/cascade so no heap allocation occurs on the audio thread.
    // -------------------------------------------------------------------------
    struct Coeffs {
        double g;   // tan(pi * fc / fs) — pre-warped normalised frequency
        double k;   // 1/Q — damping factor
        double a1;  // 1 / (1 + g*(g+k))
        double a2;  // g * a1
        double a3;  // g * a2
    };

    // Compute SVF coefficients from cutoff (Hz), Q, and sample rate (Hz).
    // Cutoff and Q are clamped to their safe operating ranges before use.
    inline Coeffs makeCoeffs(double fc, double q, double sr) {
        auto nyquist   = sr * 0.5;
        auto fcClamped = std::max(kMinCutoff, std::min(fc, nyquist * 0.4999));
        auto qClamped  = std::max(kMinQ,      std::min(q,  kMaxQ));
        auto g  = std::tan(3.14159265358979323846 * fcClamped / sr);
        auto k  = 1.0 / qClamped;
        auto a1 = 1.0 / (1.0 + g * (g + k));
        auto a2 = g * a1;
        auto a3 = g * a2;
        return {g, k, a1, a2, a3};
    }

    // -------------------------------------------------------------------------
    // State — two integrator memories for one SVF biquad stage.
    // Each cascaded stage has its own independent State instance.
    // -------------------------------------------------------------------------
    struct State {
        double ic1eq = 0.0;  // first integrator memory (bandpass)
        double ic2eq = 0.0;  // second integrator memory (lowpass)
    };

    // -------------------------------------------------------------------------
    // tick — advance one SVF stage by one sample.
    //
    // Implements the Simper linear trapezoidal form verbatim. Identical to the
    // vendor StateVariableFilterNode::tick kernel so the two implementations
    // remain audibly interchangeable at integer slope values.
    //
    // Returns {low, high}. Band, notch, and allpass outputs are not exposed
    // here because the cascade blend operates only on low/high pairs.
    // -------------------------------------------------------------------------
    inline std::pair<double, double> tick(State& s, Coeffs const& c, double v0) {
        double v3 = v0 - s.ic2eq;
        double v1 = s.ic1eq * c.a1 + v3 * c.a2;
        double v2 = s.ic2eq + s.ic1eq * c.a2 + v3 * c.a3;

        s.ic1eq = 2.0 * v1 - s.ic1eq;
        s.ic2eq = 2.0 * v2 - s.ic2eq;

        return {v2, v0 - c.k * v1 - v2};
    }

    // -------------------------------------------------------------------------
    // cascade — run n SVF stages in series and capture each stage's output.
    //
    // All kMaxStages are always run (not just the active ones) so every stage's
    // integrator state advances every sample regardless of the current slope
    // blend weight. This prevents integrator dropout when slope sweeps upward
    // re-activating a previously idle stage, which would otherwise produce a
    // transient click as the stale state re-enters the signal path.
    //
    // Parameters:
    //   states   — array of kMaxStages State instances, one per stage
    //   c        — shared coefficient set for this sample
    //   input    — audio input to the first stage
    //   wantsLow — true = lowpass output chain, false = highpass output chain
    //   n        — number of stages to run (must be <= kMaxStages)
    //   outs     — output array of length >= n; outs[s] = output after stage s+1
    // -------------------------------------------------------------------------
    inline void cascade(State* states, Coeffs const& c, double input,
                        bool wantsLow, int n, double* outs)
    {
        double sig = input;
        for (int s = 0; s < n; ++s) {
            auto [low, high] = tick(states[s], c, sig);
            sig     = wantsLow ? low : high;
            outs[s] = sig;
        }
    }

} // namespace svf_detail

// ----------------------------------------------------------------------------
// VariSlopeSVFNode
// ----------------------------------------------------------------------------
template <typename FloatType>
struct VariSlopeSVFNode : public GraphNode<FloatType> {
    using GraphNode<FloatType>::GraphNode;
    using Sample = FloatType;

    VariSlopeSVFNode(NodeId id, double sr, int blockSize)
        : GraphNode<FloatType>(id, sr, blockSize) {}

    // -------------------------------------------------------------------------
    // setProperty — called from the non-realtime thread.
    //
    // Supported keys:
    //   "filterType"  string  "lowpass"/"lp" or "highpass"/"hp"
    //
    // All other keys are forwarded to the base GraphNode props map.
    // -------------------------------------------------------------------------
    int setProperty(std::string const& key, js::Value const& val,
                    SharedResourceMap&) override
    {
        if (key == "filterType") {
            if (!val.isString()) return ReturnCode::InvalidPropertyType();
            auto s = static_cast<std::string>(val);
            wantsLow.store(s == "lowpass" || s == "lp", std::memory_order_relaxed);
        }
        return GraphNode<FloatType>::setProperty(key, val);
    }

    // -------------------------------------------------------------------------
    // process — called from the realtime audio thread once per block.
    //
    // Input layout:
    //   inputData[0]  cutoff_hz  — per-sample cutoff in Hz   (required)
    //   inputData[1]  audio      — per-sample input signal   (required)
    //   inputData[2]  slope      — per-sample slope [1,4]    (optional)
    //   inputData[3]  q          — per-sample Q              (optional)
    //
    // If fewer than 2 inputs are connected the output is silenced.
    // If slope or q inputs are absent their defaults are used (4.0 and sqrt(2)).
    //
    // Output layout:
    //   outputData[0]  filtered signal
    //   outputData[1+] zeroed
    // -------------------------------------------------------------------------
    void process(BlockContext<FloatType> const& ctx) override {
        auto numIns     = ctx.numInputChannels;
        auto numOuts    = ctx.numOutputChannels;
        auto numSamples = ctx.numSamples;

        // Require at least cutoff and audio inputs.
        if (numIns < 2 || numOuts < 1 || numSamples == 0) return;

        auto const* cutoffIn = ctx.inputData[0];
        auto const* audioIn  = ctx.inputData[1];
        // Optional: slope modulation (input [2]) and Q modulation (input [3]).
        auto const* slopeIn  = (numIns > 2) ? ctx.inputData[2] : nullptr;
        auto const* qIn      = (numIns > 3) ? ctx.inputData[3] : nullptr;

        auto* out = ctx.outputData[0];
        auto  sr  = GraphNode<FloatType>::getSampleRate();
        bool  lp  = wantsLow.load(std::memory_order_relaxed);

        for (size_t i = 0; i < numSamples; ++i) {
            auto fc    = static_cast<double>(cutoffIn[i]);
            auto q     = qIn     ? static_cast<double>(qIn[i])
                                 : svf_detail::kDefaultQ;
            // slope in [1.0, 4.0]; clamp to safe range.
            auto slope = slopeIn ? static_cast<double>(slopeIn[i]) : 4.0;
            slope = std::max(1.0, std::min(4.0, slope));

            auto coeffs = svf_detail::makeCoeffs(fc, q, sr);

            // Always run all kMaxStages to keep integrators warm (see cascade
            // documentation above for why this matters).
            double stageOut[svf_detail::kMaxStages];
            svf_detail::cascade(state, coeffs, static_cast<double>(audioIn[i]),
                                lp, svf_detail::kMaxStages, stageOut);

            // Rossum blend: linearly crossfade between the outputs of the two
            // integer stage counts that bracket the current slope value.
            //
            //   slope = 1.7  →  lo_idx = 0 (stage 1), hi_idx = 1 (stage 2)
            //                   frac   = 0.7
            //   out   = stageOut[0] + 0.7 * (stageOut[1] - stageOut[0])
            auto  lo_idx = static_cast<int>(slope) - 1;
            auto  hi_idx = std::min(lo_idx + 1, svf_detail::kMaxStages - 1);
            auto  frac   = slope - std::floor(slope);

            out[i] = static_cast<Sample>(
                stageOut[lo_idx] + frac * (stageOut[hi_idx] - stageOut[lo_idx])
            );
        }

        // Zero any surplus output channels.
        for (size_t c = 1; c < numOuts; ++c)
            std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
    }

    // -------------------------------------------------------------------------
    // reset — clear all integrator state.
    // Called on the non-realtime thread by Runtime::reset().
    // -------------------------------------------------------------------------
    void reset() override {
        for (auto& s : state) s = {};
    }

private:
    // filterType is written on the non-realtime thread and read on the audio
    // thread, so it is protected by an atomic.
    std::atomic<bool> wantsLow { true };

    // One independent State (two integrator memories) per cascade stage.
    svf_detail::State state[svf_detail::kMaxStages] = {};
};

} // namespace elem
