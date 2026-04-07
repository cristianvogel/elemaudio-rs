#ifndef SIGNALSMITH_DSP_FILTERS_H
#define SIGNALSMITH_DSP_FILTERS_H

#include "common.h"
#include "perf.h"

#include <algorithm>
#include <cmath>

namespace signalsmith { namespace filters {
	enum class BiquadDesign { bilinear, cookbook, oneSided, vicanek };

	template<typename Sample, bool cookbookBandwidth=false>
	class BiquadStatic {
		Sample a1 = 0, a2 = 0, b0 = 1, b1 = 0, b2 = 0;
		Sample x1 = 0, x2 = 0, y1 = 0, y2 = 0;
		static constexpr BiquadDesign bwDesign = cookbookBandwidth ? BiquadDesign::cookbook : BiquadDesign::oneSided;
		enum class Type {highpass, lowpass};

		struct FreqSpec {
			double scaledFreq;
			double w0, sinW0, cosW0;
			double inv2Q;
			FreqSpec(double freq, BiquadDesign) {
				scaledFreq = std::max(1e-6, std::min(0.4999, freq));
				w0 = 2*M_PI*scaledFreq;
				cosW0 = std::cos(w0);
				sinW0 = std::sin(w0);
			}
			void oneSidedCompQ() { inv2Q = 0.7071067811865476; }
		};
		static FreqSpec qSpec(double scaledFreq, double q, BiquadDesign design) {
			FreqSpec spec(scaledFreq, design);
			spec.inv2Q = 0.5/q;
			if (design == BiquadDesign::oneSided) spec.oneSidedCompQ();
			return spec;
		}
		static FreqSpec octaveSpec(double scaledFreq, double octaves, BiquadDesign design) {
			return qSpec(scaledFreq, std::max(0.1, octaves), design);
		}
		BiquadStatic & configure(Type type, FreqSpec calc, BiquadDesign) {
			double alpha = calc.sinW0*calc.inv2Q;
			double a0;
			if (type == Type::highpass) {
				b1 = -1 - calc.cosW0;
				b0 = b2 = (1 + calc.cosW0)*0.5;
				a0 = 1 + alpha;
				a1 = -2*calc.cosW0;
				a2 = 1 - alpha;
			} else {
				b1 = 1 - calc.cosW0;
				b0 = b2 = b1*0.5;
				a0 = 1 + alpha;
				a1 = -2*calc.cosW0;
				a2 = 1 - alpha;
			}
			double invA0 = 1/a0;
			b0 *= invA0; b1 *= invA0; b2 *= invA0; a1 *= invA0; a2 *= invA0;
			return *this;
		}
	public:
		static constexpr double defaultBandwidth = 1.0;
		BiquadStatic & lowpass(double scaledFreq, double octaves=defaultBandwidth, BiquadDesign design=BiquadDesign::bilinear) { return configure(Type::lowpass, octaveSpec(scaledFreq, octaves, design), design); }
		BiquadStatic & highpass(double scaledFreq, double octaves=defaultBandwidth, BiquadDesign design=BiquadDesign::bilinear) { return configure(Type::highpass, octaveSpec(scaledFreq, octaves, design), design); }
		Sample operator()(Sample x0) {
			Sample y0 = x0*b0 + x1*b1 + x2*b2 - y1*a1 - y2*a2;
			y2 = y1; y1 = y0; x2 = x1; x1 = x0;
			return y0;
		}
		void reset() { x1 = x2 = y1 = y2 = 0; }
	};

}}

#endif
