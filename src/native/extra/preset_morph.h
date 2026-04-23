#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "preset_ram_resource.h"

namespace elem
{
    // PresetMorph: sample-rate linear crossfade between two preset slots read
    // by the same normalized phase.
    //
    // Child layout:
    //   [0] slotA  - first slot index, clamped to [0, slots - 1]
    //   [1] slotB  - second slot index, clamped to [0, slots - 1]
    //   [2] mix    - crossfade amount; 0 -> slotA, 1 -> slotB, clamped to [0, 1]
    //   [3] phase  - normalized phase in [0, 1] into both slots' frames
    //
    // A pure selection is just `mix = 0` or `mix = 1`, so this single node
    // covers both morphing and hard selection between banked presets.
    template <typename FloatType>
    struct PresetMorphNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_SLOT_A = 0;
        static constexpr size_t CHILD_SLOT_B = 1;
        static constexpr size_t CHILD_MIX = 2;
        static constexpr size_t CHILD_PHASE = 3;
        static constexpr size_t NUM_CHILDREN = 4;

        PresetMorphNode(NodeId id, double sr, int blockSize)
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

            auto const* slotASignal = ctx.inputData[CHILD_SLOT_A];
            auto const* slotBSignal = ctx.inputData[CHILD_SLOT_B];
            auto const* mixSignal = ctx.inputData[CHILD_MIX];
            auto const* phaseSignal = ctx.inputData[CHILD_PHASE];

            for (size_t i = 0; i < numSamples; ++i) {
                auto const slotA = clampSlot(slotASignal[i]);
                auto const slotB = clampSlot(slotBSignal[i]);
                auto mix = static_cast<double>(mixSignal[i]);

                if (!std::isfinite(mix)) {
                    mix = 0.0;
                }
                mix = std::clamp(mix, 0.0, 1.0);

                auto const* dataA = ram_->getSlot(slotA);
                auto const* dataB = ram_->getSlot(slotB);
                if (dataA == nullptr || dataB == nullptr) {
                    out[i] = Sample(0);
                    continue;
                }

                auto const phase = phaseSignal[i];
                auto const a = lerpReadSlot(dataA, phase);
                auto const b = lerpReadSlot(dataB, phase);
                out[i] = static_cast<Sample>(static_cast<double>(a) + mix * (static_cast<double>(b) - static_cast<double>(a)));
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
        std::string path_;
        bool hasPath_ = false;
        bool hasFrameLength_ = false;
        bool hasSlots_ = false;
        std::shared_ptr<PresetRAMResource> ram_;
    };

} // namespace elem
