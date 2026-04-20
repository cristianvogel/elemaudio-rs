#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct FrameSelectNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_CONDITION = 0;
        static constexpr size_t CHILD_WHEN_TRUE = 1;
        static constexpr size_t CHILD_WHEN_FALSE = 2;
        static constexpr size_t NUM_CHILDREN = 3;

        FrameSelectNode(NodeId id, double sr, int blockSize)
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
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(2, frameLengthTarget.load(std::memory_order_relaxed));
            latchedCondition = false;
            hasLatchedCondition = false;
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

            frameLength = std::max<int64_t>(2, frameLengthTarget.load(std::memory_order_relaxed));

            auto const* condition = ctx.inputData[CHILD_CONDITION];
            auto const* whenTrue = ctx.inputData[CHILD_WHEN_TRUE];
            auto const* whenFalse = ctx.inputData[CHILD_WHEN_FALSE];
            auto* out = ctx.outputData[0];
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);
                if (!hasLatchedCondition || frameOffset == 0) {
                    latchedCondition = condition[i] > Sample(0);
                    hasLatchedCondition = true;
                }

                out[i] = latchedCondition ? whenTrue[i] : whenFalse[i];
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

        std::atomic<int64_t> frameLengthTarget{2};

        int64_t frameLength = 2;
        bool latchedCondition = false;
        bool hasLatchedCondition = false;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
