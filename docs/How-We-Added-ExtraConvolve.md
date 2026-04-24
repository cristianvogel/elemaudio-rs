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
- props support `path`, optional normalized `start`, optional normalized `end`, optional positive `rate`, optional `irAttenuationDb`, and optional `normalize`

## Runtime behavior

This node forwards the full shared IR buffer to the underlying two-stage FFT convolver.

Optional runtime controls:

- `start`: selects the normalized IR start position
- `end`: selects the normalized IR end position
- if `end < start`, the selected IR region is reversed before initializing the convolver
- `rate`: resamples the selected IR region before initializing the convolver; values above `1` shorten it and values below `1` stretch it
- `irAttenuationDb`: attenuates the wet output by the given positive dB amount
- `normalize`: applies realtime input normalization based on a gain estimate derived from the loaded IR

## Validation

The Rust side is covered by helper-shape tests and runtime tests for wet attenuation and normalization behavior.

## VFS Replace Semantics

The vendor browser shared-resource path was add-only. Re-uploading a `Float32Array` to an existing VFS key failed with `cannot overwrite existing shared resource`.

This repo now adds explicit replace semantics in the browser WASM bridge, worklet update path, and Rust runtime wrappers so an existing resource id can be updated intentionally while old shared resource instances remain alive until active graph references are released.
