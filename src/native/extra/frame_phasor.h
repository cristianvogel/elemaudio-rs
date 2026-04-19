#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    template <typename FloatType>
    struct FramePhasorNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_OFFSET = 0;
        static constexpr size_t CHILD_SHIFT = 1;
        static constexpr size_t CHILD_TILT = 2;
        static constexpr size_t CHILD_SCALE = 3;
        static constexpr size_t NUM_CHILDREN = 4;

        FramePhasorNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const frameLength = static_cast<int64_t>((js::Number) val);
                if (frameLength < 1) {
                    return ReturnCode::InvalidPropertyValue();
                }

                frameLengthTarget.store(frameLength, std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
            frameLengthInitialized = true;
            offsetLatched = Sample(0);
            shiftLatched = 0;
            tiltLatched = Sample(0);
            scaleLatched = Sample(1);
            hasLatchedFrameControls = false;
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

            if (!frameLengthInitialized) {
                frameLength = std::max<int64_t>(1, frameLengthTarget.load(std::memory_order_relaxed));
                frameLengthInitialized = true;
            }

            auto const* offsetSignal = ctx.inputData[CHILD_OFFSET];
            auto const* shiftSignal = ctx.inputData[CHILD_SHIFT];
            auto const* tiltSignal = ctx.inputData[CHILD_TILT];
            auto const* scaleSignal = ctx.inputData[CHILD_SCALE];
            auto* out = ctx.outputData[0];

            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);
                auto const frameStart = !hasLatchedFrameControls || frameOffset == 0;

                if (frameStart) {
                    offsetLatched = offsetSignal[i];
                    shiftLatched = clampShift(shiftSignal[i]);
                    tiltLatched = tiltSignal[i];
                    scaleLatched = scaleSignal[i];
                    hasLatchedFrameControls = true;
                }

                // Horizontal shift rotates the phasor position within the frame.
                // Latched on frame boundaries, clamped to [0, frameLength - 1].
                auto const shiftedOffset = positiveMod(frameOffset + shiftLatched, frameLength);
                auto const basePhase = static_cast<Sample>(shiftedOffset) / static_cast<Sample>(frameLength);
                out[i] = shapePhase(basePhase, offsetLatched, tiltLatched, scaleLatched);
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

        static Sample clampBipolar(Sample x)
        {
            return std::max(Sample(-1), std::min(Sample(1), x));
        }

        static Sample wrap01(Sample x)
        {
            auto wrapped = x - std::floor(x);
            if (wrapped >= Sample(1)) {
                return Sample(0);
            }

            return wrapped;
        }

        static Sample applyTilt(Sample phase, Sample tilt)
        {
            auto const clampedTilt = std::max(Sample(-1), std::min(Sample(1), tilt));
            if (clampedTilt > Sample(0)) {
                auto const exponent = Sample(1) + clampedTilt * Sample(7);
                return std::pow(phase, exponent);
            }

            if (clampedTilt < Sample(0)) {
                auto const exponent = Sample(1) + (-clampedTilt) * Sample(7);
                return Sample(1) - std::pow(Sample(1) - phase, exponent);
            }

            return phase;
        }

        // Shape the base phase into the final frame value:
        //   1. apply `tilt` curve warp on the normalized phase
        //   2. apply `scale` as a bipolar vertical amplitude multiplier
        //      (negative `scale` inverts the phasor vertically)
        //   3. apply `offset` as a vertical DC offset
        //   4. hard clip to bipolar range [-1, 1]
        static Sample shapePhase(Sample basePhase, Sample offset, Sample tilt, Sample scale)
        {
            auto const tilted = applyTilt(basePhase, tilt);
            auto const scaled = scale * tilted;
            auto const shifted = scaled + offset;
            return clampBipolar(shifted);
        }

        int64_t clampShift(Sample raw) const
        {
            if (!std::isfinite(raw)) {
                return 0;
            }

            auto const floored = static_cast<int64_t>(std::floor(raw));
            auto const modded = positiveMod(floored, frameLength);
            return modded;
        }

        std::atomic<int64_t> frameLengthTarget{1};

        int64_t frameLength = 1;
        bool frameLengthInitialized = false;
        Sample offsetLatched = Sample(0);
        int64_t shiftLatched = 0;
        Sample tiltLatched = Sample(0);
        Sample scaleLatched = Sample(1);
        bool hasLatchedFrameControls = false;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
