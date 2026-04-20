#pragma once

#include <cmath>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct MirrorAddNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_MIN_BOUND = 0;
        static constexpr size_t CHILD_MAX_BOUND = 1;
        static constexpr size_t CHILD_X = 2;
        static constexpr size_t CHILD_Y = 3;

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numIns = ctx.numInputChannels;
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (numIns < 4 || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const* minIn = ctx.inputData[CHILD_MIN_BOUND];
            auto const* maxIn = ctx.inputData[CHILD_MAX_BOUND];
            auto const* x = ctx.inputData[CHILD_X];
            auto const* y = ctx.inputData[CHILD_Y];
            auto* out = ctx.outputData[0];

            for (size_t i = 0; i < numSamples; ++i) {
                auto lower = minIn[i];
                auto upper = maxIn[i];
                if (!(upper > lower)) {
                    out[i] = lower;
                    continue;
                }

                auto const range = upper - lower;
                auto wrapped = std::fmod((x[i] + y[i]) - lower, range * Sample(2));
                if (wrapped < Sample(0)) {
                    wrapped += range * Sample(2);
                }
                auto mirrored = wrapped <= range ? wrapped : (range * Sample(2) - wrapped);
                out[i] = lower + mirrored;
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }
    };

} // namespace elem
