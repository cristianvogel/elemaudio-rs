#pragma once

// VariSlopeSVFNode — cascaded Butterworth SVF with Rossum-style continuous
// slope morphing.
//
// ============================================================================
// Design rationale
// ============================================================================
//
// The vendor `el.svf` (elem::StateVariableFilterNode) is a single second-order
// Simper SVF: one biquad stage, 12 dB/oct rolloff, Q exposed, coefficient
// update per sample.
//
// VariSlopeSVFNode takes a different approach. Q is fixed internally at
// Butterworth (√2 ≈ 1.4142, maximally flat magnitude) and the sole tonal
// control is a continuous `slope` parameter in [1.0, 6.0] that blends smoothly
// between 1–6 cascaded SVF stages (12–72 dB/oct). This is inspired by Dave
// Rossum's analog cascade designs where one knob morphs the filter order
// continuously without clicks or discontinuities.
//
// All six stages run every sample so their integrator states remain warm; the
// output is a linear blend between the two adjacent integer-order outputs that
// bracket the current slope value.
//
// Q is not exposed because the slope *is* the character control. A Butterworth
// cascade is maximally flat in the passband at every order — no resonant peak,
// no passband ripple. Exposing Q on a multi-stage cascade creates compounding
// resonance that is hard to predict or control musically.
//
// ============================================================================
// SVF kernel
// ============================================================================
//
// Each stage is the Simper linear trapezoidal SVF (identical to the vendor):
//
//   v3    = v0 - ic2eq
//   v1    = a1*ic1eq + a2*v3
//   v2    = ic2eq + a2*ic1eq + a3*v3
//   ic1eq = 2*v1 - ic1eq
//   ic2eq = 2*v2 - ic2eq
//   low   = v2
//   high  = v0 - k*v1 - v2
//
// Coefficients (constant k = 1/√2 for Butterworth):
//   g  = tan(π · fc / fs)
//   k  = √2 ≈ 0.7071  (1/Q where Q = √2)
//   a1 = 1 / (1 + g·(g + k))
//   a2 = g · a1
//   a3 = g · a2
//
// ============================================================================
// Per-stage gain correction (matched magnitude at cutoff)
// ============================================================================
//
// The bilinear transform introduces a magnitude error that compounds across
// cascaded stages. A per-stage scalar corrects it:
//
//   gainComp = |H_analog(jω₀)| / |H_digital(e^{jω})|
//
// The analog second-order Butterworth prototype at its own cutoff has:
//   |H(jω₀)| = 1/k = Q = √2 ≈ 1.4142
//
// The digital magnitude is evaluated from the exact z-domain transfer function
// (dgriffin91 derivation). Applied after each stage in the cascade so the
// passband droop does not compound.
//
// For highpass mode the gain correction is set to 1.0 because the BLT error
// manifests in the stopband (below cutoff) which is inaudible.
//
// ============================================================================
// Rossum blend
// ============================================================================
//
// With slope = S (a float in [1.0, 6.0]):
//
//   lo  = stageOut[ floor(S) - 1 ]
//   hi  = stageOut[ ceil(S)  - 1 ]
//   out = lo + frac(S) · (hi - lo)
//
// At integer values (1–6) the blend is exactly one stage's output.
//
// ============================================================================
// Inputs
// ============================================================================
//
//   [0]  cutoff_hz  — cutoff frequency in Hz   (required)
//   [1]  audio      — input signal              (required)
//   [2]  slope      — continuous order 1.0–6.0  (optional; default 1.0)
//
// ============================================================================
// Properties
// ============================================================================
//
//   filterType  — "lowpass" / "lp" (default) or "highpass" / "hp"
//
// ============================================================================
// Thread safety
// ============================================================================
//
// `filterType` is written by setProperty (non-realtime) and read by process
// (realtime) through a std::atomic<bool>. All other state is realtime-only.
//
// ============================================================================
// References
// ============================================================================
//
// Andrew Simper, "Linear Trapezoidal Integrated SVF":
//   https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf
//
// dgriffin91, "Deriving the transfer function of the Simper SVF":
//   https://dgriffin91.github.io/dsp-math-notes/svf_z_domain_tf.html
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

    static constexpr double kPi = 3.14159265358979323846;

    // Butterworth damping: k = 1/Q = 1/√2 ≈ 0.7071.
    // Maximally flat magnitude, no passband ripple, no resonant peak.
    static constexpr double kButterworthK = 0.70710678118654752440;

    // Cutoff clamped to [20 Hz, Nyquist × 0.4999].
    static constexpr double kMinCutoff = 20.0;

    // Maximum number of cascaded stages. Slope 6.0 = 6 stages = 72 dB/oct.
    static constexpr int kMaxStages = 6;

    // -------------------------------------------------------------------------
    // Coeffs
    // -------------------------------------------------------------------------
    struct Coeffs {
        double g;        // tan(π · fc / fs)
        double k;        // 1/Q — always kButterworthK
        double a1;       // 1 / (1 + g·(g + k))
        double a2;       // g · a1
        double a3;       // g · a2
        double gainComp; // per-stage magnitude correction at cutoff (LP only)
    };

    // Compute SVF coefficients from cutoff (Hz) and sample rate (Hz).
    // Q is fixed at Butterworth internally — not exposed to the caller.
    //
    // The gain correction is derived from the exact z-domain transfer function
    // of the Simper SVF, comparing the digital LP magnitude at the cutoff
    // frequency to the analog Butterworth prototype magnitude (1/k = √2).
    inline Coeffs makeCoeffs(double fc, double sr) {
        auto nyquist   = sr * 0.5;
        auto fcClamped = std::max(kMinCutoff, std::min(fc, nyquist * 0.4999));

        auto g  = std::tan(kPi * fcClamped / sr);
        auto k  = kButterworthK;
        auto a1 = 1.0 / (1.0 + g * (g + k));
        auto a2 = g * a1;
        auto a3 = g * a2;

        // --- Per-stage gain correction at cutoff ---
        //
        // Analog Butterworth prototype at ω₀: |H(j)| = 1/k = √2.
        auto analog_mag_sq = 1.0 / (k * k);  // = 2.0

        // Digital LP magnitude at z = exp(j·2π·fc/fs):
        auto w      = 2.0 * kPi * fcClamped / sr;
        auto cos_w  = std::cos(w);
        auto sin_w  = std::sin(w);
        auto cos_2w = std::cos(2.0 * w);
        auto sin_2w = std::sin(2.0 * w);

        auto d_c2 = g*g - g*k + 1.0;
        auto d_c1 = 2.0*g*g - 2.0;
        auto d_c0 = g*g + g*k + 1.0;
        auto d_re = d_c2 * cos_2w + d_c1 * cos_w + d_c0;
        auto d_im = -(d_c2 * sin_2w + d_c1 * sin_w);
        auto d_mag_sq = d_re * d_re + d_im * d_im;

        auto lp_n_re = g*g * (cos_2w + 2.0*cos_w + 1.0);
        auto lp_n_im = g*g * (-(sin_2w + 2.0*sin_w));
        auto lp_dig_mag_sq = (lp_n_re*lp_n_re + lp_n_im*lp_n_im) / d_mag_sq;

        auto gainComp = (lp_dig_mag_sq > 1e-30)
            ? std::sqrt(analog_mag_sq / lp_dig_mag_sq) : 1.0;

        return {g, k, a1, a2, a3, gainComp};
    }

    // -------------------------------------------------------------------------
    // State — two integrator memories per SVF stage.
    // -------------------------------------------------------------------------
    struct State {
        double ic1eq = 0.0;
        double ic2eq = 0.0;
    };

    // -------------------------------------------------------------------------
    // tick — one SVF stage, one sample.
    // Pure Simper trapezoidal form, no soft-clipping. Stability is guaranteed
    // by the fixed Butterworth Q (no resonant blowup possible).
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
    // cascade — run all kMaxStages in series.
    // Per-stage gain correction is applied after each stage (LP only; HP uses
    // gainComp = 1.0).
    // -------------------------------------------------------------------------
    inline void cascade(State* states, Coeffs const& c, double input,
                        bool wantsLow, int n, double* outs)
    {
        double sig = input;
        for (int s = 0; s < n; ++s) {
            auto [low, high] = tick(states[s], c, sig);
            sig     = wantsLow ? low : high;
            sig    *= c.gainComp;
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

    // ---- setProperty (non-realtime thread) ----------------------------------

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

    // ---- process (realtime audio thread) ------------------------------------
    //
    // Inputs:
    //   [0]  cutoff_hz  (required)
    //   [1]  audio      (required)
    //   [2]  slope      (optional; default 1.0, range [1.0, 6.0])

    void process(BlockContext<FloatType> const& ctx) override {
        auto numIns     = ctx.numInputChannels;
        auto numOuts    = ctx.numOutputChannels;
        auto numSamples = ctx.numSamples;

        if (numIns < 2 || numOuts < 1 || numSamples == 0) return;

        auto const* cutoffIn = ctx.inputData[0];
        auto const* audioIn  = ctx.inputData[1];
        auto const* slopeIn  = (numIns > 2) ? ctx.inputData[2] : nullptr;

        auto* out = ctx.outputData[0];
        auto  sr  = GraphNode<FloatType>::getSampleRate();
        bool  lp  = wantsLow.load(std::memory_order_relaxed);

        for (size_t i = 0; i < numSamples; ++i) {
            auto fc    = static_cast<double>(cutoffIn[i]);
            auto slope = slopeIn ? static_cast<double>(slopeIn[i]) : 1.0;
            slope = std::max(1.0, std::min(static_cast<double>(svf_detail::kMaxStages), slope));

            auto coeffs = svf_detail::makeCoeffs(fc, sr);

            // HP mode: skip gain correction (BLT error is in the stopband).
            if (!lp) coeffs.gainComp = 1.0;

            double stageOut[svf_detail::kMaxStages];
            svf_detail::cascade(state, coeffs, static_cast<double>(audioIn[i]),
                                lp, svf_detail::kMaxStages, stageOut);

            // Rossum blend between adjacent integer orders.
            auto lo_idx = static_cast<int>(slope) - 1;
            auto hi_idx = std::min(lo_idx + 1, svf_detail::kMaxStages - 1);
            auto frac   = slope - std::floor(slope);

            out[i] = static_cast<Sample>(
                stageOut[lo_idx] + frac * (stageOut[hi_idx] - stageOut[lo_idx])
            );
        }

        for (size_t c = 1; c < numOuts; ++c)
            std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
    }

    void reset() override {
        for (auto& s : state) s = {};
    }

private:
    std::atomic<bool> wantsLow { true };
    svf_detail::State state[svf_detail::kMaxStages] = {};
};

} // namespace elem
