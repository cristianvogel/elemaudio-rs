#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#include <atomic>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "preset_ram_resource.h"

namespace elem
{
    // PresetWrite: frame-committed writer into one slot of a multi-slot preset
    // RAM bank.
    //
    // Child layout:
    //   [0] slot  - preset slot index, clamped to [0, slots - 1]
    //   [1] x     - frame-domain signal to capture, one full frame per slot
    //
    // Semantics:
    //   - The frame boundary is derived from `ctx.userData` sample time, like
    //     the other frame-domain extras.
    //   - `slot` is latched at the start of every frame.
    //   - The input frame is captured into a staging buffer; on the next frame
    //     boundary, the completed staging is committed into the slot.
    //   - Output simply passes `x` through so the writer can be kept alive in
    //     the graph via `el.mul(0, writer)` without affecting audio.
    template <typename FloatType>
    struct PresetWriteNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_SLOT = 0;
        static constexpr size_t CHILD_INPUT = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        PresetWriteNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                if (raw < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLength_ = static_cast<size_t>(raw);
                staging_.assign(frameLength_, Sample(0));
                hasFrameLength_ = true;
                auto rc = bindResourceIfReady(resources);
                if (rc != ReturnCode::Ok()) {
                    return rc;
                }
            } else if (key == "slots") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                if (raw < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                slots_ = static_cast<size_t>(raw);
                hasSlots_ = true;
                auto rc = bindResourceIfReady(resources);
                if (rc != ReturnCode::Ok()) {
                    return rc;
                }
            } else if (key == "writecounter") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                writeCounterTarget_.store(raw, std::memory_order_relaxed);
            } else if (key == "path") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }

                path_ = static_cast<js::String>(val);
                hasPath_ = true;
                auto rc = bindResourceIfReady(resources);
                if (rc != ReturnCode::Ok()) {
                    return rc;
                }
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            std::fill(staging_.begin(), staging_.end(), Sample(0));
            hasCompleteFrame_ = false;
            latchedSlot_ = 0;
            armedWrite_ = false;
            currentWriteCounter_ = writeCounterTarget_.load(std::memory_order_relaxed);
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numIns = ctx.numInputChannels;
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (numOuts == 0 || numSamples == 0) {
                return;
            }

            auto* out = ctx.outputData[0];

            if (numIns < NUM_CHILDREN || !ram_ || frameLength_ == 0) {
                std::fill_n(out, numSamples, Sample(0));
                for (size_t c = 1; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const* slotSignal = ctx.inputData[CHILD_SLOT];
            auto const* input = ctx.inputData[CHILD_INPUT];

            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);
            auto const frameLength = static_cast<int64_t>(frameLength_);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);

                if (frameOffset == 0) {
                    auto const targetCounter = writeCounterTarget_.load(std::memory_order_relaxed);
                    if (targetCounter != currentWriteCounter_) {
                        currentWriteCounter_ = targetCounter;
                        armedWrite_ = true;
                    }

                    if (hasCompleteFrame_ && armedWrite_) {
                        writeStagingToRAM();
                        armedWrite_ = false;
                    }
                    latchedSlot_ = clampSlot(slotSignal[i]);
                    hasCompleteFrame_ = false;
                }

                staging_[static_cast<size_t>(frameOffset)] = input[i];

                if (frameOffset == frameLength - 1) {
                    hasCompleteFrame_ = true;
                }

                out[i] = input[i];
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        int bindResourceIfReady(SharedResourceMap& resources)
        {
            if (!hasPath_ || !hasFrameLength_ || !hasSlots_) {
                return ReturnCode::Ok();
            }

            auto const localSlots = slots_;
            auto const localFrameLength = frameLength_;
            auto resource = resources.getTapResource(path_, [localSlots, localFrameLength]() {
                return std::make_shared<PresetRAMResource>(localSlots, localFrameLength);
            });

            auto presetRam = std::dynamic_pointer_cast<PresetRAMResource>(resource);
            if (!presetRam || presetRam->slots() != slots_ || presetRam->frameLength() != frameLength_) {
                return ReturnCode::InvalidPropertyValue();
            }

            ram_ = std::move(presetRam);
            return ReturnCode::Ok();
        }

        static int64_t positiveMod(int64_t value, int64_t modulus)
        {
            auto const rem = value % modulus;
            return rem < 0 ? rem + modulus : rem;
        }

        size_t clampSlot(Sample value) const
        {
            if (!std::isfinite(static_cast<double>(value))) {
                return 0;
            }

            auto const floored = static_cast<int64_t>(std::floor(static_cast<double>(value)));
            if (floored <= 0) {
                return 0;
            }

            auto const maxSlot = static_cast<int64_t>(slots_ > 0 ? slots_ - 1 : 0);
            if (floored >= maxSlot) {
                return static_cast<size_t>(maxSlot);
            }

            return static_cast<size_t>(floored);
        }

        void writeStagingToRAM()
        {
            if (!ram_) {
                return;
            }

            temp_.resize(staging_.size());
            for (size_t i = 0; i < staging_.size(); ++i) {
                temp_[i] = static_cast<float>(staging_[i]);
            }

            ram_->writeSlotFrame(latchedSlot_, temp_.data(), temp_.size());
        }

        size_t frameLength_ = 1;
        size_t slots_ = 1;
        std::string path_;
        bool hasPath_ = false;
        bool hasFrameLength_ = false;
        bool hasSlots_ = false;
        std::shared_ptr<PresetRAMResource> ram_;
        std::vector<Sample> staging_ = std::vector<Sample>(1, Sample(0));
        std::vector<float> temp_;
        size_t latchedSlot_ = 0;
        bool hasCompleteFrame_ = false;
        std::atomic<int64_t> writeCounterTarget_{0};
        int64_t currentWriteCounter_ = 0;
        bool armedWrite_ = false;
    };

} // namespace elem
