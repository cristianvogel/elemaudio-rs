#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/third-party/signalsmith-stretch/dsp/delay.h"

namespace elem
{

    template <typename FloatType>
    struct StrideDelayNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;
        using DelayLine = signalsmith::delay::MultiDelay<Sample, signalsmith::delay::InterpolatorKaiserSinc8>;

        StrideDelayNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "maxDelayMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                maxDelayMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "delayMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                delayMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "fb") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                fbTarget.store(static_cast<Sample>((js::Number) val), std::memory_order_relaxed);
            } else if (key == "strideMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                strideMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "transitionMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                transitionMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "maxJumpMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                maxJumpMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "fallback") {
                if (!val.isString()) return ReturnCode::InvalidPropertyType();
                fallbackTarget.store(static_cast<int>(parseFallback(val.toString())), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            currentDelayMs = delayMsTarget.load(std::memory_order_relaxed);
            transitionFromMs = currentDelayMs;
            transitionToMs = currentDelayMs;
            transitionProgress = 0;
            transitionSamples = 1;
            transitionActive = false;
            ensureDelayLine(configuredChannels);
            if (delayLine) delayLine->reset();
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            if (numIns == 0 || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            auto channelCount = std::min(numIns, numOuts);
            ensureDelayLine(channelCount);
            if (!delayLine) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            auto targetDelayMs = delayMsTarget.load(std::memory_order_relaxed);
            auto targetFb = fbTarget.load(std::memory_order_relaxed);
            auto strideMs = strideMsTarget.load(std::memory_order_relaxed);
            auto transitionMs = transitionMsTarget.load(std::memory_order_relaxed);
            auto maxJumpMs = maxJumpMsTarget.load(std::memory_order_relaxed);
            auto fallback = fallbackTarget.load(std::memory_order_relaxed);

            if (!transitionActive && std::abs(targetDelayMs - currentDelayMs) > Sample(1e-9)) {
                startTransition(targetDelayMs, transitionMs, maxJumpMs, fallback);
            }

            std::vector<Sample> dry(channelCount, Sample(0));
            std::vector<Sample> wet(channelCount, Sample(0));
            std::vector<Sample> readA(channelCount, Sample(0));
            std::vector<Sample> readB(channelCount, Sample(0));
            std::vector<Sample> readScratch(channelCount, Sample(0));
            std::vector<Sample> write(channelCount, Sample(0));

            auto sampleRate = GraphNode<FloatType>::getSampleRate();
            auto strideSamples = std::max<Sample>(Sample(1), strideMs * Sample(0.001) * static_cast<Sample>(sampleRate));
            for (size_t i = 0; i < numSamples; ++i) {
                delayLine->read(delayToSamples(currentDelayMs, sampleRate), wet);

                if (transitionActive) {
                    auto fromDelaySamples = delayToSamples(transitionFromMs, sampleRate);
                    auto toDelaySamples = delayToSamples(transitionToMs, sampleRate);
                    auto t = smoothStep(static_cast<Sample>(transitionProgress) / static_cast<Sample>(transitionSamples));

                    if (currentFallback == FallbackMode::DualStrideCrossfade) {
                        readStrided(fromDelaySamples, strideSamples, readA, readScratch);
                        readStrided(toDelaySamples, strideSamples, readB, readScratch);
                    } else {
                        delayLine->read(fromDelaySamples, readA);
                        delayLine->read(toDelaySamples, readB);
                    }

                    for (size_t c = 0; c < channelCount; ++c) {
                        wet[c] = readA[c] + (readB[c] - readA[c]) * t;
                    }

                    ++transitionProgress;
                    if (transitionProgress >= transitionSamples) {
                        currentDelayMs = transitionToMs;
                        transitionActive = false;
                        transitionProgress = 0;

                        if (currentFallback == FallbackMode::Step && std::abs(targetDelayMs - currentDelayMs) > maxJumpMs) {
                            startTransition(targetDelayMs, transitionMs, maxJumpMs, fallback);
                        } else if (std::abs(targetDelayMs - currentDelayMs) > Sample(1e-9)) {
                            startTransition(targetDelayMs, transitionMs, maxJumpMs, fallback);
                        }
                    }
                }

                for (size_t c = 0; c < channelCount; ++c) {
                    ctx.outputData[c][i] = wet[c];
                    dry[c] = ctx.inputData[c][i];
                    write[c] = dry[c] + targetFb * wet[c];
                }

                delayLine->write(write);
            }

            for (size_t c = channelCount; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
            }
        }

    private:
        enum class FallbackMode {
            Linear = 0,
            DualStrideCrossfade = 1,
            Step = 2,
        };

        static Sample smoothStep(Sample x)
        {
            x = std::max<Sample>(0, std::min<Sample>(1, x));
            return x * x * (Sample(3) - Sample(2) * x);
        }

        static Sample delayToSamples(Sample delayMs, double sampleRate)
        {
            return delayMs * Sample(0.001) * static_cast<Sample>(sampleRate);
        }

        static FallbackMode parseFallback(std::string const& fallback)
        {
            if (fallback == "dualStrideCrossfade") return FallbackMode::DualStrideCrossfade;
            if (fallback == "step") return FallbackMode::Step;
            return FallbackMode::Linear;
        }

        void ensureDelayLine(size_t channels)
        {
            auto sampleRate = GraphNode<FloatType>::getSampleRate();
            auto maxDelayMs = maxDelayMsTarget.load(std::memory_order_relaxed);
            auto capacitySamples = std::max<size_t>(1, static_cast<size_t>(std::ceil(maxDelayMs * Sample(0.001) * static_cast<Sample>(sampleRate))) + 32);

            if (!delayLine || configuredChannels != channels || configuredCapacitySamples != capacitySamples || configuredMaxDelayMs != maxDelayMs) {
                delayLine.emplace(static_cast<int>(channels), static_cast<int>(capacitySamples));
                configuredChannels = channels;
                configuredCapacitySamples = capacitySamples;
                configuredMaxDelayMs = maxDelayMs;
            }
        }

        void readStrided(
            Sample delaySamples,
            Sample strideSamples,
            std::vector<Sample>& result,
            std::vector<Sample>& scratch)
        {
            auto base = std::floor(delaySamples / strideSamples) * strideSamples;
            auto frac = (delaySamples - base) / strideSamples;

            delayLine->read(base, result);
            if (strideSamples <= Sample(1)) {
                return;
            }

            delayLine->read(base + strideSamples, scratch);
            for (size_t c = 0; c < result.size(); ++c) {
                result[c] = result[c] + (scratch[c] - result[c]) * frac;
            }
        }

        void startTransition(Sample targetDelayMs, Sample transitionMs, Sample maxJumpMs, int fallback)
        {
            transitionFromMs = currentDelayMs;
            transitionToMs = targetDelayMs;
            currentFallback = static_cast<FallbackMode>(fallback);

            if (currentFallback == FallbackMode::Step) {
                auto remaining = std::abs(transitionToMs - transitionFromMs);
                if (remaining > maxJumpMs && maxJumpMs > Sample(0)) {
                    auto direction = transitionToMs > transitionFromMs ? Sample(1) : Sample(-1);
                    transitionToMs = transitionFromMs + direction * maxJumpMs;
                }
            }

            transitionSamples = std::max<size_t>(1, static_cast<size_t>(std::ceil(transitionMs * Sample(0.001) * static_cast<Sample>(GraphNode<FloatType>::getSampleRate()))));
            transitionProgress = 0;
            transitionActive = true;
        }

        std::atomic<Sample> maxDelayMsTarget{Sample(1000)};
        std::atomic<Sample> delayMsTarget{Sample(250)};
        std::atomic<Sample> fbTarget{Sample(0)};
        std::atomic<Sample> strideMsTarget{Sample(8)};
        std::atomic<Sample> transitionMsTarget{Sample(20)};
        std::atomic<Sample> maxJumpMsTarget{Sample(50)};
        std::atomic<int> fallbackTarget{static_cast<int>(FallbackMode::DualStrideCrossfade)};

        size_t configuredChannels = 0;
        size_t configuredCapacitySamples = 0;
        Sample configuredMaxDelayMs = 0;

        Sample currentDelayMs = 0;
        Sample transitionFromMs = 0;
        Sample transitionToMs = 0;
        size_t transitionSamples = 1;
        size_t transitionProgress = 0;
        bool transitionActive = false;
        FallbackMode currentFallback = FallbackMode::DualStrideCrossfade;

        std::optional<DelayLine> delayLine;
    };

} // namespace elem
