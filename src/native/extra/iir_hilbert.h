#pragma once

#include <algorithm>
#include <cmath>
#include <complex>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../third_party/signalsmith-hilbert/hilbert.h"

namespace elem
{

    // Analytic-signal Hilbert transform using Signalsmith's IIR Hilbert filter.
    //
    // Child layout:
    //   [0] input - audio input
    //
    // Output order:
    //   [0] analytic real part
    //   [1] analytic imaginary part
    template <typename FloatType>
    struct IIRHilbertNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;
        using Complex = std::complex<Sample>;

        IIRHilbertNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
            , sampleRate(static_cast<Sample>(sr))
            , passbandGain(Sample(2))
            , hilbert(sampleRate, 1, passbandGain)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "passbandGain") {
                if (!val.isNumber()) {
                    return ReturnCode::InvalidPropertyType();
                }

                auto const gain = static_cast<Sample>((js::Number) val);
                if (!std::isfinite(gain)) {
                    return ReturnCode::InvalidPropertyType();
                }

                passbandGain = gain;
                hilbert = signalsmith::hilbert::HilbertIIR<Sample>(sampleRate, 1, passbandGain);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
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

            auto const* in = inputData[0];

            for (size_t i = 0; i < numSamples; ++i) {
                Complex analytic = hilbert(in[i], 0);
                outputData[0][i] = analytic.real();

                if (numOuts > 1) {
                    outputData[1][i] = analytic.imag();
                }
            }
        }

    private:
        Sample sampleRate;
        Sample passbandGain;
        signalsmith::hilbert::HilbertIIR<Sample> hilbert;
    };

} // namespace elem
