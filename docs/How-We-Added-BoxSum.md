# How We Added BoxSum

Date: 2026-04-10 (Updated for dual-signature API supporting both static and dynamic windows)

## Goal

Add first-party `el.extra.boxSum(...)` and `el.extra.boxAverage(...)` helpers for sample-accurate variable-width box filter sum and average.

The helpers support two usage patterns:
1. **Static window with keying**: Pass props for parameter updates without graph rebuild via fast-path keying
2. **Dynamic window signal**: Pass a signal node for sample-rate accurate modulation at runtime

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

`@elem-rs/core` exposes two signatures for each helper:

### Static Window (Keying Support)
```typescript
el.extra.boxSum(props: BoxSumProps, x: ElemNode): NodeRepr_t
el.extra.boxAverage(props: BoxAverageProps, x: ElemNode): NodeRepr_t
```

Props format:
- `window`: number, window length in samples (required)
- `key`: string, optional prefix for stable node identity (enables fast-path updates)

### Dynamic Window (Sample-Rate Modulation)
```typescript
el.extra.boxSum(window: ElemNode, x: ElemNode): NodeRepr_t
el.extra.boxAverage(window: ElemNode, x: ElemNode): NodeRepr_t
```

Pass a signal node directly for runtime sample-rate control. No keying available in this mode.

## Capabilities

- **Static window with keying**: Pass props with `window` and `key` → updates via `mounted.node_with_key("{key}_window").set_const_value(newWindow)` (O(1))
- **Dynamic window signal**: Pass a signal node → updates via graph parameter modulation at sample rate (O(1) per sample)
- `boxSum` returns the raw sum
- `boxAverage` returns the normalized average
- Mono only

## Why It Is Useful

The box-sum helper is a simple primitive that is missing from the vendor core surface.

Special qualities:

1. Finite impulse response
2. No overshoot
3. Good as a smoothing stage for positive-only values
4. Efficient when implemented cumulatively
5. Stable long-running behavior when reset logic is handled correctly
6. Sample-rate window width modulation support

## Performance Characteristics

### Static Window with Keying (O(1) updates)

Use when the window needs to be updated but the surrounding graph structure is stable.

```typescript
const graph = el.Graph().render(
  el.extra.boxSum(
    { key: "filter", window: 256 },
    el.white()
  )
);

const mounted = graph.mount();
runtime.execute(mounted.batch());

// Later: update window without rebuilding the entire graph
const windowNode = mounted.node_with_key("filter_window");
if (windowNode) {
  runtime.execute(windowNode.set_const_value(512));
}
```

### Dynamic Window Signal (Sample-Rate Modulation)

Use when the window needs to change at sample rate or follow a signal envelope.

```typescript
// Window modulated by an LFO
const windowLfo = el.mul(
  el.add(el.const_(256), el.const_(256)),
  el.cycle(el.const_(0.5))  // 0.5 Hz oscillation
);

const graph = el.Graph().render(
  el.extra.boxSum(windowLfo, el.white())
);

const mounted = graph.mount();
runtime.execute(mounted.batch());

// Window changes smoothly at sample rate, no further updates needed
```

### Trade-off Summary

| Mode | Update Latency | Graph Rebuild | Sample-Rate Control | Use Case |
|------|-----------------|---------------|--------------------|----------|
| Static + Keying | O(1), direct property update | No | No | Parameter adjustment during playback |
| Dynamic Signal | None (inherent to signal) | No | Yes | Time-varying effects (LFO, envelope) |

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
