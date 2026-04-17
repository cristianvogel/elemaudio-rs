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

- **`el::extra::sample_count`** — emits the exact length of a VFS-resident
  audio resource as a constant signal, optionally scaled into a natural
  domain. Register as native kind `"sampleCount"`. Available identically
  from Rust (`el::extra::sample_count`) and TypeScript
  (`el.extra.sampleCount`).
  - Zero children. Required prop `path: string` (VFS key of a
    previously-added resource). Optional prop
    `unit: "samp" | "ms" | "hz"` (default `"samp"`) selects the output
    domain:
    - `"samp"`: raw per-channel sample count (e.g. 48000 for a 1s asset @ 48 kHz).
    - `"ms"`: duration in milliseconds — `1000 × len / sr`.
    - `"hz"`: fundamental period frequency — `sr / len`. Useful as a
      `phasor` / `train` rate to loop the asset exactly once per cycle.
    - Unknown unit tokens are rejected with `InvalidPropertyValue`.
    - The scaling is done once on the message thread at `setProperty`
      time; the audio loop stays a plain `std::fill_n`.
  - Output shape matches `el::sr()` / `el::time()`: a constant-valued
    signal, one value per output sample.
  - Missing-resource behavior: `setProperty` returns
    `InvalidPropertyValue` (same contract as `el::sample` / `el::table`).
    Author must register the resource via
    `Runtime::add_shared_resource_f32(...)` /
    `renderer.updateVirtualFileSystem(...)` before rendering.
  - Runtime swap: changing `path` or `unit` via `mounted.set_property`
    updates the emitted value on the next block, no re-mount required.
  - Native: `src/native/extra/sample_count.h` (header-only, RT-safe:
    SPSC queue carries scaled `FloatType` across threads, no allocs in
    `process()`). Registered in `src/ffi/elementary_bridge.cpp` and
    `src/vendor/elementary/wasm/Main.cpp`.
  - Tests: `tests/sample_count.rs` (**9 end-to-end runtime tests**:
    analytic length output, unknown-path error propagation, runtime
    path swap, composition with `el::sr()` for seconds, `"ms"` mode,
    `"hz"` mode, default `unit` is `"samp"`, unknown unit rejected,
    runtime `unit` swap via `set_property`) plus graph-construction
    coverage in `tests/test-el-helpers.rs`.
  - Web demo: the existing `resource-manager` demo now retriggers the
    sampler with `el.train(el.extra.sampleCount({ path, unit: "hz" }))`,
    i.e. exactly one clean loop per asset length — no drift, no gap, no
    overlap, regardless of file duration.
  - Browser users: WASM artifact must be rebuilt (same flow as `ramp00`).

### Changed
- VFS FFI (`elementary_runtime_add_shared_resource_f32`,
  `elementary_runtime_add_shared_resource_f32_multi`) is no longer gated
  behind the `ELEM_RS_ENABLE_RESOURCES` / `resources` cargo feature.
  These functions are pure wrappers over the built-in
  `SharedResourceMap::add` — they have no dependency on the optional
  `elemaudio-resources` crate and are needed by every VFS-consuming extra
  (`el::sample`, `el::table`, `el::extra::sample_count`). The `resources`
  feature still exists and still controls the external resources crate
  integration; this ungating just fixes a link error when calling
  `Runtime::add_shared_resource_f32` without the feature enabled.

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
