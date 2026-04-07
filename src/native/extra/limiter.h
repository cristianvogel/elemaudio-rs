#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <optional>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/third-party/signalsmith-basics/limiter.h"

namespace elem
{

    template <typename FloatType>
    struct LimiterNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        LimiterNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "maxDelayMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                maxDelayMsTarget = static_cast<double>((js::Number) val);
                configuredChannels = 0;
            } else if (key == "inputGain") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().inputGain = static_cast<double>((js::Number) val);
            } else if (key == "outputLimit") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().outputLimit = static_cast<double>((js::Number) val);
            } else if (key == "attackMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().attackMs = static_cast<double>((js::Number) val);
            } else if (key == "holdMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().holdMs = static_cast<double>((js::Number) val);
            } else if (key == "releaseMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().releaseMs = static_cast<double>((js::Number) val);
            } else if (key == "smoothingStages") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().smoothingStages = static_cast<int>((js::Number) val);
            } else if (key == "linkChannels") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                limiter().linkChannels = static_cast<double>((js::Number) val);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            configuredChannels = 0;
            limiter().reset();
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            if (numIns == 0 || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            auto channelCount = std::min(numIns, numOuts);
            ensureConfigured(channelCount);

            limiter().process(ctx.inputData, ctx.outputData, numSamples);

            for (size_t c = channelCount; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
            }
        }

    private:
        void ensureConfigured(size_t channels)
        {
            if (configuredChannels == channels) {
                return;
            }

            limiter().configure(GraphNode<FloatType>::getSampleRate(), GraphNode<FloatType>::getBlockSize(), channels);
            configuredChannels = channels;
        }

        signalsmith::basics::LimiterDouble& limiter()
        {
            if (!limiterEffect || limiterEffectMaxDelayMs != maxDelayMsTarget) {
                limiterEffect.emplace(maxDelayMsTarget);
                limiterEffectMaxDelayMs = maxDelayMsTarget;
            }

            return *limiterEffect;
        }

        size_t configuredChannels = 0;
        double maxDelayMsTarget = 100;
        double limiterEffectMaxDelayMs = 0;
        std::optional<signalsmith::basics::LimiterDouble> limiterEffect;
    };

} // namespace elem
