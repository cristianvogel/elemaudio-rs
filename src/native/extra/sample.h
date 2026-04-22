#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <string>

#include "../../vendor/elementary/runtime/elem/AudioBufferResource.h"
#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/SingleWriterSingleReaderQueue.h"
#include "../../vendor/elementary/runtime/elem/Types.h"
#include "../../vendor/elementary/runtime/elem/builtins/helpers/Change.h"
#include "../../vendor/elementary/runtime/elem/builtins/helpers/GainFade.h"
#include "../../vendor/elementary/runtime/elem/builtins/helpers/FloatUtils.h"

namespace elem
{
    template <typename FloatType>
    struct ExtraSampleReader {
        using Sample = FloatType;

        ExtraSampleReader()
            : gainFade(44100.0, 4.0, 4.0)
        {}

        ExtraSampleReader(FloatType sampleRate, SharedResourcePtr source)
            : sourceBuffer(source), gainFade(sampleRate, 4.0, 4.0)
        {}

        ExtraSampleReader(ExtraSampleReader const& other)
            : sourceBuffer(other.sourceBuffer)
            , gainFade(other.gainFade)
            , shouldLoop(other.shouldLoop)
            , startNorm(other.startNorm)
            , endNorm(other.endNorm)
            , pos(other.pos)
        {}

        void noteOn(double start, double end)
        {
            gainFade.fadeIn();
            shouldLoop = true;
            startNorm = start;
            endNorm = end;
            pos = start;
        }

        void noteOff()
        {
            gainFade.fadeOut();
        }

        FloatType lerpRead(BufferView<float> const& view, double readPos) const
        {
            auto* data = view.data();
            auto size = view.size();
            if (size == 0) return FloatType(0);

            auto left = static_cast<size_t>(readPos);
            auto right = left + 1;
            auto alpha = readPos - static_cast<double>(left);

            if (left >= size) return FloatType(0);
            if (right >= size) return data[left];
            return lerp(static_cast<float>(alpha), data[left], data[right]);
        }

        void sumInto(FloatType** outputData, size_t numOuts, size_t writeOffset, size_t numSamples, double playbackRate, double gainDb)
        {
            if (sourceBuffer == nullptr || sourceBuffer->numSamples() == 0 || numOuts == 0) {
                return;
            }

            auto const sourceLength = static_cast<double>(sourceBuffer->numSamples());
            auto const readStart = std::clamp(startNorm, 0.0, 1.0) * sourceLength;
            auto const readEnd = std::clamp(endNorm, 0.0, 1.0) * sourceLength;
            auto const regionStart = std::min(readStart, readEnd);
            auto const regionEnd = std::max(readStart, readEnd);
            auto const regionLength = regionEnd - regionStart;
            auto const gainLinear = std::pow(10.0, gainDb / 20.0);

            if (regionLength <= 0.0) {
                return;
            }

            elem::GainFade<FloatType> localFade(gainFade);
            auto const availableChannels = sourceBuffer->numChannels();
            auto const outputChannels = std::min<size_t>(2, numOuts);

            for (size_t outCh = 0; outCh < outputChannels; ++outCh) {
                auto const sourceCh = availableChannels == 1 ? size_t(0) : std::min(outCh, availableChannels - 1);
                auto bufferView = sourceBuffer->getChannelData(sourceCh);
                localFade = gainFade;

                for (size_t j = 0; j < numSamples; ++j) {
                    double readPos = pos + static_cast<double>(j) * playbackRate;
                    auto wrapped = regionStart + std::fmod(readPos - regionStart, regionLength);
                    if (wrapped < regionStart) wrapped += regionLength;
                    outputData[outCh][writeOffset + j] += localFade(lerpRead(bufferView, wrapped)) * static_cast<FloatType>(gainLinear);
                }
            }

            gainFade = localFade;
            pos += static_cast<double>(numSamples) * playbackRate;
            auto wrapped = regionStart + std::fmod(pos - regionStart, regionLength);
            if (wrapped < regionStart) wrapped += regionLength;
            pos = wrapped;
        }

        SharedResourcePtr sourceBuffer;
        GainFade<FloatType> gainFade;
        bool shouldLoop = true;
        double startNorm = 0.0;
        double endNorm = 1.0;
        double pos = 0.0;
    };

    template <typename FloatType>
    struct ExtraSampleNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Reader = ExtraSampleReader<FloatType>;

        ExtraSampleNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "path") {
                if (!val.isString()) return ReturnCode::InvalidPropertyType();
                if (!resources.has((js::String) val)) return ReturnCode::InvalidPropertyValue();
                auto ref = resources.get((js::String) val);
                bufferQueue.push(std::move(ref));
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            readers[0].noteOff();
            readers[1].noteOff();
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto** inputData = ctx.inputData;
            auto** outputData = ctx.outputData;
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;
            auto const sampleRate = GraphNode<FloatType>::getSampleRate();

            while (bufferQueue.size() > 0) {
                bufferQueue.pop(activeBuffer);
                readers[0] = Reader(sampleRate, activeBuffer);
                readers[1] = Reader(sampleRate, activeBuffer);
            }

            for (size_t j = 0; j < numOuts; ++j) {
                std::fill_n(outputData[j], numSamples, FloatType(0));
            }

            if (numIns < 5 || numOuts == 0 || activeBuffer == nullptr) {
                return;
            }

            size_t i = 0;
            size_t j = 0;

            for (j = 0; j < numSamples; ++j) {
                auto cv = change(inputData[4][j]);
                auto const start = static_cast<double>(inputData[0][j]);
                auto const end = static_cast<double>(inputData[1][j]);
                auto const rate = static_cast<double>(inputData[2][j]);
                auto const gainDb = static_cast<double>(inputData[3][j]);

                if (cv > FloatType(0.5)) {
                    readers[0].sumInto(outputData, numOuts, i, j - i, rate, gainDb);
                    readers[1].sumInto(outputData, numOuts, i, j - i, rate, gainDb);
                    readers[currentReader & 1].noteOff();
                    readers[++currentReader & 1].noteOn(start, end);
                    i = j;
                }
            }

            auto const tailRate = static_cast<double>(inputData[2][numSamples - 1]);
            auto const tailGainDb = static_cast<double>(inputData[3][numSamples - 1]);
            readers[0].sumInto(outputData, numOuts, i, j - i, tailRate, tailGainDb);
            readers[1].sumInto(outputData, numOuts, i, j - i, tailRate, tailGainDb);

            for (size_t c = std::min<size_t>(2, numOuts); c < numOuts; ++c) {
                std::fill_n(outputData[c], numSamples, FloatType(0));
            }
        }

        SingleWriterSingleReaderQueue<SharedResourcePtr> bufferQueue;
        SharedResourcePtr activeBuffer;
        Change<FloatType> change;
        std::array<Reader, 2> readers;
        size_t currentReader = 0;
    };

} // namespace elem
