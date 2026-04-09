# How We Added BoxSum

Date: 2026-04-08

## Goal

Add first-party `el.extra.boxSum(windowSamples, x)` and `el.extra.boxAverage(windowSamples, x)` helpers for sample accurate variable-width box filter sum and average. The window sample size can be an integer or a signal. If signal, the box width can be changed at sample-rate.

## Source Material

Reference article:
- https://signalsmith-audio.co.uk/writing/2021/box-sum-cumulative/

Core ideas taken from the article:
- a box filter is a rectangular moving average / rolling sum over a window
- cumulative sums are an efficient way to compute the result
- floating-point drift matters in long-running audio graphs
- variable-width windows need reset logic or a stable cumulative strategy
- the Bumpy Wheel approach is useful when the window width changes while running

## API Surface

`@elem-rs/core` exposes:

- `el.extra.boxSum(windowSamplesNode, x)`
- `el.extra.boxAverage(windowSamplesNode, x)`

The helpers are:
- mono only
- `boxSum` returns the raw sum
- `boxAverage` returns the normalized average
- driven by a `NodeRepr_t` window-size input in samples so the window can change dynamically
- the first input can be a node or a numeric value, matching the usual `el.*` helper contract

## Why It Is Useful

The box-sum helper is a simple primitive that is missing from the vendor core surface.

Special qualities:

1. Finite impulse response
2. No overshoot
3. Good as a smoothing stage for positive-only values
4. Efficient when implemented cumulatively
5. Stable long-running behavior when reset logic is handled correctly
6. Sample-rate window width modulation support

## Current Native Implementation

The native node lives in `src/native/extra/boxsum.h` and is registered as `boxsum` in both runtime entry points:

- `src/ffi/elementary_bridge.cpp`
- `src/vendor/elementary/wasm/Main.cpp`

Implementation details:

- uses `signalsmith::envelopes::BoxSum`
- takes the window-size input as the first input and the summed signal as the second input node
- rounds the window input to an integer sample count internally
- clamps the width to a fixed internal buffer capacity (10 seconds)

## Demo Surface

The web demo exposes:

- window samples
- center cutoff
- swing
- tone frequency

The audible result is a saw pair whose timbre is modulated by the box sum of white noise.

## Validation

After wiring the helper and demo, the following checks passed:

- `cargo check --lib`
- `npm --prefix examples/web-ui run build`
