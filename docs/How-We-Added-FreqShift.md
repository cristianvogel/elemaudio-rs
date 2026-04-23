# How We Added `freqshift`

Date: 2026-04-23

## Goal

Add a repo-owned `el::extra::freqshift` / `el.extra.freqshift` helper that works in Rust and TS, with browser support tied to the browser WASM registration.

## Current API

### Rust

```rust
extra::freqshift(props, shift_hz, feedback, x)
```

### TS

```ts
el.extra.freqshift(props, shiftHz, feedback, x)
```

## Shape

- returns two roots: lower sideband first, upper sideband second
- child order is `shiftHz`, `feedback`, `x`
- props currently support `reflect` and `fbSource`
- `feedback` is a signal child, not a prop
- `shiftHz` is audio-rate

## Browser rule

If the helper should work in `examples/web-ui`, it must be registered in both:

- `src/ffi/elementary_bridge.cpp`
- `src/vendor/elementary/wasm/Main.cpp`

After that, rebuild the browser WASM bundle.

## Notes

- the native node is repo-owned and lives outside `src/vendor/`
- the panel and web demos only work if the browser runtime knows the node kind
- `mix` is not part of the current helper contract
