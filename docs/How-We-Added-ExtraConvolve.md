# How We Added `extra.convolve`

Date: 2026-04-24

## Goal

Add a repo-owned `el::extra::convolve` / `el.extra.convolve` helper that extends the vendor convolver with analytical impulse-response preprocessing.

## Current API

### Rust

```rust
extra::convolve(props, x)
```

### TS

```ts
el.extra.convolve(props, x)
```

## Shape

- returns one root
- child order is `x`
- props support `path`, optional `irTrimDb`, and optional `Weighting`

## Analytical IR processing

This node performs extra analytical processing on the IR before it initializes the underlying FFT convolver.

When `irTrimDb` is present, the node:

- analyses the IR in short windows
- computes a relative significance threshold from the IR itself
- applies optional analysis weighting through `Weighting`
- trims the late IR tail at the last analytically significant region plus a safety margin

This is an IR-side optimization step. It does not gate the live input signal.

## Weighting

- `"none"`: unweighted analysis
- `"a-weight"`: A-weighted spectral analysis of each IR window

## Validation

The Rust side is covered by helper-shape tests and runtime tests showing that trimmed and untrimmed IRs reach different steady-state gains.
