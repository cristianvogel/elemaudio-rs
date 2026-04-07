#ifndef SIGNALSMITH_DSP_COMMON_H
#define SIGNALSMITH_DSP_COMMON_H

#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846264338327950288
#endif

namespace signalsmith {
	constexpr bool versionCheck(int major, int minor, int patch=0) {
		return major == 1 && minor <= 7 && patch <= 0;
	}

	#define SIGNALSMITH_DSP_VERSION_CHECK(major, minor, patch) \
		static_assert(::signalsmith::versionCheck(major, minor, patch), "signalsmith library version mismatch")
}

#endif
