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
    struct FrameDelayNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_DELAY_FRAMES = 0;
        static constexpr size_t CHILD_INPUT = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        FrameDelayNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const frameLength = static_cast<int64_t>((js::Number) val);
                if (frameLength < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLengthTarget.store(frameLength, std::memory_order_relaxed);
            } else if (key == "maxframes") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const maxFrames = static_cast<int64_t>((js::Number) val);
                if (maxFrames < 0) {
                    return ReturnCode::InvalidPropertyValue();
                }

                maxFramesTarget.store(maxFrames, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
            maxFrames = std::max<int64_t>(0, maxFramesTarget.load(std::memory_order_relaxed));
            frameLengthInitialized = true;
            latchedDelayFrames = 0;
            writeFrameIndex = 0;
            ensureStorage(configuredChannels);
            std::fill(storage.begin(), storage.end(), Sample(0));
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

            auto const channelCount = std::min(numOuts, numIns - CHILD_INPUT);
            if (channelCount == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            if (!frameLengthInitialized) {
                frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
                maxFrames = std::max<int64_t>(0, maxFramesTarget.load(std::memory_order_relaxed));
                frameLengthInitialized = true;
            }

            ensureStorage(channelCount);
            if (storage.empty()) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const* delayFramesSignal = ctx.inputData[CHILD_DELAY_FRAMES];
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);

                if (frameOffset == 0) {
                    latchedDelayFrames = clampDelayFrames(delayFramesSignal[i]);
                    writeFrameIndex = floorDiv(t, frameLength);
                }

                auto const slotFrame = positiveMod(writeFrameIndex, frameCapacityFrames());
                auto const delayedFrame = writeFrameIndex - latchedDelayFrames;

                for (size_t c = 0; c < channelCount; ++c) {
                    auto const readValue = delayedFrame >= 0
                        ? storage[storageIndex(c, positiveMod(delayedFrame, frameCapacityFrames()), static_cast<size_t>(frameOffset))]
                        : Sample(0);

                    ctx.outputData[c][i] = readValue;
                    storage[storageIndex(c, slotFrame, static_cast<size_t>(frameOffset))] = ctx.inputData[c + CHILD_INPUT][i];
                }

                if (frameOffset == frameLength - 1) {
                    ++writeFrameIndex;
                }
            }

            for (size_t c = channelCount; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        static int64_t positiveMod(int64_t value, int64_t modulus)
        {
            auto const rem = value % modulus;
            return rem < 0 ? rem + modulus : rem;
        }

        static int64_t floorDiv(int64_t value, int64_t divisor)
        {
            auto q = value / divisor;
            auto r = value % divisor;
            if (r != 0 && ((r < 0) != (divisor < 0))) {
                --q;
            }
            return q;
        }

        int64_t clampDelayFrames(Sample delayFramesSignal) const
        {
            if (!std::isfinite(delayFramesSignal)) {
                return 0;
            }

            auto const floored = static_cast<int64_t>(std::floor(delayFramesSignal));
            return std::max<int64_t>(0, std::min<int64_t>(maxFrames, floored));
        }

        size_t frameCapacityFrames() const
        {
            return static_cast<size_t>(std::max<int64_t>(1, maxFrames + 1));
        }

        size_t storageIndex(size_t channel, int64_t frameSlot, size_t frameOffset) const
        {
            auto const frames = frameCapacityFrames();
            return ((channel * frames) + static_cast<size_t>(frameSlot)) * static_cast<size_t>(frameLength) + frameOffset;
        }

        void ensureStorage(size_t channels)
        {
            auto const desiredFrames = frameCapacityFrames();
            auto const desiredSize = channels * desiredFrames * static_cast<size_t>(frameLength);

            if (configuredChannels != channels || configuredFrameLength != frameLength || configuredMaxFrames != maxFrames) {
                storage.assign(desiredSize, Sample(0));
                configuredChannels = channels;
                configuredFrameLength = frameLength;
                configuredMaxFrames = maxFrames;
            }
        }

        std::atomic<int64_t> frameLengthTarget{1};
        std::atomic<int64_t> maxFramesTarget{1};

        int64_t frameLength = 1;
        int64_t maxFrames = 1;
        bool frameLengthInitialized = false;
        int64_t latchedDelayFrames = 0;
        int64_t writeFrameIndex = 0;

        size_t configuredChannels = 0;
        int64_t configuredFrameLength = 0;
        int64_t configuredMaxFrames = -1;
        std::vector<Sample> storage;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
