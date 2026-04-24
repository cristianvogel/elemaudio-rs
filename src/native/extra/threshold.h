#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct ThresholdNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_THRESHOLD = 0;
        static constexpr size_t CHILD_RESET = 1;
        static constexpr size_t CHILD_X = 2;
        static constexpr size_t NUM_CHILDREN = 3;

        ThresholdNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "hysteresis") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                hysteresisTarget.store(std::max<Sample>(Sample(0), static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "latch") {
                if (!val.isBool()) return ReturnCode::InvalidPropertyType();
                latchTarget.store(static_cast<bool>((js::Boolean) val), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            prevX = Sample(0);
            prevReset = Sample(0);
            held = false;
            armed = true;
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            if (numIns < NUM_CHILDREN || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const* thresholdSignal = ctx.inputData[CHILD_THRESHOLD];
            auto const* resetSignal = ctx.inputData[CHILD_RESET];
            auto const* xSignal = ctx.inputData[CHILD_X];
            auto* out = ctx.outputData[0];

            auto const hysteresis = hysteresisTarget.load(std::memory_order_relaxed);
            auto const latch = latchTarget.load(std::memory_order_relaxed);
            auto const halfHysteresis = hysteresis * Sample(0.5);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const threshold = thresholdSignal[i];
                auto const upper = threshold + halfHysteresis;
                auto const lower = threshold - halfHysteresis;
                auto const reset = resetSignal[i];
                auto const x = xSignal[i];

                auto const resetRising = (reset > Sample(0.5)) && (prevReset <= Sample(0.5));
                prevReset = reset;

                if (x <= lower) {
                    armed = true;
                }

                auto const crossedUp = armed && (prevX <= upper) && (x > upper);
                prevX = x;

                if (latch) {
                    if (resetRising) {
                        held = false;
                    }
                    if (crossedUp) {
                        held = true;
                        armed = false;
                    }
                    out[i] = held ? Sample(1) : Sample(0);
                } else {
                    out[i] = crossedUp ? Sample(1) : Sample(0);
                    if (crossedUp) {
                        armed = false;
                    }
                }
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        std::atomic<Sample> hysteresisTarget{Sample(0)};
        std::atomic<bool> latchTarget{false};

        Sample prevX = Sample(0);
        Sample prevReset = Sample(0);
        bool held = false;
        bool armed = true;
    };

} // namespace elem
