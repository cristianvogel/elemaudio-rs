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
    // Optional internal feedback feeds a low-passed copy of either the lower
    // or upper output band back into the input of the shifter. This creates a
    // cascade of repeated frequency shifts without changing the node's split
    // output contract.
    //
    // Child layout:
    //   [0] shiftHz   - audio-rate frequency shift amount in Hz
    //   [1] feedback  - audio-rate feedback amount (clamped per-sample to [0, 0.999])
    //   [2] input     - audio input
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
            , feedbackLowpassAlpha(computeFeedbackLowpassAlpha(sr))
            , hilbert(static_cast<Sample>(sr), 1)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "reflect") {
                if (!val.isNumber())
                    return ReturnCode::InvalidPropertyType();

                reflectTarget.store(static_cast<int>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "fbSource") {
                if (!val.isString())
                    return ReturnCode::InvalidPropertyType();

                auto const source = std::string((js::String) val);
                if (source == "lower") {
                    fbSourceTarget.store(0, std::memory_order_relaxed);
                } else if (source == "upper") {
                    fbSourceTarget.store(1, std::memory_order_relaxed);
                } else {
                    return ReturnCode::InvalidPropertyType();
                }
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            phase = 0;
            feedbackState = Sample(0);
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

            if (numIns < 3 || numOuts < 1 || numSamples == 0) {
                return;
            }

            auto const targetReflect = reflectTarget.load(std::memory_order_relaxed);
            auto const targetFbSource = fbSourceTarget.load(std::memory_order_relaxed);
            auto const sampleRate = GraphNode<FloatType>::getSampleRate();
            auto phaseLocal = phase;
            auto feedbackStateLocal = feedbackState;
            auto const* shiftSignal = inputData[0];
            auto const* fbSignal = inputData[1];
            auto const* in = inputData[2];
            auto const twoPi = Sample(6.28318530717958647692528676655900576839);

            for (size_t i = 0; i < numSamples; ++i) {
                auto const fbAmount = std::clamp(fbSignal[i], Sample(0), Sample(0.999));
                auto const inputSample = in[i] + (fbAmount * feedbackStateLocal);
                auto shiftHz = shiftSignal[i];
                bool swapOutputs = shouldSwapOutputs(targetReflect, shiftHz);
                bool reflectShift = shouldReflectShift(targetReflect, shiftHz);

                auto effectiveShiftHz = reflectShift && shiftHz < 0 ? -shiftHz : shiftHz;
                phaseLocal += effectiveShiftHz / static_cast<Sample>(sampleRate);

                Complex analytic = hilbert(inputSample, 0);
                auto rot = std::polar(Sample(1), phaseLocal * twoPi);
                auto down = std::real(analytic * std::conj(rot));
                auto up = std::real(analytic * rot);
                auto const lower = swapOutputs ? up : down;
                auto const upper = swapOutputs ? down : up;
                auto const fbSample = targetFbSource == 0 ? lower : upper;

                feedbackStateLocal += feedbackLowpassAlpha * (fbSample - feedbackStateLocal);

                if (numOuts > 0) {
                    outputData[0][i] = lower;
                }
                if (numOuts > 1) {
                    outputData[1][i] = upper;
                }
            }

            phase = wrapPhase(phaseLocal);
            feedbackState = feedbackStateLocal;
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

        static constexpr Sample feedbackLowpassCutoffHz = Sample(4000);

        static Sample computeFeedbackLowpassAlpha(double sampleRate)
        {
            auto const twoPi = Sample(6.28318530717958647692528676655900576839);
            auto const exponent = -twoPi * feedbackLowpassCutoffHz / static_cast<Sample>(sampleRate);
            return Sample(1) - std::exp(exponent);
        }

        std::atomic<int> reflectTarget{0};
        std::atomic<int> fbSourceTarget{0};
        Sample phase = Sample(0);
        Sample feedbackState = Sample(0);
        Sample feedbackLowpassAlpha;
        signalsmith::hilbert::HilbertIIR<Sample> hilbert;
    };

} // namespace elem
