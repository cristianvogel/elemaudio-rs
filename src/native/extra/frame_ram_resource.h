#pragma once

#include <algorithm>
#include <vector>

#include "../../vendor/elementary/runtime/elem/SharedResource.h"

namespace elem
{
    class FrameRAMResource : public SharedResource {
    public:
        explicit FrameRAMResource(size_t numSamples)
            : data_(numSamples, 0.0f)
        {}

        BufferView<float> getChannelData(size_t channelIndex) override
        {
            if (channelIndex == 0) {
                return BufferView<float>(data_.data(), data_.size());
            }

            return BufferView<float>(nullptr, 0);
        }

        size_t numChannels() override
        {
            return 1;
        }

        size_t numSamples() override
        {
            return data_.size();
        }

        void writeFrame(float const* src, size_t count)
        {
            auto const n = std::min(count, data_.size());
            std::copy_n(src, n, data_.begin());
            if (n < data_.size()) {
                std::fill(data_.begin() + static_cast<std::ptrdiff_t>(n), data_.end(), 0.0f);
            }
        }

        void clear()
        {
            std::fill(data_.begin(), data_.end(), 0.0f);
        }

    private:
        std::vector<float> data_;
    };

} // namespace elem
