#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../third_party/signalsmith-dsp/filters.h"
#include "../third_party/signalsmith-dsp/rates.h"

namespace elem
{

    template <typename FloatType>
    struct CrunchNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        CrunchNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {
            resizeState(2);
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "drive") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                driveTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "fuzz") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                fuzzTarget.store(clamp01(static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "toneHz") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                toneHzTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "cutHz") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                cutHzTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "outGain") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                outGainTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "autoGain") {
                if (!val.isBool()) return ReturnCode::InvalidPropertyType();
                autoGainTarget.store(static_cast<bool>((js::Boolean) val), std::memory_order_relaxed);
            } else if (key == "channels") {
                // handled by the JS helper; ignore here
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            currentDrive = driveTarget.load(std::memory_order_relaxed);
            currentFuzz = fuzzTarget.load(std::memory_order_relaxed);
            currentToneHz = toneHzTarget.load(std::memory_order_relaxed);
            currentCutHz = cutHzTarget.load(std::memory_order_relaxed);
            currentOutGain = outGainTarget.load(std::memory_order_relaxed);
            currentAutoGain = autoGainTarget.load(std::memory_order_relaxed);

            oversampler.reset();
            for (auto &g : gainshapers) g.reset();
            for (auto &f : cutFilters) f.reset();
            for (auto &f : toneFilters) f.reset();
            for (auto &f : outputFilters) f.reset();
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numChannels = ctx.numInputChannels;
            auto numSamples = ctx.numSamples;
            auto blockSize = GraphNode<FloatType>::getBlockSize();
            auto sampleRate = GraphNode<FloatType>::getSampleRate();

            if (numChannels == 0 || numSamples == 0) {
                for (size_t c = 0; c < ctx.numOutputChannels; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            ensureState(numChannels, blockSize, sampleRate);

            auto targetDrive = driveTarget.load(std::memory_order_relaxed);
            auto targetFuzz = fuzzTarget.load(std::memory_order_relaxed);
            auto targetToneHz = toneHzTarget.load(std::memory_order_relaxed);
            auto targetCutHz = cutHzTarget.load(std::memory_order_relaxed);
            auto targetOutGain = outGainTarget.load(std::memory_order_relaxed);
            auto targetAutoGain = autoGainTarget.load(std::memory_order_relaxed);

            auto driveStep = (targetDrive - currentDrive) / static_cast<Sample>(numSamples);
            auto fuzzStep = (targetFuzz - currentFuzz) / static_cast<Sample>(numSamples);
            auto toneStep = (targetToneHz - currentToneHz) / static_cast<Sample>(numSamples);
            auto cutStep = (targetCutHz - currentCutHz) / static_cast<Sample>(numSamples);
            auto outGainStep = (targetOutGain - currentOutGain) / static_cast<Sample>(numSamples);
            auto autoGain = targetAutoGain;

            auto drive = currentDrive;
            auto fuzz = currentFuzz;
            auto toneHz = currentToneHz;
            auto cutHz = currentCutHz;
            auto outGain = currentOutGain;

            for (size_t c = 0; c < numChannels; ++c) {
                cutFilters[c].highpass(cutHz / (sampleRate*2));
                toneFilters[c].lowpass(toneHz / (sampleRate*2));
            }

            for (size_t c = 0; c < numChannels; ++c) {
                oversampler.upChannel(int(c), ctx.inputData[c], int(numSamples));
            }

            for (size_t c = 0; c < numChannels; ++c) {
                auto *samples = oversampler[int(c)];
                auto &gainshaper = gainshapers[c];
                auto &cutFilter = cutFilters[c];
                auto &toneFilter = toneFilters[c];
                auto &outputFilter = outputFilters[c];

                for (size_t i = 0; i < numSamples*2; ++i) {
                    double hi = i*0.5;
                    auto inputGain = drive + driveStep*static_cast<Sample>(hi);
                    auto fuzzValue = clamp01(fuzz + fuzzStep*static_cast<Sample>(hi));
                    auto toneValue = toneHz + toneStep*static_cast<Sample>(hi);
                    auto cutValue = cutHz + cutStep*static_cast<Sample>(hi);
                    auto outValue = outGain + outGainStep*static_cast<Sample>(hi);

                    if (autoGain) {
                        auto autoGainLevel = Sample(0.1);
                        auto cutRatio = Sample(1) - cutValue/(cutValue + Sample(200));
                        auto averageGain = gainshaper.averageGain(std::max(Sample(1e-4), autoGainLevel*cutRatio*std::max(drive, Sample(1e-4))));
                        outValue /= std::max(Sample(1e-4), drive*averageGain);
                    }

                    gainshaper.setFuzzFactor(fuzzValue);
                    cutFilter.highpass(cutValue / (sampleRate*2));
                    toneFilter.lowpass(toneValue / (sampleRate*2));
                    outputFilter.highpass((10 + 40*fuzzValue) / (sampleRate*2));

                    Sample x = samples[i] * inputGain;
                    Sample gain = gainshaper(cutFilter(x));
                    Sample y = x * toneFilter(gain);
                    samples[i] = outputFilter(y) * outValue;
                }
            }

            for (size_t c = 0; c < numChannels; ++c) {
                oversampler.downChannel(int(c), ctx.outputData[c], int(numSamples));
            }

            currentDrive = targetDrive;
            currentFuzz = targetFuzz;
            currentToneHz = targetToneHz;
            currentCutHz = targetCutHz;
            currentOutGain = targetOutGain;
            currentAutoGain = targetAutoGain;
        }

    private:
        static Sample clamp01(Sample value) {
            return std::max<Sample>(0, std::min<Sample>(1, value));
        }

        void resizeState(size_t channels)
        {
            gainshapers.resize(channels);
            cutFilters.resize(channels);
            toneFilters.resize(channels);
            outputFilters.resize(channels);
        }

        void ensureState(size_t channels, size_t blockSize, double sampleRate)
        {
            if (gainshapers.size() != channels) {
                resizeState(channels);
                oversampler.resize(int(channels), int(blockSize), oversampleHalfLatency, std::min(0.45, 21000/sampleRate));
                oversampler.reset();
            }
        }

        struct GainshapeADAA {
            Sample prevX = 0, prevIntegral = 0;
            Sample fuzzPositive = 1, fuzzNegative = 1;

            void setFuzzFactor(Sample k) {
                fuzzPositive = 1 + k - k*k;
                fuzzNegative = 1 - k - k*k;
                prevIntegral = integralGain(prevX);
            }

            Sample gain(Sample x) const {
                Sample fuzzGain = (x >= 0 ? fuzzPositive : fuzzNegative);
                return fuzzGain/std::sqrt(1 + x*x);
            }

            Sample integralGain(Sample x) const {
                if (x >= 0) return fuzzPositive*std::log(std::sqrt(1 + x*x) + x);
                return -fuzzNegative*std::log(std::sqrt(1 + x*x) - x);
            }

            Sample averageGain(Sample range) const {
                return std::log(std::sqrt(1 + range*range) + range)/range;
            }

            void reset() {
                prevX = 0;
                prevIntegral = integralGain(prevX);
            }

            Sample operator()(Sample x) {
                Sample diffX = x - prevX;
                Sample integral = integralGain(x);
                Sample diffIntegral = integral - prevIntegral;
                prevX = x;
                prevIntegral = integral;
                if (std::abs(diffX) < Sample(1e-4)) return gain(x);
                return diffIntegral/diffX;
            }
        };

        static constexpr int oversampleHalfLatency = 16;

        std::atomic<Sample> driveTarget{Sample(4)};
        std::atomic<Sample> fuzzTarget{Sample(0)};
        std::atomic<Sample> toneHzTarget{Sample(2000)};
        std::atomic<Sample> cutHzTarget{Sample(50)};
        std::atomic<Sample> outGainTarget{Sample(1)};
        std::atomic<bool> autoGainTarget{true};

        Sample currentDrive = Sample(4);
        Sample currentFuzz = Sample(0);
        Sample currentToneHz = Sample(2000);
        Sample currentCutHz = Sample(50);
        Sample currentOutGain = Sample(1);
        bool currentAutoGain = true;

        signalsmith::rates::Oversampler2xFIR<Sample> oversampler;
        std::vector<GainshapeADAA> gainshapers;
        std::vector<signalsmith::filters::BiquadStatic<Sample>> cutFilters, toneFilters, outputFilters;
    };

} // namespace elem
