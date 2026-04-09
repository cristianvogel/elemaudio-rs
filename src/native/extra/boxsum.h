#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <memory>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/third-party/signalsmith-stretch/dsp/envelopes.h"

namespace elem
{

    template <typename FloatType, bool Average>
    struct BoxWindowNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;
        using BoxSum = signalsmith::envelopes::BoxSum<Sample>;

        BoxWindowNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
            , maxWindowSamples(std::max<size_t>(1, static_cast<size_t>(std::ceil(sr * kMaxWindowSeconds))))
            , boxSum(std::make_unique<BoxSum>(static_cast<int>(maxWindowSamples)))
        {
        }

        void reset() override
        {
            if (boxSum) {
                boxSum->reset(Sample(0));
            }
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            for (size_t c = 0; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
            }

            if (numIns < 2 || numOuts < 1 || numSamples == 0 || !boxSum) {
                return;
            }

            auto windowSamplesIn = ctx.inputData[0];
            auto inputData = ctx.inputData[1];

            for (size_t i = 0; i < numSamples; ++i) {
                auto width = windowSamplesToSamples(windowSamplesIn[i]);
                auto input = inputData[i];
                auto sum = boxSum->readWrite(input, width);
                auto output = Average ? (sum / static_cast<Sample>(width)) : sum;

                for (size_t c = 0; c < numOuts; ++c) {
                    ctx.outputData[c][i] = output;
                }
            }
        }

    private:
        static constexpr double kMaxWindowSeconds = 10.0;

        int windowSamplesToSamples(Sample windowSamples) const
        {
            auto width = static_cast<int>(std::lround(windowSamples));
            width = std::max(width, 1);
            return std::min(width, static_cast<int>(maxWindowSamples));
        }

        size_t maxWindowSamples;
        std::unique_ptr<BoxSum> boxSum;
    };

    template <typename FloatType>
    using BoxSumNode = BoxWindowNode<FloatType, false>;

    template <typename FloatType>
    using BoxAverageNode = BoxWindowNode<FloatType, true>;

} // namespace elem
