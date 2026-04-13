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
    static constexpr double kStrideDelayMaxJumpMs = 1000.0;

    // Children layout:
    //   [0] = delayMs signal (sample-rate control)
    //   [1] = fb signal      (sample-rate control)
    //   [2..N+2] = audio input channels
    //
    // Props (structural, not modulation targets):
    //   maxDelayMs    — maximum delay buffer length (default 1000)
    //   transitionMs  — crossfade duration for stride jumps (default 100)
    //   bigLeapMode   — "linear" or "step" (default "linear")

    template <typename FloatType>
    struct StrideDelayNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;
        using DelayLine = signalsmith::delay::MultiDelay<Sample, signalsmith::delay::InterpolatorKaiserSinc8>;

        static constexpr size_t CHILD_DELAY_MS = 0;
        static constexpr size_t CHILD_FB       = 1;
        static constexpr size_t CHILD_AUDIO    = 2;

        StrideDelayNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "maxDelayMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                maxDelayMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "transitionMs") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                transitionMsTarget.store(std::max<Sample>(0, static_cast<Sample>((js::Number) val)), std::memory_order_relaxed);
            } else if (key == "bigLeapMode") {
                if (!val.isString()) return ReturnCode::InvalidPropertyType();
                methodTarget.store(static_cast<int>(parseMethod(val.toString())), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            currentDelayMs = Sample(0);
            transitionFromMs = Sample(0);
            transitionToMs = Sample(0);
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

            // Need at least: delayMs + fb + one audio channel
            if (numIns < 3 || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            // Control signals
            auto const* delayMsSignal = ctx.inputData[CHILD_DELAY_MS];
            auto const* fbSignal      = ctx.inputData[CHILD_FB];

            // Audio channels start at index 2
            auto audioChannelCount = numIns - CHILD_AUDIO;
            auto channelCount = std::min(audioChannelCount, numOuts);
            ensureDelayLine(channelCount);

            if (!delayLine) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, FloatType(0));
                }
                return;
            }

            auto transitionMs = transitionMsTarget.load(std::memory_order_relaxed);
            auto method = methodTarget.load(std::memory_order_relaxed);

            // Read the delay target from the signal at the start of each block.
            // The stride transition system handles smoothing large jumps.
            auto targetDelayMs = std::max<Sample>(0, delayMsSignal[0]);

            if (!transitionActive && std::abs(targetDelayMs - currentDelayMs) > Sample(1e-9)) {
                startTransition(targetDelayMs, transitionMs, method);
            }

            std::vector<Sample> dry(channelCount, Sample(0));
            std::vector<Sample> wet(channelCount, Sample(0));
            std::vector<Sample> readA(channelCount, Sample(0));
            std::vector<Sample> readB(channelCount, Sample(0));
            std::vector<Sample> write(channelCount, Sample(0));

            auto sampleRate = GraphNode<FloatType>::getSampleRate();
            for (size_t i = 0; i < numSamples; ++i) {
                auto fb = fbSignal[i];

                delayLine->read(delayToSamples(currentDelayMs, sampleRate), wet);

                if (transitionActive) {
                    auto fromDelaySamples = delayToSamples(transitionFromMs, sampleRate);
                    auto toDelaySamples = delayToSamples(transitionToMs, sampleRate);
                    auto t = smoothStep(static_cast<Sample>(transitionProgress) / static_cast<Sample>(transitionSamples));

                    delayLine->read(fromDelaySamples, readA);
                    delayLine->read(toDelaySamples, readB);

                    for (size_t c = 0; c < channelCount; ++c) {
                        wet[c] = readA[c] + (readB[c] - readA[c]) * t;
                    }

                    ++transitionProgress;
                    if (transitionProgress >= transitionSamples) {
                        currentDelayMs = transitionToMs;
                        transitionActive = false;
                        transitionProgress = 0;

                        // Re-read the current signal value to check for further transitions
                        auto nowTarget = std::max<Sample>(0, delayMsSignal[std::min(i, static_cast<size_t>(numSamples - 1))]);
                        if (currentMethod == FallbackMode::Step && std::abs(nowTarget - currentDelayMs) > Sample(kStrideDelayMaxJumpMs)) {
                            startTransition(nowTarget, transitionMs, method);
                        } else if (std::abs(nowTarget - currentDelayMs) > Sample(1e-9)) {
                            startTransition(nowTarget, transitionMs, method);
                        }
                    }
                }

                for (size_t c = 0; c < channelCount; ++c) {
                    ctx.outputData[c][i] = wet[c];
                    dry[c] = ctx.inputData[c + CHILD_AUDIO][i];
                    write[c] = dry[c] + fb * wet[c];
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
            Step = 1,
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

        static FallbackMode parseMethod(std::string const& method)
        {
            if (method == "step") return FallbackMode::Step;
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

        void startTransition(Sample targetDelayMs, Sample transitionMs, int method)
        {
            transitionFromMs = currentDelayMs;
            transitionToMs = targetDelayMs;
            currentMethod = static_cast<FallbackMode>(method);

            if (currentMethod == FallbackMode::Step) {
                auto remaining = std::abs(transitionToMs - transitionFromMs);
                auto maxJumpMs = Sample(kStrideDelayMaxJumpMs);
                if (remaining > maxJumpMs && maxJumpMs > Sample(0)) {
                    auto direction = transitionToMs > transitionFromMs ? Sample(1) : Sample(-1);
                    transitionToMs = transitionFromMs + direction * maxJumpMs;
                }
            }

            auto softenedTransitionMs = std::max<Sample>(transitionMs, Sample(60));
            transitionSamples = std::max<size_t>(1, static_cast<size_t>(std::ceil(softenedTransitionMs * Sample(0.001) * static_cast<Sample>(GraphNode<FloatType>::getSampleRate()))));
            transitionProgress = 0;
            transitionActive = true;
        }

        std::atomic<Sample> maxDelayMsTarget{Sample(1000)};
        std::atomic<Sample> transitionMsTarget{Sample(100)};
        std::atomic<int> methodTarget{static_cast<int>(FallbackMode::Linear)};

        size_t configuredChannels = 0;
        size_t configuredCapacitySamples = 0;
        Sample configuredMaxDelayMs = 0;

        Sample currentDelayMs = 0;
        Sample transitionFromMs = 0;
        Sample transitionToMs = 0;
        size_t transitionSamples = 1;
        size_t transitionProgress = 0;
        bool transitionActive = false;
        FallbackMode currentMethod = FallbackMode::Linear;

        std::optional<DelayLine> delayLine;
    };

} // namespace elem
