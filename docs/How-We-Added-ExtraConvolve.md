# How We Added `extra.convolve`

Date: 2026-04-24

## Goal

Add a repo-owned `el::extra::convolve` / `el.extra.convolve` helper that wraps the vendor convolver in repo-owned bridge/runtime code.

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
- props support `path`, optional `irAttenuationDb`, and optional `normalize`

## Runtime behavior

This node forwards the full shared IR buffer to the underlying two-stage FFT convolver.

Optional runtime controls:

- `irAttenuationDb`: attenuates the wet output by the given positive dB amount
- `normalize`: applies realtime input normalization based on a gain estimate derived from the loaded IR

## Validation

The Rust side is covered by helper-shape tests and runtime tests for wet attenuation and normalization behavior.
