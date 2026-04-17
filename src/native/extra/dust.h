#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    // DustNode — sparse random impulses with a vactrol-ish decaying trail.
    //
    // Shape:
    //   - `density` is the average number of trigger attempts per second.
    //   - `trails` is an audio-rate decay time in seconds.
    //   - Each accepted trigger produces a bipolar ping (`-1` or `+1`) and
    //     then decays with a fast/slow two-stage envelope. The fast component
    //     gives the "ping"; the slower component gives the tail.
    //   - Retriggers are blocked while a trail is still active. This keeps the
    //     node musically close to a pinged vactrol: one strike, then a return
    //     to rest before the next strike can land.
    //
    // Inputs:
    //   [0] density — impulses per second (signal)
    //   [1] trails  — decay time in seconds (signal)
    //
    // Props:
    //   seed (number, optional) — deterministic RNG seed. Defaults to a
    //   std::rand()-derived value at construction.
    //
    // Notes:
    //   - Density <= 0 means no new triggers, but an already-running trail is
    //     allowed to finish decaying.
    //   - Trails <= 0 collapses the node back to Dust2-like impulses (one
    //     sample only, no trail).
    //   - The decay curve is intentionally not perfectly linear: a fast and a
    //     slow envelope are blended with a little per-trigger variation, to
    //     evoke the uneven response of a vactrol being "pinged".

    template <typename FloatType>
    struct DustNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_DENSITY = 0;
        static constexpr size_t CHILD_TRAILS = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        DustNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
            , seedTarget(static_cast<uint32_t>(std::rand()))
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "seed") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                seedTarget.store(static_cast<uint32_t>((js::Number) val), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            seed = seedTarget.load(std::memory_order_relaxed);
            active = false;
            fastEnv = Sample(0);
            slowEnv = Sample(0);
            sign = Sample(0);
            fastMix = Sample(0.7);
            fastTauScale = Sample(0.18);
            slowTauScale = Sample(0.9);
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
            auto const* trailsSignal = ctx.inputData[CHILD_TRAILS];
            auto* out = ctx.outputData[0];
            auto const sampleRate = Sample(GraphNode<FloatType>::getSampleRate());

            syncSeedIfNeeded();

            for (size_t i = 0; i < numSamples; ++i) {
                Sample density = densitySignal[i];
                Sample trails = trailsSignal[i];

                // Convert impulses/sec to per-sample probability.
                Sample triggerProb = density <= Sample(0)
                    ? Sample(0)
                    : std::min(Sample(1), density / sampleRate);

                // A new ping starts only when the trail is idle. This gives the
                // "pinged vactrol" behavior the user asked for: a trigger can
                // set off a response, but the response must fall back before the
                // next trigger is allowed to land.
                if (!active && random01() < triggerProb) {
                    startPing();
                }

                if (active) {
                    out[i] = sign * (fastMix * fastEnv + (Sample(1) - fastMix) * slowEnv);
                    advanceTrail(trails, sampleRate);
                } else {
                    out[i] = Sample(0);
                }
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        void syncSeedIfNeeded()
        {
            auto const target = seedTarget.load(std::memory_order_relaxed);
            if (target != seed) {
                seed = target;
                active = false;
                fastEnv = Sample(0);
                slowEnv = Sample(0);
            }
        }

        void startPing()
        {
            sign = (fastRand() & 1) ? Sample(1) : Sample(-1);

            // Per-trigger variation gives a slightly more organic vactrol feel.
            auto const mixJitter = random01();
            auto const fastJitter = random01();
            auto const slowJitter = random01();

            fastMix = Sample(0.58) + Sample(0.22) * mixJitter;
            fastTauScale = Sample(0.12) + Sample(0.10) * fastJitter;
            slowTauScale = Sample(0.82) + Sample(0.28) * slowJitter;

            fastEnv = Sample(1);
            slowEnv = Sample(1);
            active = true;
        }

        void advanceTrail(Sample trails, Sample sampleRate)
        {
            if (trails <= Sample(0)) {
                active = false;
                fastEnv = Sample(0);
                slowEnv = Sample(0);
                return;
            }

            auto const fastCoeff = decayCoeff(trails * fastTauScale, sampleRate);
            auto const slowCoeff = decayCoeff(trails * slowTauScale, sampleRate);

            fastEnv *= fastCoeff;
            slowEnv *= slowCoeff;

            if (fastEnv < Sample(1e-6) && slowEnv < Sample(1e-6)) {
                active = false;
                fastEnv = Sample(0);
                slowEnv = Sample(0);
            }
        }

        static Sample decayCoeff(Sample decaySeconds, Sample sampleRate)
        {
            if (decaySeconds <= Sample(0) || sampleRate <= Sample(0)) {
                return Sample(0);
            }

            // -60 dB after `decaySeconds`.
            auto const t60 = decaySeconds * sampleRate;
            return static_cast<Sample>(std::exp(std::log(0.001) / t60));
        }

        inline uint32_t fastRand()
        {
            seed = 214013u * seed + 2531011u;
            return (seed >> 16) & 0x7FFFu;
        }

        inline Sample random01()
        {
            return static_cast<Sample>(fastRand()) / static_cast<Sample>(0x7FFF);
        }

        std::atomic<uint32_t> seedTarget;
        uint32_t seed = 0;

        bool active = false;
        Sample sign = Sample(0);
        Sample fastEnv = Sample(0);
        Sample slowEnv = Sample(0);
        Sample fastMix = Sample(0.7);
        Sample fastTauScale = Sample(0.18);
        Sample slowTauScale = Sample(0.9);
    };

} // namespace elem
