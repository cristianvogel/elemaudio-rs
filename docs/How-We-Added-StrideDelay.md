# How We Added `strideDelay`

Date: 2026-04-23

## Goal

Add the stride-interpolated delay helper as a repo-owned extra with the same shape on Rust and TS.

## Current API

### Rust

```rust
extra::stride_delay(props, delay_ms, fb, x)
extra::stereo_stride_delay(props, delay_ms, fb, left, right)
extra::stride_delay_with_insert(props, delay_ms, fb, insert, x)
extra::stereo_stride_delay_with_insert(props, delay_ms, fb, insert, left, right)
```

### TS

```ts
el.extra.strideDelay(props, delayMs, fb, x)
el.extra.stereoStrideDelay(props, delayMs, fb, left, right)
el.extra.strideDelayWithInsert(props, delayMs, fb, insert, x)
el.extra.stereoStrideDelayWithInsert(props, delayMs, fb, insert, left, right)
```

## Shape

- `delayMs` and `fb` are signal children
- `x` is the mono input for the mono helper
- the stereo helper takes explicit left/right inputs
- props currently support `maxDelayMs`, `transitionMs`, `bigLeapMode`, and `fbtap`
- `bigLeapMode` is `"linear"` or `"step"`

## Implementation notes

- the native node is `stridedelay`
- it is registered in both runtime entry points
- `strideDelayWithInsert` uses a named tap pair and a one-block feedback path

## Demo notes

The plugin example uses the same delay helper shape. The browser demo also uses the TS helper directly.
