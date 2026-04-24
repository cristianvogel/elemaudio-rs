#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/SingleWriterSingleReaderQueue.h"

namespace elem
{
    template <typename FloatType>
    struct FrameScopeNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;

        static constexpr size_t MAX_CHANNELS = 8;
        // frameScope can produce many completed frames between main-thread event
        // polls when frameLength is very short (for example 8 samples). Keep a
        // larger power-of-two queue so short frame scopes survive the browser
        // polling cadence instead of dropping every event.
        static constexpr size_t FRAME_QUEUE_CAPACITY = 1024;

        struct FrameReadout {
            int64_t frameStart = 0;
            size_t slot = 0;
            size_t channels = 0;
        };

        FrameScopeNode(NodeId id, FloatType const sr, int const blockSize)
            : GraphNode<FloatType>::GraphNode(id, sr, blockSize)
            , completedFrames(FRAME_QUEUE_CAPACITY)
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
            } else if (key == "name") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
            frameLengthInitialized = true;
            writeFrameIndex = 0;
            currentFrameNumber = 0;
            configuredChannels = 0;
            configuredFrameLength = 0;
            storage.clear();

            FrameReadout ro;
            while (completedFrames.pop(ro)) {
            }
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numIns = std::min<size_t>(ctx.numInputChannels, MAX_CHANNELS);
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (numIns < 1 || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            if (!frameLengthInitialized) {
                frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
                frameLengthInitialized = true;
            }

            ensureStorage(numIns);

            std::copy_n(ctx.inputData[0], numSamples, ctx.outputData[0]);
            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
            }

            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);

                if (frameOffset == 0) {
                    currentFrameNumber = floorDiv(t, frameLength);
                }

                auto const slot = frameSlot(currentFrameNumber);
                for (size_t c = 0; c < numIns; ++c) {
                    storage[storageIndex(slot, c, static_cast<size_t>(frameOffset))] = ctx.inputData[c][i];
                }

                if (frameOffset == frameLength - 1) {
                    (void) completedFrames.push(FrameReadout{
                        t - frameOffset,
                        slot,
                        numIns,
                    });
                }
            }
        }

        void processEvents(std::function<void(std::string const&, js::Value)>& eventHandler) override
        {
            if (completedFrames.size() <= 0 || configuredChannels == 0) {
                return;
            }

            FrameReadout latest;
            while (completedFrames.size() > 0) {
                if (!completedFrames.pop(latest)) {
                    return;
                }
            }

            auto const size = static_cast<size_t>(frameLength);
            js::Array scopeData(latest.channels);
            for (size_t c = 0; c < latest.channels; ++c) {
                js::Array channel(size);
                for (size_t i = 0; i < size; ++i) {
                    channel[i] = static_cast<double>(storage[storageIndex(latest.slot, c, i)]);
                }
                scopeData[c] = std::move(channel);
            }

            eventHandler("scope", js::Object({
                {"source", GraphNode<FloatType>::getPropertyWithDefault("name", js::Value())},
                {"frameLength", static_cast<double>(frameLength)},
                {"frameStart", static_cast<double>(latest.frameStart)},
                {"data", std::move(scopeData)},
            }));
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

        size_t frameSlot(int64_t frameNumber) const
        {
            auto const capacity = static_cast<int64_t>(FRAME_QUEUE_CAPACITY);
            auto const slot = frameNumber % capacity;
            return static_cast<size_t>(slot < 0 ? slot + capacity : slot);
        }

        size_t storageIndex(size_t slot, size_t channel, size_t frameOffset) const
        {
            return ((slot * configuredChannels) + channel) * static_cast<size_t>(frameLength) + frameOffset;
        }

        void ensureStorage(size_t channels)
        {
            if (configuredChannels == channels && configuredFrameLength == frameLength) {
                return;
            }

            configuredChannels = channels;
            configuredFrameLength = frameLength;
            storage.assign(
                FRAME_QUEUE_CAPACITY * configuredChannels * static_cast<size_t>(frameLength),
                FloatType(0)
            );
        }

        std::atomic<int64_t> frameLengthTarget{256};
        int64_t frameLength = 256;
        bool frameLengthInitialized = false;
        int64_t currentFrameNumber = 0;
        int64_t writeFrameIndex = 0;
        size_t configuredChannels = 0;
        int64_t configuredFrameLength = 0;
        std::vector<FloatType> storage;
        SingleWriterSingleReaderQueue<FrameReadout> completedFrames;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
