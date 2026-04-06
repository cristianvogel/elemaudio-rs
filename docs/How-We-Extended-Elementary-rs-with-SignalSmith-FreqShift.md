# How We Extended Elementary-rs with SignalSmith FreqShift

Date: 2026-04-06

## Goal

Add a first-party `el::extra::freqshift` helper backed by Signalsmith Audio's Hilbert-based frequency shifter, while keeping repo-owned code outside `src/vendor/`.

## Steps

1. Define the helper surface in Rust.
   - Added `el::extra::freqshift(...)` in `src/graph.rs`.
   - Exported `extra` from `src/lib.rs`.

2. Define the helper surface in JS/TS.
   - Added `packages/core/src/extra.ts`.
   - Re-exported it from `packages/core/src/index.ts` as `el.extra`.

3. Keep first-party DSP code outside `vendor/`.
   - Moved the native implementation into `src/native/extra/freqshift.h`.
   - Stored third-party DSP support headers in `src/native/third_party/`.

4. Implement the native processor.
   - Added a `FreqShiftNode` native runtime node.
   - The node returns two outputs: down-shifted and up-shifted audio.

5. Register the node in the native bridge.
   - Added `freqshift` registration in `src/ffi/elementary_bridge.cpp`.
   - Added `src/native` to the C++ include path in `build.rs`.

6. Register the node in the browser WASM runtime.
   - Added `freqshift` registration in `src/vendor/elementary/wasm/Main.cpp`.
   - Added `src/native` to the WASM CMake include path.

7. Rebuild the browser runtime.
   - Use `./scripts/rebuild-web-wasm.sh` to regenerate the browser WASM bundle.
   - Use `./scripts/rebuild-web-ui.sh` to rebuild the browser example after that.

8. Document the browser constraints.
   - `AGENTS.md` now states that browser-visible extras must be registered in the WASM runtime and rebuilt.
   - `README.md` now notes the Emscripten requirement and the pinned `3.1.52` version.

9. Verify the integration.
   - `cargo test --test test-el-helpers`
   - `npm --prefix examples/web-ui run build`

## Key Rule

If an `el::extra::*` helper should work in `examples/web-ui`, it must exist in both:

- the JS/TS authoring package
- the browser WASM runtime registration

A JS helper alone is not enough.

## Result

`el::extra::freqshift` is now a repo-owned extension that can be used from Rust and JS authoring surfaces, with browser support tied to a rebuilt WASM runtime.
