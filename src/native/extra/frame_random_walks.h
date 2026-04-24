#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct FrameRandomWalksNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_STEP_SIZE = 0;
        static constexpr size_t CHILD_TIME_CONSTANT = 1;
        static constexpr size_t CHILD_STEP_SHAPER = 2;
        static constexpr size_t CHILD_TIME_SHAPER = 3;
        static constexpr size_t NUM_CHILDREN = 4;

        FrameRandomWalksNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                if (raw < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLengthTarget.store(raw, std::memory_order_relaxed);
                reinitRequest.fetch_add(1, std::memory_order_relaxed);
            } else if (key == "seed") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto raw = static_cast<uint32_t>((js::Number) val);
                if (raw == 0) {
                    raw = 1;
                }

                seedTarget.store(raw, std::memory_order_relaxed);
                reinitRequest.fetch_add(1, std::memory_order_relaxed);
            } else if (key == "absolute") {
                if (!val.isBool()) {
                    return ReturnCode::InvalidPropertyType();
                }

                absoluteTarget.store(static_cast<bool>(val), std::memory_order_relaxed);
            } else if (key == "interpolation") {
                if (!val.isBool()) {
                    return ReturnCode::InvalidPropertyType();
                }

                interpolationTarget.store(static_cast<bool>(val), std::memory_order_relaxed);
            } else if (key == "startingfrom") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                startingFromTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
                reinitRequest.fetch_add(1, std::memory_order_relaxed);
            } else if (key == "initialdeviation") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                initialDeviationTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
                reinitRequest.fetch_add(1, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
            absolute = absoluteTarget.load(std::memory_order_relaxed);
            interpolation = interpolationTarget.load(std::memory_order_relaxed);
            ensureStorage();
            reinitializeState();
            appliedRequest = reinitRequest.load(std::memory_order_relaxed);
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numIns = ctx.numInputChannels;
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (numIns < NUM_CHILDREN || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const request = reinitRequest.load(std::memory_order_relaxed);
            auto const nextFrameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
            if (request != appliedRequest || nextFrameLength != frameLength) {
                frameLength = nextFrameLength;
                ensureStorage();
                reinitializeState();
                appliedRequest = request;
            }

            absolute = absoluteTarget.load(std::memory_order_relaxed);
            interpolation = interpolationTarget.load(std::memory_order_relaxed);

            auto const* stepSizeSignal = ctx.inputData[CHILD_STEP_SIZE];
            auto const* timeConstantSignal = ctx.inputData[CHILD_TIME_CONSTANT];
            auto const* stepShaperSignal = ctx.inputData[CHILD_STEP_SHAPER];
            auto const* timeShaperSignal = ctx.inputData[CHILD_TIME_SHAPER];
            auto* out = ctx.outputData[0];
            auto const sampleRate = Sample(GraphNode<FloatType>::getSampleRate());
            auto const frameDuration = static_cast<Sample>(frameLength) / sampleRate;
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const track = static_cast<size_t>(positiveMod(t, frameLength));

                auto const stepSize = std::max(Sample(0), stepSizeSignal[i]) * shapeScale(stepShaperSignal[i]);
                auto const shapedTimeConstant = std::max(Sample(0), timeConstantSignal[i]) * inverseShapeScale(timeShaperSignal[i]);

                if (framesElapsed[track] >= framesTotal[track]) {
                    auto const start = currentValues[track];
                    auto const target = mirrorBipolar(start + signedRandom() * stepSize);
                    startValues[track] = start;
                    targetValues[track] = target;
                    framesElapsed[track] = 0;
                    framesTotal[track] = durationFrames(shapedTimeConstant, frameDuration);

                    if (!interpolation) {
                        currentValues[track] = target;
                    }
                }

                Sample raw = currentValues[track];
                if (interpolation) {
                    auto const total = std::max<int32_t>(1, framesTotal[track]);
                    auto const elapsed = std::min<int32_t>(framesElapsed[track] + 1, total);
                    auto const phase = static_cast<Sample>(elapsed) / static_cast<Sample>(total);
                    auto const eased = Sample(0.5) - Sample(0.5) * std::cos(phase * Sample(3.14159265358979323846));
                    raw = startValues[track] + (targetValues[track] - startValues[track]) * eased;
                    currentValues[track] = raw;
                    framesElapsed[track] = elapsed;
                } else {
                    framesElapsed[track] = std::min<int32_t>(framesElapsed[track] + 1, framesTotal[track]);
                    raw = currentValues[track];
                }

                out[i] = absolute ? std::fabs(raw) : raw;
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        static int64_t positiveMod(int64_t value, int64_t modulus)
        {
            auto const rem = value % modulus;
            return rem < 0 ? rem + modulus : rem;
        }

        static Sample clampShaper(Sample x)
        {
            return std::max(Sample(-1), std::min(Sample(1), x));
        }

        static Sample shapeScale(Sample shaper)
        {
            return static_cast<Sample>(std::exp2(Sample(4) * clampShaper(shaper)));
        }

        static Sample inverseShapeScale(Sample shaper)
        {
            return static_cast<Sample>(std::exp2(Sample(-4) * clampShaper(shaper)));
        }

        static Sample mirrorBipolar(Sample x)
        {
            if (!std::isfinite(x)) {
                return Sample(0);
            }

            auto wrapped = std::fmod(x + Sample(1), Sample(4));
            if (wrapped < Sample(0)) {
                wrapped += Sample(4);
            }

            return wrapped <= Sample(2) ? Sample(-1) + wrapped : Sample(3) - wrapped;
        }

        static int32_t durationFrames(Sample timeConstantSeconds, Sample frameDurationSeconds)
        {
            if (timeConstantSeconds <= Sample(0) || frameDurationSeconds <= Sample(0)) {
                return 1;
            }

            auto const frames = static_cast<int32_t>(std::ceil(timeConstantSeconds / frameDurationSeconds));
            return std::max<int32_t>(1, frames);
        }

        void ensureStorage()
        {
            auto const size = static_cast<size_t>(frameLength);
            if (configuredFrameLength == frameLength) {
                return;
            }

            currentValues.assign(size, Sample(0));
            startValues.assign(size, Sample(0));
            targetValues.assign(size, Sample(0));
            framesElapsed.assign(size, 0);
            framesTotal.assign(size, 1);
            configuredFrameLength = frameLength;
        }

        void reinitializeState()
        {
            auto rawSeed = seedTarget.load(std::memory_order_relaxed);
            if (rawSeed == 0) {
                rawSeed = 1;
            }
            seed = rawSeed;

            auto const startingFrom = startingFromTarget.load(std::memory_order_relaxed);
            auto const initialDeviation = std::max(Sample(0), initialDeviationTarget.load(std::memory_order_relaxed));

            for (size_t i = 0; i < currentValues.size(); ++i) {
                auto const initial = mirrorBipolar(startingFrom + signedRandom() * initialDeviation);
                currentValues[i] = initial;
                startValues[i] = initial;
                targetValues[i] = initial;
                framesElapsed[i] = 1;
                framesTotal[i] = 1;
            }
        }

        uint32_t fastRand()
        {
            uint32_t x = seed;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            seed = x == 0 ? 1 : x;
            return seed;
        }

        Sample random01()
        {
            return static_cast<Sample>(fastRand()) / static_cast<Sample>(4294967295.0);
        }

        Sample signedRandom()
        {
            return random01() * Sample(2) - Sample(1);
        }

        std::atomic<int64_t> frameLengthTarget{1};
        std::atomic<uint32_t> seedTarget{1};
        std::atomic<bool> absoluteTarget{false};
        std::atomic<bool> interpolationTarget{true};
        std::atomic<Sample> startingFromTarget{Sample(0)};
        std::atomic<Sample> initialDeviationTarget{Sample(0)};
        std::atomic<uint32_t> reinitRequest{0};

        int64_t frameLength = 1;
        int64_t configuredFrameLength = 0;
        uint32_t seed = 1;
        uint32_t appliedRequest = 0;
        bool absolute = false;
        bool interpolation = true;

        std::vector<Sample> currentValues;
        std::vector<Sample> startValues;
        std::vector<Sample> targetValues;
        std::vector<int32_t> framesElapsed;
        std::vector<int32_t> framesTotal;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);
    static_assert(std::atomic<uint32_t>::is_always_lock_free);

} // namespace elem
