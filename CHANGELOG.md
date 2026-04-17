# Changelog

All notable changes to `elemaudio-rs` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the crate is pre-1.0, breaking changes bump the **minor** version.

## [Unreleased]

### Added
- **`el::extra::ramp00`** — sample-accurate one-shot `0 → 1` ramp that drops
  to `0` on peak. Register as native kind `"ramp00"`. Available identically
  from Rust (`el::extra::ramp00`) and TypeScript (`el.extra.ramp00`).
  - Signal children: `dur` (duration in samples; per-sample signal, may
    vary continuously) and `x` (trigger; rising edge through `0.5` starts
    the ramp).
  - Prop: `blocking` (bool, default `true`). When `true`, further triggers
    are ignored while the ramp is running; when `false`, any rising edge
    restarts the ramp from 0.
  - Edge cases: `dur <= 0` at trigger time ignores the trigger; `dur <= 0`
    mid-ramp aborts the ramp to 0.
  - Native: `src/native/extra/ramp00.h` (header-only, RT-safe: no allocs,
    atomic-relaxed prop loads). Registered in
    `src/ffi/elementary_bridge.cpp` and `src/vendor/elementary/wasm/Main.cpp`.
  - Tests: `tests/ramp00.rs` (6 end-to-end runtime tests asserting analytic
    ramp shape, blocking/non-blocking retrigger semantics, `dur <= 0` edge
    cases, and **per-sample rising-edge detection inside a block** when the
    trigger is a real audio-rate signal such as `el::train(rate)`) plus
    graph-construction coverage in `tests/test-el-helpers.rs`.
  - Browser users: WASM artifact must be rebuilt (requires Emscripten
    `3.1.52`, see AGENTS.md). Native Rust users get `ramp00` immediately.

## [0.2.0] - 2026-04-17

### Added
- `Engine::rebuild_count()` diagnostic returning the number of full rebuilds
  performed by `set_params` since engine construction. Unchanged-parameter
  calls do not increment the counter. Primarily for tests and realtime
  diagnostics.

### Changed
- `Engine::set_params` now early-returns when the incoming `Params` are equal
  to the current ones. On the audio thread this avoids a graph rebuild, two
  HashMap reconstructions, and any FFI traffic when the host/UI is not
  sending fresh parameter values — aligning with the realtime audio rules in
  `SKILLS.md`.
- Plugin example (`examples/plugin`) gates `engine.set_params` behind a
  `DspParameters != last_dsp_params` check so the audio-thread hot path is
  allocation-free on steady-state blocks. `DspParameters` now derives
  `PartialEq`.

### Breaking
- `DspGraph::Params` now requires `Clone + PartialEq` (previously just
  `Clone`). Downstream implementations must add `#[derive(PartialEq)]` to
  their `Params` struct (or implement it manually). All first-party impls
  in this repo have been updated.

## [0.1.0] - 2026-04-13

Initial development release. See `STATUS.md` for the feature matrix at this
point in time. Highlights:

- Safe Rust bindings for Elementary (`Runtime`, `Graph`, `MountedGraph`).
- `DspGraph` trait and generic `Engine<G>` with auto-discovery of keyed
  consts and native node props from the graph tree.
- `mount()` returns `Result<MountedGraph, MountError>` (no panics).
- Rust-native `ResourceManager` for sample/resource ownership.
- Full authoring surface: `el::*` core helpers, multichannel, and first-party
  `el::extra::*` helpers (stride-delay, vocoder, waveshaper, box-sum, etc.).
- `stride_delay_with_insert` / `stereo_stride_delay_with_insert` feedback
  insert loops via `tapIn`/`tapOut`.
- TS/RS parity on all 9 first-party extra helpers.
- Self-contained CLAP plugin example with macOS bundler.
- File logging via the `log` crate to a cross-platform user log directory.

[0.2.0]: https://github.com/cristianvogel/elemaudio-rs/releases/tag/v0.2.0
[0.1.0]: https://github.com/cristianvogel/elemaudio-rs/releases/tag/v0.1.0
