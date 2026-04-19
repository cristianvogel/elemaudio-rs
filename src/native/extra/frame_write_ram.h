#pragma once

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "frame_ram_resource.h"

namespace elem
{
    template <typename FloatType>
    struct FrameWriteRAMNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_INPUT = 0;

        FrameWriteRAMNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const frameLength = static_cast<int64_t>((js::Number) val);
                if (frameLength < 1 || (frameLength % 2) != 0) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLength_ = frameLength;
                staging_.assign(static_cast<size_t>(frameLength_), Sample(0));
            } else if (key == "path") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const path = static_cast<js::String>(val);
                auto resource = resources.getTapResource(path, [this]() {
                    return std::make_shared<FrameRAMResource>(static_cast<size_t>(frameLength_));
                });

                framePath_ = path;
                ram_ = std::dynamic_pointer_cast<FrameRAMResource>(resource);
                if (!ram_ || ram_->numSamples() != static_cast<size_t>(frameLength_)) {
                    return ReturnCode::InvalidPropertyValue();
                }
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            std::fill(staging_.begin(), staging_.end(), Sample(0));
            hasCompleteFrame_ = false;
            if (ram_) {
                ram_->clear();
            }
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numIns = ctx.numInputChannels;
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;
            auto const* input = numIns > 0 ? ctx.inputData[CHILD_INPUT] : nullptr;

            if (numOuts == 0 || numSamples == 0) {
                return;
            }

            auto* out = ctx.outputData[0];
            if (!input || !ram_ || frameLength_ < 1) {
                std::fill_n(out, numSamples, Sample(0));
                for (size_t c = 1; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);
            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength_);
                if (frameOffset == 0 && hasCompleteFrame_) {
                    writeStagingToRAM();
                }

                staging_[static_cast<size_t>(frameOffset)] = input[i];
                if (frameOffset == frameLength_ - 1) {
                    hasCompleteFrame_ = true;
                }

                out[i] = input[i];
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

        void writeStagingToRAM()
        {
            temp_.resize(staging_.size());
            for (size_t i = 0; i < staging_.size(); ++i) {
                temp_[i] = static_cast<float>(staging_[i]);
            }
            ram_->writeFrame(temp_.data(), temp_.size());
        }

        int64_t frameLength_ = 2;
        std::string framePath_;
        std::shared_ptr<FrameRAMResource> ram_;
        std::vector<Sample> staging_ = std::vector<Sample>(2, Sample(0));
        std::vector<float> temp_;
        bool hasCompleteFrame_ = false;
    };

} // namespace elem
