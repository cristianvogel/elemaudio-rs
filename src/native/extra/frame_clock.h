#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct FrameClockNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "period") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const period = static_cast<int64_t>((js::Number) val);
                if (period < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                period_.store(period, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override {}

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto* out = ctx.outputData[0];
            auto const numSamples = ctx.numSamples;
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);
            auto const period = std::max<int64_t>(1, period_.load(std::memory_order_relaxed));

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                out[i] = (t % period) == 0 ? FloatType(1) : FloatType(0);
            }
        }

    private:
        std::atomic<int64_t> period_ = 1;
        static_assert(std::atomic<int64_t>::is_always_lock_free);
    };

} // namespace elem
