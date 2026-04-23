#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "preset_ram_resource.h"

namespace elem
{
    // PresetRead: table-style reader that samples one preset slot by a
    // normalized phase, like `el.table`, but bound to a multi-slot preset bank.
    //
    // Child layout:
    //   [0] slot   - preset slot index, clamped to [0, slots - 1]
    //   [1] phase  - normalized phase in [0, 1] into the selected slot's frame
    //
    // Semantics:
    //   - `slot` is read per sample and clamped. There is no frame latching
    //     for the reader: changing the slot returns the new slot's samples
    //     immediately because this node is used for parameter morphing and
    //     scene selection, not audio loop playback.
    //   - `phase` wraps/clamps into [0, 1] and linearly interpolates between
    //     the two neighboring frame samples within the selected slot.
    //   - Output is mono. Extra output channels are zeroed.
    template <typename FloatType>
    struct PresetReadNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_SLOT = 0;
        static constexpr size_t CHILD_PHASE = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        PresetReadNode(NodeId id, double sr, int blockSize)
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
            } else if (key == "slots") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                if (raw < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                slots_ = static_cast<size_t>(raw);
            } else if (key == "path") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const path = static_cast<js::String>(val);
                auto const localSlots = slots_;
                auto const localFrameLength = frameLength_;
                auto resource = resources.getTapResource(path, [localSlots, localFrameLength]() {
                    return std::make_shared<PresetRAMResource>(localSlots, localFrameLength);
                });

                auto presetRam = std::dynamic_pointer_cast<PresetRAMResource>(resource);
                if (!presetRam || presetRam->slots() != slots_ || presetRam->frameLength() != frameLength_) {
                    return ReturnCode::InvalidPropertyValue();
                }

                ram_ = std::move(presetRam);
            }

            return GraphNode<FloatType>::setProperty(key, val);
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
            auto const* phaseSignal = ctx.inputData[CHILD_PHASE];

            for (size_t i = 0; i < numSamples; ++i) {
                auto const slot = clampSlot(slotSignal[i]);
                auto const* slotData = ram_->getSlot(slot);
                if (slotData == nullptr) {
                    out[i] = Sample(0);
                    continue;
                }

                out[i] = lerpReadSlot(slotData, phaseSignal[i]);
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

        Sample lerpReadSlot(float const* slotData, Sample rawPhase) const
        {
            auto phase = static_cast<double>(rawPhase);
            if (!std::isfinite(phase)) {
                phase = 0.0;
            }

            phase = std::clamp(phase, 0.0, 1.0);

            auto const readPos = phase * static_cast<double>(frameLength_ - 1);
            auto const left = static_cast<size_t>(std::floor(readPos));
            auto const leftClamped = std::min(left, frameLength_ - 1);
            auto const rightClamped = std::min(leftClamped + 1, frameLength_ - 1);
            auto const frac = readPos - static_cast<double>(leftClamped);

            auto const a = static_cast<double>(slotData[leftClamped]);
            auto const b = static_cast<double>(slotData[rightClamped]);
            return static_cast<Sample>(a + frac * (b - a));
        }

    private:
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

        size_t frameLength_ = 1;
        size_t slots_ = 1;
        std::shared_ptr<PresetRAMResource> ram_;
    };

} // namespace elem
