# How We Added Stride-Interpolated Delay

Date: 2026-04-08

## Goal

Add `strideDelay` as a first-party extra that follows Geraint Luff's stride-interpolated delay approach, with first-class feedback and explicit fallback modes for larger delay jumps.

## Source Material

Reference article:
- https://signalsmith-audio.co.uk/writing/2021/stride-interpolated-delay/

Core ideas taken from the article:
- Smooth delay slides detune the signal.
- Crossfading between two delay times avoids detuning but adds comb filtering.
- Stride-interpolated delay uses several delay taps spaced by a stride, then interpolates between those taps.
- Large jumps need a fallback so the delay line never reads future samples.

## API Surface

### JS/TS

`@elem-rs/core` exposes:

- `el.extra.strideDelay(props, x)` for mono nodes
- `el.extra.stereoStrideDelay(props, left, right)` as a stereo alias
- `el.mc.strideDelay(props, mc)` for multichannel arrays

### Props

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `delayMs` | `number` | required | Target delay time in milliseconds |
| `fb` | `number` | `0` | Feedback amount |
| `maxDelayMs` | `number` | `1000` | Maximum delay buffer length in milliseconds |
| `strideMs` | `number` | `8` | Stride spacing used for interpolated taps |
| `transitionMs` | `number` | `20` | Crossfade length during a delay transition |
| `maxJumpMs` | `number` | `50` | Maximum jump size before the `step` fallback subdivides the move |
| `fallback` | `"linear" | "dualStrideCrossfade" | "step"` | `"dualStrideCrossfade"` | Large-jump strategy |
| `key` | `string` | none | Stable identity for repeated renders |

## Fallback Modes

### `linear`

Use a simple linear interpolation path for larger jumps.

### `dualStrideCrossfade`

Render two strided delay paths around the old and new delay times, then crossfade between them.

This keeps the transition closer to the article's stride method than a plain crossfade.

### `step`

Subdivide a large jump into smaller transitions until each move fits within `maxJumpMs`.

This is the article's “series of smaller transitions” approach.

## Why Stride Interpolation

The article compares three behaviors:

1. Smooth sliding
2. Crossfading between two delays
3. Stride-interpolated delay

Stride interpolation is a middle ground:

- less detuning than a sliding delay
- less comb filtering than a plain crossfade
- more control over large jumps than either of the above on their own

## Current Native Implementation

The native node lives in `src/native/extra/stridedelay.h` and is registered as `stridedelay` in both runtime entry points:

- `src/ffi/elementary_bridge.cpp`
- `src/vendor/elementary/wasm/Main.cpp`

Implementation details:

- Uses `signalsmith::delay::MultiDelay` from the vendored Signalsmith delay primitives.
- Supports feedback as a first-class prop.
- Reconfigures the delay buffer when `maxDelayMs` changes.
- Uses the selected fallback mode when a target change is too large for the stride path.

## Practical Notes

- `delayMs` is the main control for the effect.
- `fb` should be treated as part of the delay-line state, not a post-mix gain.
- `maxDelayMs` is a buffer capacity, not the audible delay time.
- The `dualStrideCrossfade` fallback is the default because it stays closest to the article's core idea while keeping jumps practical.

## Demo Surface

The web demo exposes the control row for:

- delay time
- feedback
- stride length
- transition length
- maximum jump
- fallback mode

The demo keeps `maxDelayMs` fixed at 1000 ms.

## Validation

After wiring the helper and the demo controls, the following checks passed:

- `cargo check --lib`
- `npm --prefix examples/web-ui run build`
