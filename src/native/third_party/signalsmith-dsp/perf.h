#ifndef SIGNALSMITH_DSP_PERF_H
#define SIGNALSMITH_DSP_PERF_H

#include "common.h"

#if defined(__GNUC__)
#define SIGNALSMITH_INLINE __attribute__((always_inline)) inline
#else
#define SIGNALSMITH_INLINE inline
#endif

#endif
