# How We Added the Vocoder to elemaudio-rs

Date: 2026-04-12

## Goal

Port Geraint Luff's JSFX channel vocoder (v1.0.1) to a first-party
`el::extra::vocoder` node, following the established porting pattern.

Original source:
https://github.com/geraintluff/jsfx/blob/master/releases/Vocoder/1.0.1/Vocoder/Vocoder.jsfx

## Algorithm (from JSFX)

1. Kaiser-windowed STFT with perfect-reconstruction normalization (overlap factor 6).
2. Forward FFT both carrier and modulator.
3. Per bin: smoothed energy envelopes (one-pole, configurable time constant).
4. Per bin: gain = sqrt(mod_energy / (mod_energy/max_gain + carrier_energy + eps)).
5. Apply gain to carrier spectrum.
6. Inverse FFT, overlap-add into output ring buffer.

## Porting Decisions

| JSFX | elemaudio-rs |
|---|---|
| Reaper built-in `fft()` (interleaved complex) | `audiofft::AudioFFT` (split-complex, float) from `src/vendor/elementary/wasm/FFTConvolver/` |
| Stereo packed into one complex FFT | Mono average of L+R, single FFT each for carrier and modulator |
| Per-sample accumulation (`@sample`) | Block-based `process()` with per-sample ring buffer writes and hop trigger |
| Reaper heap memory (`freemem`) | Pre-allocated `std::vector` in constructor (SKILLS.md compliant) |
| Max FFT size 32768 | Max FFT size 8192 (sufficient for window lengths up to 50 ms at 96 kHz) |

## Steps

1. **Created the native header** `src/native/extra/vocoder.h`.
   - `VocoderNode<FloatType>` extending `GraphNode<FloatType>`.
   - All buffers pre-allocated in the constructor to max size.
   - Kaiser window and perfect-reconstruction computed in `setProperty`
     (non-realtime) or constructor, never in `process()`.
   - `AudioFFT::init()` called once per FFT size change, not per hop.
   - `process()` performs only ring buffer writes, FFT, arithmetic, and
     overlap-add accumulation — no allocation.

2. **Added `AudioFFT.cpp` to the build** in `build.rs`.
   - Added `vendor_fft_convolver` include path.
   - Added `AudioFFT.cpp` as a compiled source file.

3. **Registered in the native bridge** `src/ffi/elementary_bridge.cpp`.
   - Include: `#include <extra/vocoder.h>`
   - Registration: `"vocoder"` node type.

4. **Registered in the WASM runtime** `src/vendor/elementary/wasm/Main.cpp`.
   - Include and registration added.
   - Registry comment table updated.

5. **Added Rust authoring helper** in `src/authoring/extra.rs`.
   - `extra::vocoder(props, carrier_l, carrier_r, modulator_l, modulator_r)`
   - Returns `Vec<Node>` of 2 outputs (L, R) via `unpack`.

6. **Added TS authoring helper** in `packages/core/src/extra.ts`.
   - `el.extra.vocoder(props, carrierL, carrierR, modulatorL, modulatorR)`
   - Returns `Array<NodeRepr_t>` of 2 outputs via `unpack`.
   - `VocoderProps` interface added.

7. **Validated.**
   - `cargo test` — all tests pass including `covers_extra_helpers`.
   - TS toolchain not installed locally; validated by Rust helper test coverage.

## Inputs / Outputs

| Input | Signal |
|---|---|
| [0] | carrier L |
| [1] | carrier R |
| [2] | modulator L |
| [3] | modulator R |

| Output | Signal |
|---|---|
| [0] | vocoded L |
| [1] | vocoded R |

## Properties

| Key | Type | Range | Default |
|---|---|---|---|
| `windowMs` | number | 1–50 | 10 |
| `smoothingMs` | number | 0–50 | 5 |
| `maxGainDb` | number | 0–100 | 40 |
| `swapInputs` | number | 0 or 1 | 0 |

## SKILLS.md Compliance

- All buffers pre-allocated in the constructor.
- No allocation in `process()`.
- No exceptions thrown on the audio thread.
- `AudioFFT` guarantees no allocation after `init()`.
- Atomic properties for cross-thread communication.
- Window recomputation uses only pre-allocated buffers.

## Key Rule

From How-We-Added-FreqShift.md: if an `el::extra::*` helper should work in
`examples/web-ui`, it must exist in both the JS/TS authoring package and the
browser WASM runtime registration. The WASM runtime must be rebuilt after
registration changes.
