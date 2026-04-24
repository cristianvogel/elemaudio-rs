# How We Added `iirHilbert`

Date: 2026-04-24

## Goal

Add a repo-owned `el::extra::iir_hilbert` / `el.extra.iirHilbert` helper that exposes the vendored Signalsmith IIR Hilbert transform on both authoring surfaces.

## Current API

### Rust

```rust
extra::iir_hilbert(props, x)
```

### TS

```ts
el.extra.iirHilbert(props, x)
```

## Shape

- returns two roots: analytic real part first, analytic imaginary part second
- child order is `x`
- props currently support `passbandGain`

## Usage note

In other words:

- use `input -> iirHilbert -> ...` for custom analytic-signal processing
- use `input -> freqshift` for the finished SSB/frequency-shift operation

`freqshift` already contains its own internal Hilbert stage, so `iirHilbert` is only needed when the raw analytic pair is needed directly.

## Implementation notes

- the native node is `iirHilbert`
- it uses the already-vendored `signalsmith::hilbert::HilbertIIR`
- `passbandGain` maps directly to the Hilbert constructor's third argument
- the node is registered in both runtime entry points
- browser support still depends on rebuilding the browser WASM bundle after registration changes

## Validation

The Rust side is covered by helper-shape tests plus end-to-end runtime tests for silence and a unit sine analytic pair.
