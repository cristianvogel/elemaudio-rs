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
    // DustNode — sparse random impulses with optional decaying release.
    //
    // Inspired by SuperCollider's Dust / Dust2 with a twist: each impulse
    // can have a trailing exponential release instead of being a single-sample
    // spike. Releases overlap and sum (polyphonic voice pool).
    //
    // Inputs (signals, sample-rate):
    //   [0] density — impulses per second (Poisson rate)
    //   [1] release — T60 decay time in seconds per impulse
    //
    // Props:
    //   seed     (number, optional) — deterministic RNG seed
    //   bipolar  (bool, optional, default true) — Dust2-style -1..+1 sign
    //                                              (false = Dust 0..1)
    //   jitter   (number, optional, default 0)  — per-impulse amplitude
    //            randomness, 0.0 = all impulses at amp 1, 1.0 = amp is
    //            uniformly distributed in [0, 1].
    //
    // Behaviour:
    //   - Each sample: Bernoulli trial with probability density/sr
    //   - On trigger: spawn a new voice in the pool with amplitude 1
    //     (and random sign if bipolar)
    //   - Each voice decays exponentially: value *= coeff per sample,
    //     where coeff = exp(ln(0.001) / (release * sr))
    //   - Voices sum into the output
    //   - If all voices in the pool are busy, the new trigger is dropped
    //   - release <= 0 → single-sample impulse (voice expires next sample)

    template <typename FloatType>
    struct DustNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

    static constexpr size_t CHILD_DENSITY = 0;
    static constexpr size_t CHILD_RELEASE = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        // Fixed voice pool — bounded, no heap allocation on audio thread.
        static constexpr size_t MAX_VOICES = 64;

        DustNode(NodeId id, double sr, int blockSize)
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
            } else if (key == "bipolar") {
                if (!val.isBool()) return ReturnCode::InvalidPropertyType();
                bipolarTarget.store(static_cast<bool>((js::Boolean) val), std::memory_order_relaxed);
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
            auto const bipolar = bipolarTarget.load(std::memory_order_relaxed);
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

            // Cache decay coefficient per sample only when release changes
            // meaningfully. Since release is a signal, recompute per sample;
            // the cost is one exp() but only when an active voice exists.
            for (size_t i = 0; i < numSamples; ++i) {
                Sample density = densitySignal[i];
                Sample release = releaseSignal[i];

                // Trigger trial
                Sample triggerProb = density <= Sample(0)
                    ? Sample(0)
                    : std::min(Sample(1), density / sampleRate);

                if (triggerProb > Sample(0) && random01() < triggerProb) {
                    spawnVoice(bipolar, jitter);
                }

                // Accumulate all active voices, decay them
                Sample sum = Sample(0);
                if (activeCount > 0) {
                    Sample coeff = decayCoeff(release, sampleRate);

                    for (size_t v = 0; v < MAX_VOICES; ++v) {
                        if (voices[v] != Sample(0)) {
                            sum += voices[v];
                            voices[v] *= coeff;

                            // Expire very small voices
                            if (std::fabs(voices[v]) < Sample(1e-6)) {
                                voices[v] = Sample(0);
                                activeCount -= 1;
                            }
                        }
                    }
                }

                out[i] = sum;
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        void spawnVoice(bool bipolar, Sample jitter)
        {
            // Find a free voice slot. If none free, drop the trigger.
            if (activeCount >= MAX_VOICES) return;

            for (size_t v = 0; v < MAX_VOICES; ++v) {
                if (voices[v] == Sample(0)) {
                    // Amplitude scale: (1 - jitter) + jitter * rand01
                    // At jitter=0 → amp=1. At jitter=1 → amp ∈ [0,1] uniform.
                    Sample amp = Sample(1) - jitter + jitter * random01();
                    // Guard against exact zero — voices[v] == 0 marks a
                    // free slot. A floor of 1e-4 is inaudible but keeps
                    // slot accounting correct.
                    if (amp < Sample(1e-4)) amp = Sample(1e-4);

                    if (bipolar) {
                        amp *= (fastRand() & 1) ? Sample(1) : Sample(-1);
                    }
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
        std::atomic<bool> bipolarTarget{true};
        std::atomic<float> jitterTarget{0.0f};

        uint32_t seed = 1;
        uint32_t seedApplied = 0;
        std::array<Sample, MAX_VOICES> voices{};
        size_t activeCount = 0;
    };

} // namespace elem
