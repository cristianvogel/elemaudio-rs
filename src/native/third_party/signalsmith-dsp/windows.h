#ifndef SIGNALSMITH_DSP_WINDOWS_H
#define SIGNALSMITH_DSP_WINDOWS_H

#include "common.h"

#include <algorithm>
#include <cmath>

namespace signalsmith { namespace windows {
	class Kaiser {
		double beta;
		double invB0;

		static double bessel0(double x) {
			double result = 0, term = 1, m = 0;
			while (term > 1e-4) {
				result += term;
				++m;
				term *= (x*x)/(4*m*m);
			}
			return result;
		}
	public:
		Kaiser(double beta) : beta(beta), invB0(1/bessel0(beta)) {}
		static Kaiser withBandwidth(double bandwidth, bool heuristicOptimal=false) {
			if (heuristicOptimal) {
				bandwidth = bandwidth + 8/((bandwidth + 3)*(bandwidth + 3)) + 0.25*std::max(3 - bandwidth, 0.0);
			}
			double alpha = std::sqrt(std::max(0.0, bandwidth*bandwidth*0.25 - 1));
			return Kaiser(alpha*M_PI);
		}
		template<typename Data>
		void fill(Data &&data, int size) const {
			double invSize = 1.0/size;
			for (int i = 0; i < size; ++i) {
				double r = (2*i + 1)*invSize - 1;
				double arg = std::sqrt(std::max(0.0, 1 - r*r));
				data[i] = bessel0(beta*arg)*invB0;
			}
		}
	};
}}

#endif
