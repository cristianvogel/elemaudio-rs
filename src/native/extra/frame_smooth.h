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
    struct FrameSmoothNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_TIME_CONSTANT = 0;
        static constexpr size_t CHILD_TIME_SHAPER = 1;
        static constexpr size_t CHILD_INPUT = 2;
        static constexpr size_t NUM_CHILDREN = 3;

        FrameSmoothNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                if (raw < 1 || (raw % 2) != 0) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLengthTarget.store(raw, std::memory_order_relaxed);
                reinitRequest.fetch_add(1, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(2, frameLengthTarget.load(std::memory_order_relaxed));
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
            auto const nextFrameLength = std::max<int64_t>(2, frameLengthTarget.load(std::memory_order_relaxed));
            if (request != appliedRequest || nextFrameLength != frameLength) {
                frameLength = nextFrameLength;
                ensureStorage();
                reinitializeState();
                appliedRequest = request;
            }

            auto const* timeConstantSignal = ctx.inputData[CHILD_TIME_CONSTANT];
            auto const* timeShaperSignal = ctx.inputData[CHILD_TIME_SHAPER];
            auto const* inputSignal = ctx.inputData[CHILD_INPUT];
            auto* out = ctx.outputData[0];
            auto const sampleRate = Sample(GraphNode<FloatType>::getSampleRate());
            auto const frameDuration = static_cast<Sample>(frameLength) / sampleRate;
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const track = static_cast<size_t>(positiveMod(t, frameLength));

                auto const shapedTimeConstant = std::max(Sample(0), timeConstantSignal[i]) * inverseShapeScale(timeShaperSignal[i]);

                if (!hasTarget[track] || inputSignal[i] != targetValues[track]) {
                    startValues[track] = currentValues[track];
                    targetValues[track] = inputSignal[i];
                    framesElapsed[track] = 0;
                    framesTotal[track] = durationFrames(shapedTimeConstant, frameDuration);
                    hasTarget[track] = true;
                    if (framesTotal[track] == 1) {
                        currentValues[track] = targetValues[track];
                    }
                }

                Sample raw = currentValues[track];
                auto const total = std::max<int32_t>(1, framesTotal[track]);
                if (total > 1) {
                    auto const elapsed = std::min<int32_t>(framesElapsed[track] + 1, total);
                    auto const phase = static_cast<Sample>(elapsed) / static_cast<Sample>(total);
                    auto const eased = Sample(0.5) - Sample(0.5) * std::cos(phase * Sample(3.14159265358979323846));
                    raw = startValues[track] + (targetValues[track] - startValues[track]) * eased;
                    currentValues[track] = raw;
                    framesElapsed[track] = elapsed;
                } else {
                    raw = currentValues[track];
                    framesElapsed[track] = 1;
                }

                out[i] = raw;
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

        static Sample inverseShapeScale(Sample shaper)
        {
            return static_cast<Sample>(std::exp2(Sample(-4) * clampShaper(shaper)));
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
            framesElapsed.assign(size, 1);
            framesTotal.assign(size, 1);
            hasTarget.assign(size, false);
            configuredFrameLength = frameLength;
        }

        void reinitializeState()
        {
            std::fill(currentValues.begin(), currentValues.end(), Sample(0));
            std::fill(startValues.begin(), startValues.end(), Sample(0));
            std::fill(targetValues.begin(), targetValues.end(), Sample(0));
            std::fill(framesElapsed.begin(), framesElapsed.end(), 1);
            std::fill(framesTotal.begin(), framesTotal.end(), 1);
            std::fill(hasTarget.begin(), hasTarget.end(), false);
        }

        std::atomic<int64_t> frameLengthTarget{2};
        std::atomic<uint32_t> reinitRequest{0};

        int64_t frameLength = 2;
        int64_t configuredFrameLength = 0;
        uint32_t appliedRequest = 0;

        std::vector<Sample> currentValues;
        std::vector<Sample> startValues;
        std::vector<Sample> targetValues;
        std::vector<int32_t> framesElapsed;
        std::vector<int32_t> framesTotal;
        std::vector<bool> hasTarget;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);
    static_assert(std::atomic<uint32_t>::is_always_lock_free);

} // namespace elem
