#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct FrameDerivativeNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_INPUT = 0;
        static constexpr size_t NUM_CHILDREN = 1;
        static constexpr int64_t STORAGE_FRAMES = 2;

        FrameDerivativeNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const nextFrameLength = static_cast<int64_t>((js::Number) val);
                if (nextFrameLength < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLengthTarget.store(nextFrameLength, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
            frameLengthInitialized = true;
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

            auto const channelCount = std::min(numOuts, numIns);
            if (channelCount == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            if (!frameLengthInitialized) {
                frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
                frameLengthInitialized = true;
            }

            ensureStorage(channelCount);
            if (storage.empty()) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);

                if (frameOffset == 0) {
                    writeFrameIndex = floorDiv(t, frameLength);
                }

                auto const currentSlot = positiveMod(writeFrameIndex, STORAGE_FRAMES);
                auto const previousFrame = writeFrameIndex - 1;

                for (size_t c = 0; c < channelCount; ++c) {
                    auto const current = ctx.inputData[c + CHILD_INPUT][i];
                    auto const delayed = previousFrame >= 0
                        ? storage[storageIndex(c, positiveMod(previousFrame, STORAGE_FRAMES), static_cast<size_t>(frameOffset))]
                        : Sample(0);

                    ctx.outputData[c][i] = current - delayed;
                    storage[storageIndex(c, currentSlot, static_cast<size_t>(frameOffset))] = current;
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

        size_t storageIndex(size_t channel, int64_t frameSlot, size_t frameOffset) const
        {
            return ((channel * static_cast<size_t>(STORAGE_FRAMES)) + static_cast<size_t>(frameSlot))
                * static_cast<size_t>(frameLength)
                + frameOffset;
        }

        void ensureStorage(size_t channels)
        {
            auto const desiredSize = channels * static_cast<size_t>(STORAGE_FRAMES) * static_cast<size_t>(frameLength);

            if (configuredChannels != channels || configuredFrameLength != frameLength) {
                storage.assign(desiredSize, Sample(0));
                configuredChannels = channels;
                configuredFrameLength = frameLength;
            }
        }

        std::atomic<int64_t> frameLengthTarget{1};

        int64_t frameLength = 1;
        bool frameLengthInitialized = false;
        int64_t writeFrameIndex = 0;

        size_t configuredChannels = 0;
        int64_t configuredFrameLength = 0;
        std::vector<Sample> storage;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
