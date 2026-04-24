# How We Added `boxSum` and `boxAverage`

Date: 2026-04-23

## Goal

Add first-party box filter helpers that work with either a static window or a window signal.

## Current API

### Rust

```rust
extra::box_sum(window, x)
extra::box_average(window, x)
```

### TS

```ts
el.extra.boxSum(windowOrProps, x)
el.extra.boxAverage(windowOrProps, x)
```

## Shape

- static mode takes a props object with `window`
- dynamic mode takes a signal node for the window
- keyed static mode supports `key` and updates via `{key}_window`
- `window` must be positive

## Implementation notes

- the native node is `boxsum`
- the helper is registered in both runtime entry points
- invalid static `window` values return silence on the Rust side and throw on the TS side

## Demo notes

The browser demo uses the helper directly to smooth white noise and to modulate oscillator frequency.
