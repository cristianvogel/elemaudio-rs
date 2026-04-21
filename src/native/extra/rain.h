#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    // RainNode — sparse random impulses with optional decaying release.
    //
    // Inspired by SuperCollider's Dust with a twist: each impulse
    // can have a trailing exponential release instead of being a single-sample
    // spike. Releases overlap and sum (polyphonic voice pool).
    //
    // Inputs (signals, sample-rate):
    //   [0] density — impulses per second (Poisson rate)
    //   [1] release — T60 decay time in seconds per impulse
    //
    // Props:
    //   seed     (number, optional) — deterministic RNG seed
    //   jitter   (number, optional, default 0)  — per-impulse amplitude
    //            randomness, 0.0 = all impulses at amp 1, 1.0 = amp is
    //            uniformly distributed in [0, 1].
    //
    // Behaviour:
    //   - Each sample: Bernoulli trial with probability density/sr
    //   - Each voice decays exponentially: value *= coeff per sample,
    //     where coeff = exp(ln(0.001) / (release * sr))
    //   - Voices sum into the output
    //   - If all voices in the pool are busy, the new trigger is dropped
    //   - release <= 0 → single-sample impulse (voice expires next sample)
    //
    // Overlap handling:
    //
    //   unipolar gap-filling spawn + DC blocker:
    //     The instantaneous summed envelope is always in [0, 1]. When a
    //     new event fires while the existing sum is at level `d`, the new
    //     voice is born at amplitude `(1 - d)`, so the summed envelope
    //     jumps back to exactly 1.0 (or stays at `d` if `d >= 1`, which
    //     never happens by construction). A lightweight DC blocker runs
    //     after the sum so the output stays centered around 0 instead of
    //     drifting positive as density rises.
    //
    //     This is the right model for a Poisson event train with overlap:
    //     a fresh trigger "refreshes" the envelope peak, it does not stack
    //     on top of it. Sonically: dense unipolar rain reads as a
    //     probabilistically-retriggered exponential envelope whose decay
    //     tail shortens as density rises, then is recentered to zero.

    template <typename FloatType>
    struct RainNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

    static constexpr size_t CHILD_DENSITY = 0;
    static constexpr size_t CHILD_RELEASE = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        // Fixed voice pool — bounded, no heap allocation on audio thread.
        static constexpr size_t MAX_VOICES = 64;

        RainNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {
            // Non-zero seed required for xorshift32. Request counter starts
            // at 0 (will be applied on first reset/process).
            auto const s = static_cast<uint32_t>(std::rand()) | 1u;
            seedTarget.store(s, std::memory_order_relaxed);
            seed = s;
            voices.fill(Sample(0));
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "seed") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                auto raw = static_cast<uint32_t>((js::Number) val);
                // xorshift32 requires non-zero seed
                if (raw == 0) raw = 1;
                seedTarget.store(raw, std::memory_order_relaxed);
                // Increment request counter so process() picks up the new seed.
                seedRequest.fetch_add(1, std::memory_order_relaxed);
            } else if (key == "jitter") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                auto raw = static_cast<float>((js::Number) val);
                auto clamped = std::max(0.0f, std::min(1.0f, raw));
                jitterTarget.store(clamped, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            seed = seedTarget.load(std::memory_order_relaxed);
            if (seed == 0) seed = 1;
            seedApplied = seedRequest.load(std::memory_order_relaxed);
            voices.fill(Sample(0));
            activeCount = 0;
            unipolarX1 = Sample(0);
            unipolarY1 = Sample(0);
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            if (numIns < NUM_CHILDREN || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const* densitySignal = ctx.inputData[CHILD_DENSITY];
            auto const* releaseSignal = ctx.inputData[CHILD_RELEASE];
            auto* out = ctx.outputData[0];
            auto const sampleRate = Sample(GraphNode<FloatType>::getSampleRate());
            auto const jitter = Sample(jitterTarget.load(std::memory_order_relaxed));

            // Only re-seed when the user explicitly set a new seed prop.
            // Checking seedTarget != seed is wrong because seed evolves each
            // call to fastRand() — it would reset every block.
            auto const request = seedRequest.load(std::memory_order_relaxed);
            if (request != seedApplied) {
                seed = seedTarget.load(std::memory_order_relaxed);
                if (seed == 0) seed = 1;
                seedApplied = request;
                voices.fill(Sample(0));
                activeCount = 0;
            }

            for (size_t i = 0; i < numSamples; ++i) {
                Sample density = densitySignal[i];
                Sample release = releaseSignal[i];

                // Trigger trial.
                Sample triggerProb = density <= Sample(0)
                    ? Sample(0)
                    : std::min(Sample(1), density / sampleRate);
                bool fire = triggerProb > Sample(0) && random01() < triggerProb;

                if (fire) {
                    // Gap-filling: examine the current envelope level
                    // (pre-decay, this sample), compute headroom, and
                    // spawn a new voice filling just that gap to 1.0.
                    Sample currentSum = Sample(0);
                    for (size_t v = 0; v < MAX_VOICES; ++v) {
                        currentSum += voices[v];
                    }
                    spawnVoiceGapFill(jitter, currentSum);
                }

                // Accumulate and decay all active voices.
                Sample sum = Sample(0);
                Sample coeff = decayCoeff(release, sampleRate);

                if (activeCount > 0) {
                    for (size_t v = 0; v < MAX_VOICES; ++v) {
                        if (voices[v] != Sample(0)) {
                            sum += voices[v];
                            voices[v] *= coeff;

                            // Expire very small voices (free the slot).
                            if (std::fabs(voices[v]) < Sample(1e-6)) {
                                voices[v] = Sample(0);
                                activeCount -= 1;
                            }
                        }
                    }
                }

                // Match vendor `el.dcblock(x)`, which is implemented as:
                //   pole(0.995, zero(1, 1, x))
                // i.e. y[n] = x[n] - x[n-1] + 0.995 * y[n-1].
                static constexpr Sample DC_BLOCKER_R = Sample(0.995);
                Sample hp = sum - unipolarX1 + DC_BLOCKER_R * unipolarY1;
                unipolarX1 = sum;
                unipolarY1 = hp;
                out[i] = hp;
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        // Jitter map: (1 - jitter) + jitter * rand01
        //   jitter=0 → amp=1 (all impulses at full amplitude)
        //   jitter=1 → amp ∈ [0, 1] uniform
        // Floor 1e-4 guards against exact-zero amplitudes which would
        // otherwise look like free voice slots and break slot accounting.
        inline Sample jitteredUnitAmp(Sample jitter)
        {
            Sample amp = Sample(1) - jitter + jitter * random01();
            if (amp < Sample(1e-4)) amp = Sample(1e-4);
            return amp;
        }

        // Spawn a new voice using the "gap fill" rule.
        //
        // If the summed envelope is currently at level `currentSum`, the
        // new voice starts at amplitude `(1 - currentSum)` — just enough
        // to lift the total to exactly 1.0. The result:
        //   * Total envelope is bounded in [0, 1] by construction.
        //   * Each event refreshes the peak instead of stacking.
        //   * No RMS compensation or tanh squash needed.
        //
        // The jitter prop applies to the gap fill, so jitter=1 maps to
        // "fire anywhere in [0, gap]" and jitter=0 maps to "always close
        // the gap to 1.0".
        void spawnVoiceGapFill(Sample jitter, Sample currentSum)
        {
            if (activeCount >= MAX_VOICES) return;

            Sample gap = Sample(1) - currentSum;
            if (gap <= Sample(1e-4)) {
                // Envelope already at (or past) peak; drop the trigger.
                return;
            }

            // Amplitude in [0, gap], with jitter controlling variance.
            Sample amp = jitteredUnitAmp(jitter) * gap;
            if (amp < Sample(1e-4)) amp = Sample(1e-4);

            for (size_t v = 0; v < MAX_VOICES; ++v) {
                if (voices[v] == Sample(0)) {
                    voices[v] = amp;
                    activeCount += 1;
                    return;
                }
            }
        }

        static Sample decayCoeff(Sample decaySeconds, Sample sampleRate)
        {
            if (decaySeconds <= Sample(0) || sampleRate <= Sample(0)) {
                // Zero coefficient — voice expires immediately after this sample
                return Sample(0);
            }
            // T60: value decays to 0.001 after `decaySeconds`
            auto const t60 = decaySeconds * sampleRate;
            return static_cast<Sample>(std::exp(std::log(0.001) / t60));
        }

        // xorshift32 — faster and better distribution than LCG
        inline uint32_t fastRand()
        {
            uint32_t x = seed;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            seed = x;
            return x;
        }

        inline Sample random01()
        {
            // Upper 24 bits for better distribution, normalised to [0, 1)
            return static_cast<Sample>(fastRand() >> 8) / static_cast<Sample>(1u << 24);
        }

        std::atomic<uint32_t> seedTarget{1};
        std::atomic<uint32_t> seedRequest{0};
        std::atomic<float> jitterTarget{0.0f};

        uint32_t seed = 1;
        uint32_t seedApplied = 0;
        std::array<Sample, MAX_VOICES> voices{};
        size_t activeCount = 0;
        Sample unipolarX1 = Sample(0);
        Sample unipolarY1 = Sample(0);
    };

} // namespace elem
