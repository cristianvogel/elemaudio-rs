#pragma once

#include <AudioFFT.h>
#include <TwoStageFFTConvolver.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <optional>
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

    enum class ConvolveWeighting {
        None,
        AWeight,
    };

    template <typename FloatType>
    struct ExtraConvolutionNode : public GraphNode<FloatType> {
        ExtraConvolutionNode(NodeId id, FloatType const sr, int const blockSize)
            : GraphNode<FloatType>::GraphNode(id, sr, blockSize)
            , sampleRate(sr)
        {
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

            if (key == "irTrimDb") {
                if (val.isNull()) {
                    irTrimDb.reset();
                    return rebuildConvolver(resources);
                }

                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed >= 0.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                irTrimDb = parsed;
                return rebuildConvolver(resources);
            }

            if (key == "Weighting") {
                if (!val.isString()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = parseWeighting(std::string((js::String) val));
                if (!parsed.has_value()) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                weighting = *parsed;
                return rebuildConvolver(resources);
            }

            return GraphNode<FloatType>::setProperty(key, val);
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
                convolver->process(inputData[0], outputData, numSamples);
            }

            if constexpr (std::is_same_v<FloatType, double>) {
                auto* scratchDataIn = scratchIn.data();
                auto* scratchDataOut = scratchOut.data();

                extra_convolve_detail::copy_cast_n<double, float>(inputData[0], numSamples, scratchDataIn);
                convolver->process(scratchDataIn, scratchDataOut, numSamples);
                extra_convolve_detail::copy_cast_n<float, double>(scratchDataOut, numSamples, outputData);
            }
        }

        SingleWriterSingleReaderQueue<std::shared_ptr<fftconvolver::TwoStageFFTConvolver>> convolverQueue;
        std::shared_ptr<fftconvolver::TwoStageFFTConvolver> convolver;

        std::vector<float> scratchIn;
        std::vector<float> scratchOut;

    private:
        static std::optional<ConvolveWeighting> parseWeighting(std::string const& value)
        {
            if (value == "none") {
                return ConvolveWeighting::None;
            }
            if (value == "a-weight") {
                return ConvolveWeighting::AWeight;
            }
            return std::nullopt;
        }

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
            auto const trimmedLength = analysedTrimLength(bufferView.data(), bufferView.size());

            auto co = std::make_shared<fftconvolver::TwoStageFFTConvolver>();
            co->reset();
            co->init(512, 4096, bufferView.data(), trimmedLength);
            convolverQueue.push(std::move(co));
            return elem::ReturnCode::Ok();
        }

        size_t analysedTrimLength(float const* ir, size_t irLen) const
        {
            if (!irTrimDb.has_value() || ir == nullptr || irLen == 0) {
                return irLen;
            }

            auto const windowSize = analysisWindowSize(irLen);
            auto const hopSize = std::max<size_t>(1, windowSize / 2);
            auto const metrics = analyseTailWindows(ir, irLen, windowSize, hopSize);
            if (metrics.empty()) {
                return irLen;
            }

            auto const maxMetric = *std::max_element(metrics.begin(), metrics.end());
            if (!(maxMetric > 0.0)) {
                return irLen;
            }

            auto const thresholdLinear = maxMetric * std::pow(10.0, *irTrimDb / 20.0);
            size_t lastSignificantEnd = irLen;
            bool found = false;

            for (size_t i = metrics.size(); i-- > 0;) {
                if (metrics[i] >= thresholdLinear) {
                    auto const analysisEnd = std::min(irLen, i * hopSize + windowSize);
                    auto const safetyEnd = std::min(irLen, analysisEnd + windowSize);
                    lastSignificantEnd = safetyEnd;
                    found = true;
                    break;
                }
            }

            if (!found) {
                return irLen;
            }

            return std::max<size_t>(1, lastSignificantEnd);
        }

        static size_t analysisWindowSize(size_t irLen)
        {
            size_t window = 32;
            while (window < 512 && window < irLen / 2) {
                window <<= 1;
            }
            return std::min(window, std::max<size_t>(32, irLen));
        }

        std::vector<double> analyseTailWindows(float const* ir, size_t irLen, size_t windowSize, size_t hopSize) const
        {
            std::vector<double> metrics;
            for (size_t start = 0; start < irLen; start += hopSize) {
                auto const remaining = irLen - start;
                auto const sizeCopy = std::min(windowSize, remaining);
                metrics.push_back(windowMetric(ir + start, sizeCopy, windowSize));
                if (remaining <= windowSize) {
                    break;
                }
            }
            return metrics;
        }

        double windowMetric(float const* window, size_t sizeCopy, size_t fftSize) const
        {
            if (weighting == ConvolveWeighting::None) {
                double energy = 0.0;
                for (size_t i = 0; i < sizeCopy; ++i) {
                    auto const sample = static_cast<double>(window[i]);
                    energy += sample * sample;
                }
                return std::sqrt(energy / static_cast<double>(std::max<size_t>(1, sizeCopy)));
            }

            audiofft::AudioFFT fft;
            fft.init(fftSize);

            std::vector<float> time(fftSize, 0.0f);
            std::vector<float> re(audiofft::AudioFFT::ComplexSize(fftSize), 0.0f);
            std::vector<float> im(audiofft::AudioFFT::ComplexSize(fftSize), 0.0f);

            for (size_t i = 0; i < sizeCopy; ++i) {
                auto const phase = (2.0 * 3.14159265358979323846 * static_cast<double>(i))
                    / static_cast<double>(std::max<size_t>(1, fftSize - 1));
                auto const hann = 0.5 - 0.5 * std::cos(phase);
                time[i] = static_cast<float>(static_cast<double>(window[i]) * hann);
            }

            fft.fft(time.data(), re.data(), im.data());

            double weightedEnergy = 0.0;
            auto const binCount = re.size();
            for (size_t bin = 1; bin < binCount; ++bin) {
                auto const freq = (static_cast<double>(bin) * static_cast<double>(sampleRate)) / static_cast<double>(fftSize);
                auto const gain = aWeightGain(freq);
                auto const mag2 = static_cast<double>(re[bin]) * static_cast<double>(re[bin])
                    + static_cast<double>(im[bin]) * static_cast<double>(im[bin]);
                weightedEnergy += mag2 * gain * gain;
            }

            return std::sqrt(weightedEnergy / static_cast<double>(std::max<size_t>(1, binCount - 1)));
        }

        static double aWeightGain(double freq)
        {
            if (!(freq > 0.0)) {
                return 0.0;
            }

            auto const f2 = freq * freq;
            auto const ra = (std::pow(12200.0, 2.0) * f2 * f2)
                / ((f2 + std::pow(20.6, 2.0))
                    * std::sqrt((f2 + std::pow(107.7, 2.0)) * (f2 + std::pow(737.9, 2.0)))
                    * (f2 + std::pow(12200.0, 2.0)));
            auto const adb = 20.0 * std::log10(ra) + 2.0;
            return std::pow(10.0, adb / 20.0);
        }

        FloatType sampleRate;
        std::string path;
        std::optional<double> irTrimDb;
        ConvolveWeighting weighting{ConvolveWeighting::None};
    };

} // namespace elem
