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
    struct FrameShaperNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_OFFSET = 0;
        static constexpr size_t CHILD_SHIFT = 1;
        static constexpr size_t CHILD_TILT = 2;
        static constexpr size_t CHILD_ZOOM = 3;
        static constexpr size_t CHILD_SCALE = 4;
        static constexpr size_t CHILD_WAVE = 5;
        static constexpr size_t NUM_CHILDREN = 6;

        FrameShaperNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "framelength") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const frameLength = static_cast<int64_t>((js::Number) val);
                if (frameLength < 1 || (frameLength % 2) != 0) {
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
            zoomLatched = Sample(1);
            scaleLatched = Sample(1);
            waveLatched = Sample(0);
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
            auto const* zoomSignal = ctx.inputData[CHILD_ZOOM];
            auto const* scaleSignal = ctx.inputData[CHILD_SCALE];
            auto const* waveSignal = ctx.inputData[CHILD_WAVE];
            auto* out = ctx.outputData[0];
            auto const sampleTime = *static_cast<int64_t const*>(ctx.userData);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const t = sampleTime + static_cast<int64_t>(i);
                auto const frameOffset = positiveMod(t, frameLength);
                auto const frameStart = !hasLatchedFrameControls || frameOffset == 0;

                if (frameStart) {
                    offsetLatched = offsetSignal[i];
                    shiftLatched = clampShift(shiftSignal[i]);
                    tiltLatched = clampBipolar(tiltSignal[i]);
                    zoomLatched = clampZoom(zoomSignal[i]);
                    scaleLatched = clampBipolar(scaleSignal[i]);
                    waveLatched = clampBipolar(waveSignal[i]);
                    hasLatchedFrameControls = true;
                }

                auto phase = static_cast<Sample>(positiveMod(frameOffset + shiftLatched, frameLength)) / static_cast<Sample>(frameLength);
                auto const zoomed = applyZoom(phase, zoomLatched);
                phase = zoomed.phase;
                phase = applyTilt(phase, tiltLatched);
                out[i] = shapePhase(phase, zoomed.active, offsetLatched, scaleLatched, waveLatched);
            }

            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        static constexpr Sample PI = Sample(3.14159265358979323846);

        static int64_t positiveMod(int64_t value, int64_t modulus)
        {
            auto const rem = value % modulus;
            return rem < 0 ? rem + modulus : rem;
        }

        static Sample clampBipolar(Sample x)
        {
            return std::max(Sample(-1), std::min(Sample(1), x));
        }

        static Sample clamp01(Sample x)
        {
            return std::max(Sample(0), std::min(Sample(1), x));
        }

        struct ZoomPhase {
            Sample phase;
            bool active;
        };

        static Sample lerp(Sample a, Sample b, Sample t)
        {
            return a + (b - a) * t;
        }

        static Sample triangleBipolar(Sample phase)
        {
            return Sample(1) - Sample(4) * std::fabs(phase - Sample(0.5));
        }

        static Sample sineBipolar(Sample phase)
        {
            return -std::cos(Sample(2) * PI * phase);
        }

        static Sample applyTilt(Sample phase, Sample tilt)
        {
            auto const center = std::max(Sample(0.001), std::min(Sample(0.999), Sample(0.5) + Sample(0.49) * tilt));
            if (phase <= center) {
                return center <= Sample(0) ? Sample(0) : Sample(0.5) * (phase / center);
            }

            auto const denom = Sample(1) - center;
            return denom <= Sample(0) ? Sample(1) : Sample(0.5) + Sample(0.5) * ((phase - center) / denom);
        }

        static ZoomPhase applyZoom(Sample phase, Sample zoom)
        {
            auto const mapped = (phase - Sample(0.5)) * zoom + Sample(0.5);
            auto const active = mapped >= Sample(0) && mapped <= Sample(1);
            return {clamp01(mapped), active};
        }

        static Sample morphedWave(Sample phase, Sample wave)
        {
            auto const mag = std::fabs(wave);
            auto const sign = wave < Sample(0) ? Sample(-1) : Sample(1);
            auto const tri = triangleBipolar(phase);
            auto const sine = sineBipolar(phase);

            Sample blended = Sample(0);
            if (mag <= Sample(0.5)) {
                blended = lerp(Sample(0), tri, mag * Sample(2));
            } else {
                blended = lerp(tri, sine, (mag - Sample(0.5)) * Sample(2));
            }

            return sign * blended;
        }

        static Sample shapePhase(Sample phase, bool active, Sample offset, Sample scale, Sample wave)
        {
            auto const shaped = (active ? scale * morphedWave(phase, wave) : Sample(0)) + offset;
            return clampBipolar(shaped);
        }

        int64_t clampShift(Sample raw) const
        {
            if (!std::isfinite(raw)) {
                return 0;
            }

            auto const floored = static_cast<int64_t>(std::floor(raw));
            return positiveMod(floored, frameLength);
        }

        static Sample clampZoom(Sample raw)
        {
            if (!std::isfinite(raw)) {
                return Sample(1);
            }

            return std::max(Sample(0.001), raw);
        }

        std::atomic<int64_t> frameLengthTarget{1};

        int64_t frameLength = 1;
        bool frameLengthInitialized = false;
        Sample offsetLatched = Sample(0);
        int64_t shiftLatched = 0;
        Sample tiltLatched = Sample(0);
        Sample zoomLatched = Sample(1);
        Sample scaleLatched = Sample(1);
        Sample waveLatched = Sample(0);
        bool hasLatchedFrameControls = false;
    };

    static_assert(std::atomic<int64_t>::is_always_lock_free);

} // namespace elem
