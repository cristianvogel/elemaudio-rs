#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <complex>
#include <variant>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../third_party/signalsmith-hilbert/hilbert.h"

namespace elem
{

    // Frequency shifter built from a Hilbert / single-sideband modulator.
    //
    // One input signal produces two outputs:
    //   - output 0: down-shifted
    //   - output 1: up-shifted
    template <typename FloatType>
    struct FreqShiftNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;
        using Complex = std::complex<Sample>;

        FreqShiftNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
            , hilbert(static_cast<Sample>(sr), 1)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "shiftHz") {
                if (!val.isNumber())
                    return ReturnCode::InvalidPropertyType();

                shiftHzTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "mix") {
                if (!val.isNumber())
                    return ReturnCode::InvalidPropertyType();

                mixTarget.store(clamp01(static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "reflect") {
                if (!val.isNumber())
                    return ReturnCode::InvalidPropertyType();

                reflectTarget.store(static_cast<int>((js::Number) val), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            phase = 0;
            currentShiftHz = shiftHzTarget.load(std::memory_order_relaxed);
            currentMix = mixTarget.load(std::memory_order_relaxed);
            currentReflect = reflectTarget.load(std::memory_order_relaxed);
            hilbert.reset();
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto** inputData = ctx.inputData;
            auto** outputData = ctx.outputData;
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            for (size_t j = 0; j < numOuts; ++j) {
                std::fill_n(outputData[j], numSamples, FloatType(0));
            }

            if (numIns < 1 || numOuts < 1 || numSamples == 0) {
                return;
            }

            auto const sampleRate = GraphNode<FloatType>::getSampleRate();
            auto const targetShiftHz = shiftHzTarget.load(std::memory_order_relaxed);
            auto const targetMix = mixTarget.load(std::memory_order_relaxed);
            auto const targetReflect = reflectTarget.load(std::memory_order_relaxed);
            auto const shiftStep = (targetShiftHz - currentShiftHz) / static_cast<Sample>(numSamples);
            auto const mixStep = (targetMix - currentMix) / static_cast<Sample>(numSamples);
            auto shiftHz = currentShiftHz;
            auto mix = currentMix;
            auto phaseLocal = phase;
            auto const* in = inputData[0];
            auto const twoPi = Sample(6.28318530717958647692528676655900576839);
            bool swapOutputs = shouldSwapOutputs(targetReflect, targetShiftHz);
            bool reflectShift = shouldReflectShift(targetReflect, targetShiftHz);

            for (size_t i = 0; i < numSamples; ++i) {
                shiftHz += shiftStep;
                mix += mixStep;

                auto effectiveShiftHz = reflectShift && shiftHz < 0 ? -shiftHz : shiftHz;
                phaseLocal += effectiveShiftHz / static_cast<Sample>(sampleRate);

                Complex analytic = hilbert(in[i], 0);
                auto rot = std::polar(Sample(1), phaseLocal * twoPi);
                auto down = std::real(analytic * std::conj(rot));
                auto up = std::real(analytic * rot);
                auto dry = in[i];
                auto wet = mix;

                if (numOuts > 0) {
                    auto first = swapOutputs ? up : down;
                    outputData[0][i] = dry * (Sample(1) - wet) + wet * first;
                }
                if (numOuts > 1) {
                    auto second = swapOutputs ? down : up;
                    outputData[1][i] = dry * (Sample(1) - wet) + wet * second;
                }
            }

            currentShiftHz = targetShiftHz;
            currentMix = targetMix;
            currentReflect = targetReflect;
            phase = wrapPhase(phaseLocal);
        }

    private:
        static Sample clamp01(Sample value)
        {
            return std::max<Sample>(0, std::min<Sample>(1, value));
        }

        static bool shouldReflectShift(int reflect, Sample shiftHz)
        {
            return (reflect == 1 || reflect == 3) && shiftHz < 0;
        }

        static bool shouldSwapOutputs(int reflect, Sample shiftHz)
        {
            return (reflect == 2 || reflect == 3) && shiftHz < 0;
        }

        static Sample wrapPhase(Sample phase)
        {
            phase -= std::floor(phase);
            return phase;
        }

        std::atomic<Sample> shiftHzTarget{Sample(50)};
        std::atomic<Sample> mixTarget{Sample(1)};
        std::atomic<int> reflectTarget{0};
        Sample currentShiftHz = Sample(50);
        Sample currentMix = Sample(1);
        int currentReflect = 0;
        Sample phase = Sample(0);
        signalsmith::hilbert::HilbertIIR<Sample> hilbert;
    };

} // namespace elem
