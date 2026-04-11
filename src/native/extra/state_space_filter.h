#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <memory>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem {

template <typename FloatType>
struct StateSpaceFilterNode : public GraphNode<FloatType> {
    using GraphNode<FloatType>::GraphNode;
    using Sample = FloatType;

    StateSpaceFilterNode(NodeId id, double sr, int blockSize)
        : GraphNode<FloatType>(id, sr, blockSize) {}

    int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override {
        if (key == "cutoff_hz") {
            if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
            cutoffHz.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
        } else if (key == "slope") {
            if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
            slopeValue.store(std::max(2, std::min(8, static_cast<int>((js::Number) val))), std::memory_order_relaxed);
        } else if (key == "filterType") {
            if (!val.isString()) return ReturnCode::InvalidPropertyType();
            auto value = static_cast<std::string>(val);
            filterType.store(value == "lowpass" || value == "lp" ? 1 : 0, std::memory_order_relaxed);
        }
        return GraphNode<FloatType>::setProperty(key, val);
    }

    void process(BlockContext<FloatType> const& ctx) override {
        auto numIns = ctx.numInputChannels;
        auto numOuts = ctx.numOutputChannels;
        auto numSamples = ctx.numSamples;
        if (numIns < 1 || numOuts < 1 || numSamples == 0) return;

        auto* cutoffIn = ctx.inputData[0];
        auto* in = ctx.inputData[1];
        auto* out = ctx.outputData[0];
        auto sr = static_cast<Sample>(GraphNode<FloatType>::getSampleRate());
        auto filter = filterType.load(std::memory_order_relaxed);
        auto slope = std::max(2, std::min(8, slopeValue.load(std::memory_order_relaxed)));

        auto stages = std::max(1, slope / 2);

        for (size_t i = 0; i < numSamples; ++i) {
            auto sample = in[i];
            auto cutoffSample = std::max<Sample>(Sample(1), cutoffIn[i]);
            auto low = sample;
            for (int stage = 0; stage < stages; ++stage) {
                auto prev = lowState[stage];
                auto cutoffAlpha = Sample(1) - std::exp(-Sample(2) * Sample(3.14159265358979323846) * cutoffSample / sr);
                low = prev + cutoffAlpha * (low - prev);
                lowState[stage] = low;
            }
            auto high = sample - low;
            out[i] = filter == 0 ? high : low;
        }

        for (size_t c = 1; c < numOuts; ++c) {
            std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
        }
    }

private:
    std::atomic<Sample> cutoffHz{Sample(1000)};
    std::atomic<int> slopeValue{2};
    std::atomic<int> filterType{0};
    Sample lowState[4] = {Sample(0), Sample(0), Sample(0), Sample(0)};
};

} // namespace elem
