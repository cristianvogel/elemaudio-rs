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
    // One input signal produces two sideband outputs in fixed order.
    //
    // Child layout:
    //   [0] shiftHz - audio-rate frequency shift amount in Hz
    //   [1] input   - audio input
    //
    // Output order:
    //   [0] lower sideband
    //   [1] upper sideband
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
            if (key == "reflect") {
                if (!val.isNumber())
                    return ReturnCode::InvalidPropertyType();

                reflectTarget.store(static_cast<int>((js::Number) val), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            phase = 0;
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

            if (numIns < 2 || numOuts < 1 || numSamples == 0) {
                return;
            }

            auto const sampleRate = GraphNode<FloatType>::getSampleRate();
            auto const targetReflect = reflectTarget.load(std::memory_order_relaxed);
            auto phaseLocal = phase;
            auto const* shiftSignal = inputData[0];
            auto const* in = inputData[1];
            auto const twoPi = Sample(6.28318530717958647692528676655900576839);

            for (size_t i = 0; i < numSamples; ++i) {
                auto shiftHz = shiftSignal[i];
                bool swapOutputs = shouldSwapOutputs(targetReflect, shiftHz);
                bool reflectShift = shouldReflectShift(targetReflect, shiftHz);

                auto effectiveShiftHz = reflectShift && shiftHz < 0 ? -shiftHz : shiftHz;
                phaseLocal += effectiveShiftHz / static_cast<Sample>(sampleRate);

                Complex analytic = hilbert(in[i], 0);
                auto rot = std::polar(Sample(1), phaseLocal * twoPi);
                auto down = std::real(analytic * std::conj(rot));
                auto up = std::real(analytic * rot);

                if (numOuts > 0) {
                    outputData[0][i] = swapOutputs ? up : down;
                }
                if (numOuts > 1) {
                    outputData[1][i] = swapOutputs ? down : up;
                }
            }

            currentReflect = targetReflect;
            phase = wrapPhase(phaseLocal);
        }

    private:
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

        std::atomic<int> reflectTarget{0};
        int currentReflect = 0;
        Sample phase = Sample(0);
        signalsmith::hilbert::HilbertIIR<Sample> hilbert;
    };

} // namespace elem
