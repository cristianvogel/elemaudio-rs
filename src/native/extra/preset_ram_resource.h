#pragma once

#include <algorithm>
#include <cstddef>
#include <vector>

#include "../../vendor/elementary/runtime/elem/SharedResource.h"

namespace elem
{
    // Fixed-size multi-slot preset RAM.
    //
    // Represents `slots * frameLength` mono float samples laid out contiguously
    // so each slot is a fixed-length numeric frame. The storage is preallocated
    // at construction time and never resized at runtime, which keeps the audio
    // thread allocation-free while still letting multiple nodes share the same
    // preset bank through the runtime's `SharedResourceMap`.
    //
    // `getChannelData(0)` returns the full flat buffer so existing table-style
    // consumers can still see the full storage if they want. Slot-scoped reads
    // and writes go through `getSlot(...)` and `writeSlotFrame(...)`.
    class PresetRAMResource : public SharedResource {
    public:
        PresetRAMResource(size_t slots, size_t frameLength)
            : slots_(slots == 0 ? size_t(1) : slots)
            , frameLength_(frameLength == 0 ? size_t(1) : frameLength)
            , data_(slots_ * frameLength_, 0.0f)
        {}

        BufferView<float> getChannelData(size_t channelIndex) override
        {
            if (channelIndex != 0) {
                return BufferView<float>(nullptr, 0);
            }

            return BufferView<float>(data_.data(), data_.size());
        }

        size_t numChannels() override { return 1; }
        size_t numSamples() override { return data_.size(); }

        size_t slots() const { return slots_; }
        size_t frameLength() const { return frameLength_; }

        float const* getSlot(size_t slot) const
        {
            if (slot >= slots_ || data_.empty()) {
                return nullptr;
            }

            return data_.data() + slot * frameLength_;
        }

        float* getSlotMutable(size_t slot)
        {
            if (slot >= slots_ || data_.empty()) {
                return nullptr;
            }

            return data_.data() + slot * frameLength_;
        }

        void writeSlotFrame(size_t slot, float const* src, size_t count)
        {
            auto* dst = getSlotMutable(slot);
            if (dst == nullptr || src == nullptr) {
                return;
            }

            auto const n = std::min(count, frameLength_);
            std::copy_n(src, n, dst);
            if (n < frameLength_) {
                std::fill(dst + n, dst + frameLength_, 0.0f);
            }
        }

        void clear()
        {
            std::fill(data_.begin(), data_.end(), 0.0f);
        }

    private:
        size_t slots_ = 1;
        size_t frameLength_ = 1;
        std::vector<float> data_;
    };

} // namespace elem
