# How We Added `vocoder`

Date: 2026-04-23

## Goal

Add a first-party vocoder helper that matches the repo's Rust and TS authoring surfaces.

## Current API

### Rust

```rust
extra::vocoder(props, carrier_l, carrier_r, modulator_l, modulator_r)
```

### TS

```ts
el.extra.vocoder(props, carrierL, carrierR, modulatorL, modulatorR)
```

## Shape

- returns two roots
- inputs are carrier L/R followed by modulator L/R
- props currently support `windowMs`, `smoothingMs`, and `maxGainDb`
- the helper is keyed like the other first-party extras

## Implementation notes

- the native node lives in `src/native/extra/vocoder.h`
- the node is registered in both runtime entry points
- buffers are preallocated in the constructor
- `process()` does not allocate

## Validation

The Rust side is covered by helper tests and the browser build is rebuilt after runtime registration changes.
