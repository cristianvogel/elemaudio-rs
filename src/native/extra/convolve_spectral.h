#pragma once

#include <AudioFFT.h>
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
    template <typename FloatType>
    struct SpectralConvolutionNode : public GraphNode<FloatType> {
        SpectralConvolutionNode(NodeId id, FloatType const sr, int const blockSize)
            : GraphNode<FloatType>::GraphNode(id, sr, blockSize)
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

            if (key == "partitionSize") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 16.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                partitionSize.store(nextPowerOf2(static_cast<size_t>(parsed)), std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "tailBlockSize") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 16.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                tailBlockSize.store(nextPowerOf2(static_cast<size_t>(parsed)), std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "magnitudeGainDb") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                magnitudeGain.store(dbToGain(parsed), std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "tiltDbPerOct") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                tiltDbPerOct.store(parsed, std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            if (key == "blur") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 0.0 || parsed >= 1.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                blur.store(parsed, std::memory_order_relaxed);
                return rebuildConvolver(resources);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override {}

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
                for (size_t i = 0; i < numSamples; ++i) {
                    auto const source = static_cast<double>(sourceInput[i]);
                    scratchFloatIn[i] = std::isfinite(source) ? static_cast<float>(source) : 0.0f;
                }

                convolver->process(scratchFloatIn.data(), scratchFloatOut.data(), numSamples);

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const wet = static_cast<double>(scratchFloatOut[i]);
                    outputData[i] = std::isfinite(wet) ? static_cast<FloatType>(wet) : FloatType(0);
                }
            }

            if constexpr (std::is_same_v<FloatType, double>) {
                auto const* sourceInput = inputData[0];
                auto* scratchDataIn = scratchIn.data();
                auto* scratchDataOut = scratchOut.data();

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const source = static_cast<double>(sourceInput[i]);
                    scratchDataIn[i] = std::isfinite(source) ? static_cast<float>(source) : 0.0f;
                }

                convolver->process(scratchDataIn, scratchDataOut, numSamples);

                for (size_t i = 0; i < numSamples; ++i) {
                    auto const wet = static_cast<double>(scratchDataOut[i]);
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
            auto preparedIr = prepareSpectralIr(bufferView);

            auto co = std::make_shared<fftconvolver::TwoStageFFTConvolver>();
            co->reset();
            auto const headSize = partitionSize.load(std::memory_order_relaxed);
            auto const tailSize = std::max(headSize, tailBlockSize.load(std::memory_order_relaxed));
            co->init(headSize, tailSize, preparedIr.data(), preparedIr.size());
            convolverQueue.push(std::move(co));
            return elem::ReturnCode::Ok();
        }

        std::vector<float> prepareSpectralIr(BufferView<float> const& bufferView) const
        {
            auto const irLen = bufferView.size();
            if (irLen == 0) {
                return {0.0f};
            }

            auto const partSize = std::max<size_t>(16, partitionSize.load(std::memory_order_relaxed));
            auto const fftSize = partSize * 2;
            auto const complexSize = audiofft::AudioFFT::ComplexSize(fftSize);
            auto const partitionCount = (irLen + partSize - 1) / partSize;
            auto const gain = magnitudeGain.load(std::memory_order_relaxed);
            auto const tilt = tiltDbPerOct.load(std::memory_order_relaxed);
            auto const blurAmount = blur.load(std::memory_order_relaxed);

            audiofft::AudioFFT fft;
            fft.init(fftSize);

            std::vector<float> frame(fftSize, 0.0f);
            std::vector<float> re(complexSize, 0.0f);
            std::vector<float> im(complexSize, 0.0f);
            std::vector<float> previousMagnitude(complexSize, 0.0f);
            std::vector<float> prepared(partitionCount * partSize, 0.0f);

            for (size_t partition = 0; partition < partitionCount; ++partition) {
                std::fill(frame.begin(), frame.end(), 0.0f);
                auto const offset = partition * partSize;
                auto const copyCount = std::min(partSize, irLen - offset);
                std::copy_n(bufferView.data() + offset, copyCount, frame.data());

                fft.fft(frame.data(), re.data(), im.data());

                for (size_t bin = 0; bin < complexSize; ++bin) {
                    auto const real = static_cast<double>(re[bin]);
                    auto const imag = static_cast<double>(im[bin]);
                    auto magnitude = std::sqrt(real * real + imag * imag);

                    if (blurAmount > 0.0 && partition > 0) {
                        magnitude = (1.0 - blurAmount) * magnitude + blurAmount * previousMagnitude[bin];
                    }

                    previousMagnitude[bin] = static_cast<float>(magnitude);

                    auto const binGain = spectralBinGain(bin, complexSize, tilt) * gain;
                    auto const scaledMagnitude = magnitude * binGain;
                    auto const phaseScale = magnitude > 1.0e-20 ? scaledMagnitude / magnitude : 0.0;
                    re[bin] = static_cast<float>(real * phaseScale);
                    im[bin] = static_cast<float>(imag * phaseScale);
                }

                fft.ifft(frame.data(), re.data(), im.data());
                std::copy_n(frame.data(), copyCount, prepared.data() + offset);
            }

            return prepared;
        }

        static size_t nextPowerOf2(size_t value)
        {
            size_t result = 1;
            while (result < value) {
                result <<= 1;
            }
            return result;
        }

        static double dbToGain(double db)
        {
            return std::pow(10.0, db / 20.0);
        }

        static double spectralBinGain(size_t bin, size_t complexSize, double tiltDb)
        {
            if (std::abs(tiltDb) < 1.0e-12 || bin == 0 || complexSize <= 1) {
                return 1.0;
            }

            auto const normalized = static_cast<double>(bin) / static_cast<double>(complexSize - 1);
            auto const octavesFromNyquist = std::log2(std::max(normalized, 1.0 / static_cast<double>(complexSize - 1)));
            return dbToGain(tiltDb * octavesFromNyquist);
        }

        std::string path;
        std::atomic<size_t> partitionSize{512};
        std::atomic<size_t> tailBlockSize{4096};
        std::atomic<double> magnitudeGain{1.0};
        std::atomic<double> tiltDbPerOct{0.0};
        std::atomic<double> blur{0.0};
    };

} // namespace elem
