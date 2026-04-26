# Spectral Convolver FrameLib Design Notes

**Date:** 2026-04-26
**Status:** Design checkpoint for `extra.convolveSpectral` on `spectral-convolver`

## Current Requirement

`extra.convolveSpectral` should prefer FrameLib spectral code for the spectral convolution path while preserving WebUI behavior for `sample-fshift-convolvers`.

The current tilt behavior is accepted:

| `tiltDbPerOct` sign | Behavior |
|---|---|
| Positive | Attenuates lower bins relative to Nyquist |
| Negative | Attenuates higher bins relative to the lowest non-DC bin |

## FrameLib Components In Scope

| Component | Role | Notes |
|---|---|---|
| `FrameLib_Objects/Spectral/FrameLib_Convolve.*` | Reference object for frame-domain convolution | Frame-vector API, not a streaming partitioned convolver |
| `FrameLib_Dependencies/SpectralProcessor.hpp` | FFT/convolution implementation used by `FrameLib_Convolve` | Suitable low-level kernel for custom streaming adapter |
| `FrameLib_Dependencies/SpectralFunctions.hpp` | Spectral multiply/convolution kernels | Current adapter uses `ir_convolve_real` |
| `FrameLib_Dependencies/HISSTools_FFT` | FFT backend | Current native and WASM builds compile this backend |
| `FrameLib_Dependencies/tlsf` | Fast allocator used by FrameLib framework | TLSF itself is not thread-safe; synchronization is the embedding layer's responsibility |

## Why Literal `FrameLib_Convolve` Is Not A Drop-In Replacement

`FrameLib_Convolve` is designed for frame-domain vector convolution:

1. It accepts complete input frames, not a continuous audio stream.
2. It computes both input and IR FFTs for each `process()` call.
3. It allocates temporary spectral buffers during processing through FrameLib allocation utilities.
4. It produces a full frame output of `M + N - 1` samples for linear convolution.
5. It does not expose a precomputed-IR partitioned streaming mode.

For long impulse responses in `sample-fshift-convolvers`, a literal object-based path would need to either:

| Option | Consequence |
|---|---|
| Convolve the entire rolling input history with the entire IR every audio block | High CPU and memory pressure; this already caused practical browser silence/collapse in the direct full-frame rewrite |
| Run one `FrameLib_Convolve` per IR partition every audio block | Recomputes each IR partition FFT every block, losing the key performance property of partitioned convolution |
| Keep current precomputed IR spectra and only use `FrameLib_Convolve` for input blocks | Not supported by `FrameLib_Convolve`; requires lower-level `spectral_processor` APIs |

## TLSF Thread-Safety Notes

FrameLib includes TLSF, but TLSF is not thread-safe by itself. The relevant safety boundary is allocator ownership:

| Allocator ownership | Thread-safety impact |
|---|---|
| One allocator per audio node, accessed only from that node's audio thread | No shared TLSF state; no cross-thread TLSF races |
| Shared allocator across nodes or control/audio threads | Requires an external lock or FrameLib's own allocator wrapper |
| FrameLib framework `FrameLib_GlobalAllocator` | Wraps allocation with FrameLib synchronization and pool management |

The current spectral convolver adapter uses a per-node TLSF allocator for FrameLib spectral temporary storage. That avoids TLSF sharing across nodes, but it is not the same as hosting the full FrameLib framework allocator/context.

## Recommended Architecture

Build a first-party streaming object modeled on `FrameLib_Convolve`, rather than instantiating `FrameLib_Convolve` literally inside `GraphNode::process()`.

The object should live outside `src/vendor/` and use FrameLib spectral primitives directly:

| Layer | Responsibility |
|---|---|
| `extra.convolveSpectral` Elementary node | Resource loading, props, channel input/output, graph API stability |
| FrameLib-backed streaming adapter | Partitioned overlap-add scheduling, precomputed IR spectra, rolling input spectra |
| FrameLib spectral kernel | HISSTools FFT, real spectral convolution multiply, inverse FFT |
| Allocator policy | Per-node allocator or FrameLib framework allocator wrapper with explicit synchronization semantics |

This keeps the streaming behavior required by Elementary/WebAudio while reusing the same spectral implementation family that `FrameLib_Convolve` uses internally.

## Proposed Next Implementation Step

Create a named adapter such as `FrameLibStreamingConvolve` with these constraints:

1. Keep IR partition spectra precomputed on property/resource rebuild.
2. Keep input spectra as a ring buffer.
3. Use FrameLib/HISSTools FFT and `ir_convolve_real` for the spectral multiply path.
4. Keep `FrameLib_Convolve.cpp` as the reference behavior for edge handling and scaling.
5. Avoid direct `FrameLib_Convolve::process()` in the audio callback for long streaming IRs.
6. Document allocator ownership explicitly: per-node TLSF, no cross-thread sharing, or full FrameLib allocator/context if the framework is embedded later.

## Validation Targets

| Target | Purpose |
|---|---|
| `cargo test --test extra_convolve_spectral` | Native functional regression |
| `cargo build` | Native bridge/link validation |
| `scripts/rebuild-web-wasm.sh` | Browser runtime validation |
| `npm --prefix examples/web-ui run build` | WebUI bundle validation |
| `sample-fshift-convolvers` human QA | Confirms static and spectral branches do not silence each other |
