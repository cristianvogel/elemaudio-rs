#pragma once

#include <algorithm>
#include <cstdint>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct SampleTimeNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (numOuts == 0 || numSamples == 0) {
                return;
            }

            auto* out = ctx.outputData[0];
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                out[i] = static_cast<FloatType>(sampleTime + static_cast<int64_t>(i));
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
            }
        }
    };

} // namespace elem
