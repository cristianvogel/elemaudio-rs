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

    template <typename FloatType>
    struct BoxSumNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;
        using BoxSum = signalsmith::envelopes::BoxSum<Sample>;

        BoxSumNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
            , maxWindowSamples(std::max<size_t>(1, static_cast<size_t>(std::ceil(sr * kMaxWindowSeconds))))
            , boxSum(std::make_unique<BoxSum>(static_cast<int>(maxWindowSamples)))
        {
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "windowHz") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();

                windowHzTarget.store(std::max<Sample>(Sample(1e-6), static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            currentWindowHz = windowHzTarget.load(std::memory_order_relaxed);
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

            if (numIns < 1 || numOuts < 1 || numSamples == 0 || !boxSum) {
                return;
            }

            auto sampleRate = GraphNode<FloatType>::getSampleRate();
            auto targetWindowHz = windowHzTarget.load(std::memory_order_relaxed);
            auto windowHzStep = (targetWindowHz - currentWindowHz) / static_cast<Sample>(numSamples);

            for (size_t i = 0; i < numSamples; ++i) {
                auto windowHz = std::max<Sample>(Sample(1e-6), currentWindowHz);
                auto width = windowHzToSamples(windowHz, sampleRate);
                auto input = ctx.inputData[0][i];
                auto sum = boxSum->readWrite(input, width);

                for (size_t c = 0; c < numOuts; ++c) {
                    ctx.outputData[c][i] = sum;
                }

                currentWindowHz += windowHzStep;
            }

            currentWindowHz = targetWindowHz;
        }

    private:
        static constexpr double kMaxWindowSeconds = 10.0;

        int windowHzToSamples(Sample windowHz, double sampleRate) const
        {
            auto width = static_cast<int>(std::lround(sampleRate / windowHz));
            width = std::max(width, 1);
            return std::min(width, static_cast<int>(maxWindowSamples));
        }

        std::atomic<Sample> windowHzTarget{Sample(10)};
        Sample currentWindowHz = Sample(10);
        size_t maxWindowSamples;
        std::unique_ptr<BoxSum> boxSum;
    };

} // namespace elem
