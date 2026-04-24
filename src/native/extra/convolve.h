#pragma once

#include <TwoStageFFTConvolver.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <memory>
#include <string>
#include <vector>

#include <elem/GraphNode.h>
#include <elem/SingleWriterSingleReaderQueue.h>

namespace elem
{

    namespace extra_convolve_detail
    {
        template <typename FromType, typename ToType>
        void copy_cast_n(FromType const* input, size_t numSamples, ToType* output)
        {
            for (size_t i = 0; i < numSamples; ++i) {
                output[i] = static_cast<ToType>(input[i]);
            }
        }
    }

    template <typename FloatType>
    struct ExtraConvolutionNode : public GraphNode<FloatType> {
        ExtraConvolutionNode(NodeId id, FloatType const sr, int const blockSize)
            : GraphNode<FloatType>::GraphNode(id, sr, blockSize)
            , attackCoeff(timeConstantCoeff(sr, 0.001))
            , releaseCoeff(timeConstantCoeff(sr, 0.050))
        {
            scratchFloatIn.resize(blockSize);
            scratchFloatOut.resize(blockSize);
            if constexpr (std::is_same_v<FloatType, double>) {
                scratchIn.resize(blockSize);
                scratchOut.resize(blockSize);
            }
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "path") {
                if (!val.isString()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const nextPath = std::string((js::String) val);
                if (!resources.has(nextPath)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                path = nextPath;
                return rebuildConvolver(resources);
            }

            if (key == "start") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 0.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                start.store(parsed, std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "end") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 0.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                end.store(parsed, std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "irAttenuationDb") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 0.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                irAttenuationGain.store(dbToGain(-parsed), std::memory_order_relaxed);
                refreshRunawayGain(resources);
                return GraphNode<FloatType>::setProperty(key, val);
            }

            if (key == "normalize") {
                if (!val.isBool()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                normalizeEnabled.store(static_cast<bool>((js::Boolean) val), std::memory_order_relaxed);
                return GraphNode<FloatType>::setProperty(key, val);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            inputEnvelope = 0.0;
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto** inputData = ctx.inputData;
            auto* outputData = ctx.outputData[0];
            auto numChannels = ctx.numInputChannels;
            auto numSamples = ctx.numSamples;

            while (convolverQueue.size() > 0) {
                convolverQueue.pop(convolver);
            }

            if (numChannels == 0 || convolver == nullptr) {
                std::fill_n(outputData, numSamples, FloatType(0));
                return;
            }

            if constexpr (std::is_same_v<FloatType, float>) {
                auto const* sourceInput = inputData[0];
                auto const irGain = irAttenuationGain.load(std::memory_order_relaxed);
                auto const normalize = normalizeEnabled.load(std::memory_order_relaxed);
                for (size_t i = 0; i < numSamples; ++i) {
                    auto const source = static_cast<double>(sourceInput[i]);
                    auto const prepared = normalize ? applyRealtimeNormalization(source) : source;
                    scratchFloatIn[i] = std::isfinite(prepared) ? static_cast<float>(prepared) : 0.0f;
                }

                convolver->process(scratchFloatIn.data(), scratchFloatOut.data(), numSamples);

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const wet = static_cast<double>(scratchFloatOut[i]) * irGain;
                    outputData[i] = std::isfinite(wet) ? static_cast<FloatType>(wet) : FloatType(0);
                }
            }

            if constexpr (std::is_same_v<FloatType, double>) {
                auto const* sourceInput = inputData[0];
                auto* scratchDataIn = scratchIn.data();
                auto* scratchDataOut = scratchOut.data();
                auto const irGain = irAttenuationGain.load(std::memory_order_relaxed);
                auto const normalize = normalizeEnabled.load(std::memory_order_relaxed);

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const source = static_cast<double>(sourceInput[i]);
                    auto const prepared = normalize ? applyRealtimeNormalization(source) : source;
                    scratchDataIn[i] = std::isfinite(prepared) ? static_cast<float>(prepared) : 0.0f;
                }

                convolver->process(scratchDataIn, scratchDataOut, numSamples);

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const wet = static_cast<double>(scratchDataOut[i]) * irGain;
                    outputData[i] = std::isfinite(wet) ? static_cast<FloatType>(wet) : FloatType(0);
                }
            }
        }

        SingleWriterSingleReaderQueue<std::shared_ptr<fftconvolver::TwoStageFFTConvolver>> convolverQueue;
        std::shared_ptr<fftconvolver::TwoStageFFTConvolver> convolver;

