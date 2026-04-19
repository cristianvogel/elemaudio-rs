#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/SingleWriterSingleReaderQueue.h"

namespace elem
{
    template <typename FloatType>
    struct FrameValueNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_INDEX = 0;
        static constexpr size_t CHILD_INPUT = 1;
        static constexpr size_t NUM_CHILDREN = 2;

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
            latchedIndex = 0;
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

            if (!frameLengthInitialized) {
                frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
                frameLengthInitialized = true;
            }

            auto const* indexSignal = ctx.inputData[CHILD_INDEX];
            auto const* inputSignal = ctx.inputData[CHILD_INPUT];
            auto* out = ctx.outputData[0];
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);

                if (frameOffset == 0) {
                    latchedIndex = clampIndex(indexSignal[i]);
                }

                auto const x = inputSignal[i];
                out[i] = x;

                if (frameOffset == latchedIndex) {
                    (void) readoutQueue.push({
                        x,
                        static_cast<double>(latchedIndex),
                        static_cast<double>(t - frameOffset),
                    });
                }
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

        void processEvents(std::function<void(std::string const&, js::Value)>& eventHandler) override
        {
            if (readoutQueue.size() <= 0) {
                return;
            }

            ValueReadout ro;
            while (readoutQueue.size() > 0) {
                if (!readoutQueue.pop(ro)) {
                    return;
                }
            }

            eventHandler("frameValue", js::Object({
                {"source", GraphNode<FloatType>::getPropertyWithDefault("name", js::Value())},
                {"data", ro.val},
                {"index", ro.index},
                {"frameStart", ro.frameStart},
            }));
        }

    private:
        struct ValueReadout {
            FloatType val = 0;
            double index = 0;
            double frameStart = 0;
        };

        static int64_t positiveMod(int64_t value, int64_t modulus)
        {
            auto const rem = value % modulus;
            return rem < 0 ? rem + modulus : rem;
        }

        int64_t clampIndex(Sample index) const
        {
            if (!std::isfinite(index)) {
                return 0;
            }

            auto const floored = static_cast<int64_t>(std::floor(index));
            return std::max<int64_t>(0, std::min<int64_t>(frameLength - 1, floored));
        }

        std::atomic<int64_t> frameLengthTarget{1};
        int64_t frameLength = 1;
        bool frameLengthInitialized = false;
        int64_t latchedIndex = 0;
        SingleWriterSingleReaderQueue<ValueReadout> readoutQueue;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
