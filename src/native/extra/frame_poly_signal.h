#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct FramePolySignalNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_PHASE_SPREAD = 0;
        static constexpr size_t CHILD_RATE_SPREAD = 1;
        static constexpr size_t CHILD_RESET = 2;
        static constexpr size_t NUM_CHILDREN = 3;
        static constexpr Sample PI = Sample(3.14159265358979323846);

        FramePolySignalNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const raw = static_cast<int64_t>((js::Number) val);
                if (raw < 1 || (raw % 2) != 0) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLengthTarget.store(raw, std::memory_order_relaxed);
                reinitRequest.fetch_add(1, std::memory_order_relaxed);
            } else if (key == "bpm") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                bpmTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "path") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const path = static_cast<js::String>(val);
                if (!resources.has(path)) {
                    return ReturnCode::InvalidPropertyValue();
                }

                auto ref = resources.get(path);
                source_ = std::move(ref);
                hasExternalSource_ = true;
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength_ = std::max<int64_t>(2, frameLengthTarget.load(std::memory_order_relaxed));
            ensureStorage();
            initializePhases();
            appliedRequest_ = reinitRequest.fetch_add(0, std::memory_order_relaxed);
            previousResetPositive_ = false;
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto const numIns = ctx.numInputChannels;
            auto const numOuts = ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (numIns < NUM_CHILDREN || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const request = reinitRequest.load(std::memory_order_relaxed);
            auto const nextFrameLength = std::max<int64_t>(2, frameLengthTarget.load(std::memory_order_relaxed));
            if (request != appliedRequest_ || nextFrameLength != frameLength_) {
                frameLength_ = nextFrameLength;
                ensureStorage();
                initializePhases();
                appliedRequest_ = request;
            }

            auto const* phaseSpread = ctx.inputData[CHILD_PHASE_SPREAD];
            auto const* rateSpread = ctx.inputData[CHILD_RATE_SPREAD];
            auto const* reset = ctx.inputData[CHILD_RESET];
            auto* out = ctx.outputData[0];

            auto const sampleRate = Sample(GraphNode<FloatType>::getSampleRate());
            auto const frameDuration = static_cast<Sample>(frameLength_) / sampleRate;
            auto const baseRateHz = std::max(Sample(0), bpmTarget.load(std::memory_order_relaxed)) / Sample(60);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const resetPositive = reset[i] > Sample(0);
                if (resetPositive && !previousResetPositive_) {
                    initializePhases();
                }
                previousResetPositive_ = resetPositive;

                auto const track = currentTrack_;
                auto const phaseOffset = clampBipolar(phaseSpread[i]);
                auto const lookupPhase = wrap01(phases_[track] + phaseOffset);
                out[i] = sampleAtPhase(lookupPhase);

                auto const shapedRate = baseRateHz * std::exp2(Sample(4) * clampBipolar(rateSpread[i]));
                phases_[track] = wrap01(phases_[track] + shapedRate * frameDuration);
                currentTrack_ = (currentTrack_ + 1) % static_cast<size_t>(frameLength_);
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        static Sample clampBipolar(Sample x)
        {
            return std::max(Sample(-1), std::min(Sample(1), x));
        }

        static Sample wrap01(Sample x)
        {
            auto wrapped = std::fmod(x, Sample(1));
            if (wrapped < Sample(0)) {
                wrapped += Sample(1);
            }
            return wrapped;
        }

        void ensureStorage()
        {
            phases_.assign(static_cast<size_t>(frameLength_), Sample(0));
        }

        void initializePhases()
        {
            for (size_t i = 0; i < phases_.size(); ++i) {
                phases_[i] = static_cast<Sample>(i) / static_cast<Sample>(frameLength_);
            }
            currentTrack_ = 0;
        }

        Sample sampleAtPhase(Sample phase) const
        {
            if (hasExternalSource_ && source_ != nullptr) {
                auto const view = source_->getChannelData(0);
                auto const size = static_cast<int>(view.size());
                auto const* data = view.data();
                if (size > 0 && data != nullptr) {
                    auto const readPos = phase * Sample(size - 1);
                    auto const leftIndex = static_cast<int>(std::floor(readPos));
                    auto const rightIndex = leftIndex + 1;
                    auto const frac = readPos - std::floor(readPos);
                    auto const left = data[leftIndex % size];
                    auto const right = data[rightIndex % size];
                    return static_cast<Sample>(left + frac * (right - left));
                }
            }

            return -std::cos(Sample(2) * PI * phase);
        }

        std::atomic<int64_t> frameLengthTarget{2};
        std::atomic<Sample> bpmTarget{Sample(0)};
        std::atomic<uint32_t> reinitRequest{0};

        int64_t frameLength_ = 2;
        uint32_t appliedRequest_ = 0;
        std::vector<Sample> phases_;
        size_t currentTrack_ = 0;
        bool previousResetPositive_ = false;
        bool hasExternalSource_ = false;
        SharedResourcePtr source_;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);
    static_assert(std::atomic<uint32_t>::is_always_lock_free);

} // namespace elem