        std::vector<float> scratchIn;
        std::vector<float> scratchOut;
        std::vector<float> scratchFloatIn;
        std::vector<float> scratchFloatOut;

    private:
        int rebuildConvolver(SharedResourceMap& resources)
        {
            if (path.empty()) {
                return elem::ReturnCode::Ok();
            }

            auto resource = resources.get(path);
            if (resource == nullptr) {
                return elem::ReturnCode::InvalidPropertyValue();
            }

            auto bufferView = resource->getChannelData(0);
            auto slicedIr = prepareIr(bufferView);

            runawayGainCoeff.store(computeRunawayGainCoeff(slicedIr.data(), slicedIr.size()), std::memory_order_relaxed);

            auto co = std::make_shared<fftconvolver::TwoStageFFTConvolver>();
            co->reset();
            co->init(512, 4096, slicedIr.data(), slicedIr.size());
            convolverQueue.push(std::move(co));
            return elem::ReturnCode::Ok();
        }

        void refreshRunawayGain(SharedResourceMap& resources)
        {
            if (path.empty()) {
                runawayGainCoeff.store(1.0, std::memory_order_relaxed);
                return;
            }

            auto resource = resources.get(path);
            if (resource == nullptr) {
                runawayGainCoeff.store(1.0, std::memory_order_relaxed);
                return;
            }

            auto bufferView = resource->getChannelData(0);
            auto slicedIr = prepareIr(bufferView);
            runawayGainCoeff.store(computeRunawayGainCoeff(slicedIr.data(), slicedIr.size()), std::memory_order_relaxed);
        }

        double computeRunawayGainCoeff(float const* ir, size_t len) const
        {
            double l1 = 0.0;
            double peak = 0.0;
            auto const irGain = irAttenuationGain.load(std::memory_order_relaxed);
            for (size_t i = 0; i < len; ++i) {
                auto const magnitude = std::abs(static_cast<double>(ir[i]) * irGain);
                l1 += magnitude;
                peak = std::max(peak, magnitude);
            }
            return std::max(1.0, 0.5 * l1 + 0.5 * peak);
        }

        static double dbToGain(double db)
        {
            return std::pow(10.0, db / 20.0);
        }

        static double timeConstantCoeff(double sampleRate, double seconds)
        {
            return 1.0 - std::exp(-1.0 / std::max(1.0, sampleRate * seconds));
        }

        double applyRealtimeNormalization(double inputSample)
        {
            auto const coeffScale = runawayGainCoeff.load(std::memory_order_relaxed);
            auto const magnitude = std::abs(inputSample);
            auto const coeff = magnitude > inputEnvelope ? attackCoeff : releaseCoeff;
            inputEnvelope += coeff * (magnitude - inputEnvelope);

            auto const predicted = inputEnvelope * coeffScale;
            auto const gain = predicted > 1.0 ? (1.0 / predicted) : 1.0;
            auto const makeup = std::sqrt(std::max(1.0, coeffScale));
            auto const result = inputSample * gain * makeup;
            return std::isfinite(result) ? result : 0.0;
        }

        std::vector<float> prepareIr(BufferView<float> const& bufferView) const
        {
            auto const irLen = bufferView.size();
            std::vector<float> prepared;

            if (irLen == 0) {
                prepared.push_back(0.0f);
                return prepared;
            }

            auto const startNorm = std::clamp(start.load(std::memory_order_relaxed), 0.0, 1.0);
            auto const endNorm = std::clamp(end.load(std::memory_order_relaxed), 0.0, 1.0);
            auto const startIndex = std::min(static_cast<size_t>(startNorm * static_cast<double>(irLen)), irLen);
            auto const endIndex = std::min(static_cast<size_t>(endNorm * static_cast<double>(irLen)), irLen);

            auto const lo = std::min(startIndex, endIndex);
            auto const hi = std::max(startIndex, endIndex);

            if (lo < hi) {
                prepared.assign(bufferView.data() + lo, bufferView.data() + hi);
            } else {
                prepared.push_back(bufferView.data()[std::min(lo, irLen - 1)]);
            }

            if (endIndex < startIndex) {
                std::reverse(prepared.begin(), prepared.end());
            }

            return prepared;
        }

        std::string path;
        std::atomic<double> start{0.0};
        std::atomic<double> end{1.0};
        std::atomic<double> irAttenuationGain{1.0};
        std::atomic<bool> normalizeEnabled{false};
        std::atomic<double> runawayGainCoeff{1.0};
        double inputEnvelope{0.0};
        double attackCoeff;
        double releaseCoeff;
    };

} // namespace elem
