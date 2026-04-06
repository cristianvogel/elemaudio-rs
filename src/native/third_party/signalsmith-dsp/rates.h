#ifndef SIGNALSMITH_DSP_RATES_H
#define SIGNALSMITH_DSP_RATES_H

#include "common.h"
#include "windows.h"

#include <vector>

namespace signalsmith { namespace rates {
	template<class Data>
	void fillKaiserSinc(Data &&data, int length, double passFreq, double stopFreq) {
		if (length <= 0) return;
		double kaiserBandwidth = (stopFreq - passFreq)*length + 1.25/((stopFreq - passFreq)*length);
		auto kaiser = signalsmith::windows::Kaiser::withBandwidth(kaiserBandwidth);
		kaiser.fill(data, length);
		double centreIndex = (length - 1)*0.5;
		double sincScale = M_PI*(passFreq + stopFreq);
		double ampScale = (passFreq + stopFreq);
		for (int i = 0; i < length; ++i) {
			double x = (i - centreIndex), px = x*sincScale;
			double sinc = (std::abs(px) > 1e-6) ? std::sin(px)*ampScale/px : ampScale;
			data[i] *= sinc;
		}
	}

	template<typename Sample>
	struct Oversampler2xFIR {
		Oversampler2xFIR() : Oversampler2xFIR(0, 0) {}
		Oversampler2xFIR(int channels, int maxBlock, int halfLatency=16, double passFreq=0.43) {
			resize(channels, maxBlock, halfLatency, passFreq);
		}

		void resize(int nChannels, int maxBlockLength, int halfLatency=16, double passFreq=0.43) {
			oneWayLatency = halfLatency;
			kernelLength = oneWayLatency*2;
			channels = nChannels;
			halfSampleKernel.resize(kernelLength);
			fillKaiserSinc(halfSampleKernel, kernelLength, passFreq, 1 - passFreq);
			inputStride = kernelLength + maxBlockLength;
			inputBuffer.resize(channels*inputStride);
			stride = (maxBlockLength + kernelLength)*2;
			buffer.resize(stride*channels);
		}

		void reset() {
			std::fill(inputBuffer.begin(), inputBuffer.end(), Sample(0));
			std::fill(buffer.begin(), buffer.end(), Sample(0));
		}

		void upChannel(int c, Sample const* data, int lowSamples) {
			Sample *inputChannel = inputBuffer.data() + c*inputStride;
			for (int i = 0; i < lowSamples; ++i) inputChannel[kernelLength + i] = data[i];
			Sample *output = (*this)[c];
			for (int i = 0; i < lowSamples; ++i) {
				output[2*i] = inputChannel[i + oneWayLatency];
				Sample *offsetInput = inputChannel + (i + 1);
				Sample sum = 0;
				for (int o = 0; o < kernelLength; ++o) sum += offsetInput[o]*halfSampleKernel[o];
				output[2*i + 1] = sum;
			}
			for (int i = 0; i < kernelLength; ++i) inputChannel[i] = inputChannel[lowSamples + i];
		}

		void downChannel(int c, Sample *data, int lowSamples) {
			Sample *input = buffer.data() + c*stride;
			for (int i = 0; i < lowSamples; ++i) {
				Sample v1 = input[2*i + kernelLength];
				Sample sum = 0;
				for (int o = 0; o < kernelLength; ++o) sum += input[2*(i + o) + 1]*halfSampleKernel[o];
				data[i] = (v1 + sum)*Sample(0.5);
			}
			for (int i = 0; i < kernelLength*2; ++i) input[i] = input[lowSamples*2 + i];
		}

		Sample * operator[](int c) { return buffer.data() + kernelLength*2 + stride*c; }
		Sample const * operator[](int c) const { return buffer.data() + kernelLength*2 + stride*c; }

		int oneWayLatency = 0, kernelLength = 0;
		int channels = 0;
		int stride = 0, inputStride = 0;
		std::vector<Sample> inputBuffer;
		std::vector<Sample> halfSampleKernel;
		std::vector<Sample> buffer;
	};

}}

#endif
