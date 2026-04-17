# elemaudio-rs Status

<!--
TEMPLATE_VERSION: 1.0.0
TEMPLATE_SOURCE: Ydun_ai_workflow/templates/core/STATUS.md.template
LAST_SYNC: 2026-04-13
PURPOSE: Track project progress, status, and metrics across development sessions
-->

**Last Updated:** 2026-04-17
**Project Phase:** DEVELOPMENT
**Completion:** 87% (Framework hardened, DspGraph engine, CLAP plugin example, TS/RS parity, RT-safe set_params early-return)
**Next Phase:** Documentation, additional graph scripts, production integration testing

---

## Project Overview

**Project Type:** Implementation
**Primary Goal:** Provide safe Rust bindings for Elementary plus a JS/TS authoring package and native resource management.
**Target Deployment:** Local Rust applications, audio tooling, and CLAP audio plugins.
**Status:** Active development with a working CLAP plugin example, DspGraph engine, and full TS/RS authoring parity.

---

## Current Session Status (2026-04-17)

### Completed This Session
- [x] `Engine::set_params` early-return on unchanged `Params` (RT-safe hot path)
  - Added `PartialEq` bound to `DspGraph::Params`
  - Added `Engine::rebuild_count()` diagnostic for tests and realtime checks
  - Counter proves 1000 identical calls → 0 rebuilds, 0 tree walks, 0 FFI traffic
- [x] Plugin example: `AudioProcessor` gates `engine.set_params` behind a
      `DspParameters != last_dsp_params` check; keeps audio thread allocation-free
      on steady-state blocks
- [x] `DspParameters` now derives `PartialEq`
- [x] **Version bump: `elemaudio-rs 0.1.0 → 0.2.0`** (SemVer minor bump for the
      breaking `DspGraph::Params: PartialEq` requirement) + `CHANGELOG.md` added
- [x] **New native extra: `el::extra::ramp00`** — sample-accurate one-shot
      `0 → 1` ramp with configurable per-sample duration and blocking semantics.
      Full Rust + TS parity, registered in native bridge and browser WASM
      `Main.cpp`. Covered by 6 end-to-end runtime tests asserting analytic
      ramp shape, blocking/non-blocking retrigger behavior, edge cases, and
      per-sample rising-edge detection when the trigger is a real audio-rate
      signal (`el::train`). Version bump deferred — will batch with
      additional low-level extras in this session.
- [x] **Web demo: `ramp00` signal-utility demo** — new entry in the
      Signal Utilities category of `examples/web-ui`. Oscilloscope
      (default 16× zoom), stochastic trigger source
      (`el.ge(el.latch(el.train(rate), el.rand), threshold)`) repeatedly
      attempts to retrigger; blocking toggle plus duration / clock /
      threshold sliders. No audio output (silenced stereo via
      `el.mul(0, scopeInsert)`).
- [x] **New native extra: `el::extra::sample_count`** — emits the exact
      length of a VFS-resident audio resource as a constant signal, with
      an optional `unit` prop (`"samp"` default, `"ms"`, `"hz"`) that
      scales the output into the author's natural domain. Full Rust + TS
      parity; registered in native bridge and browser WASM `Main.cpp`.
      9 end-to-end runtime tests covering every mode, missing/unknown
      inputs, runtime path + unit swaps via `mounted.set_property`, and
      composition with `el::sr()` to derive seconds. The `"hz"` mode
      computes `sr / len` — the asset's fundamental period frequency —
      which makes `el.train(el.extra.sampleCount({ path, unit: "hz" }))`
      a drop-in exact-length retrigger.
- [x] **Web demo updated: `resource-manager`** now loops each mirrored
      asset at its natural period via
      `el.train(el.extra.sampleCount({ path, unit: "hz" }))`. No manual
      rate configuration; switching the mirrored path automatically
      retunes the loop rate (the keyed `sampleCount` node's fast-path
      `setProperty` update handles it). A full-width timeline canvas
      above the panel visualizes the playhead cursor, driven by
      `el.meter(el.phasor(loopRate))` — the cursor traverses the
      timeline in exact sync with the retrigger, no host-side timers.
- [x] Test suite: 22 lib tests + integration tests (including 6 ramp00
      tests and 9 sample_count tests), all passing.
- [x] **Fix: VFS FFI always linkable.** Ungated
      `elementary_runtime_add_shared_resource_f32[_multi]` from the
      `ELEM_RS_ENABLE_RESOURCES` cargo feature — they were mis-gated and
      blocked anyone from using `Runtime::add_shared_resource_f32`
      without pulling in the optional `elemaudio-resources` crate.

### Completed Previous Session (2026-04-13)
- [x] Framework hardening: `mount()` returns `Result<MountedGraph, MountError>` (no panics)
- [x] File logger: `log` crate + `dirs` for cross-platform `~/Library/Logs/elemaudio-rs-plugin.log`
- [x] `DspGraph` trait + `Engine<G>` with auto-discovery of keyed consts and native props from the graph tree
- [x] `stridedelay.h` breaking change: `delayMs` and `fb` are signal children, not props
- [x] Feedback insert loop: `stride_delay_with_insert` and `stereo_stride_delay_with_insert` (Rust + TS)
- [x] TS/RS parity audit: all 9 extra helpers aligned (signatures, props, defaults, children order)
- [x] Plugin example: minimal self-contained CLAP plugin with `bundle.sh`, `Engine<StrideDelayGraph>`
- [x] Web demos: synth demo uses `strideDelayWithInsert` with FB filter; vocoder demo uses `stereoStrideDelayWithInsert`
- [x] `MountedGraph::all_nodes()` iterator, `Graph::mount_with_id_counter()`

### Blockers
- None currently identified.

---

## Milestones

### Completed
- ✅ JS/TS package split by domain modules
- ✅ `Renderer` exposed from `@elem-rs/core`
- ✅ Rust-native `ResourceManager`
- ✅ Rust graph authoring surface covers upstream `el.*` core + multichannel + extras
- ✅ `VariSlopeSVFNode` — Simper SVF with continuous slope morphing
- ✅ `mount()` returns `Result` — no more panics on duplicate keys
- ✅ `DspGraph` trait + `Engine<G>` — idiomatic Rust DSP scripting layer
- ✅ Signal-rate `delayMs`/`fb` on `stridedelay` native node
- ✅ Feedback insert loop (`stride_delay_with_insert`) via tapIn/tapOut
- ✅ Full TS/RS parity on all 9 extra helpers
- ✅ Self-contained CLAP plugin example with macOS bundler
- ✅ File logging via `log` crate
- ✅ `Engine::set_params` RT-safe early-return (Tier 1) + plugin-side gate (Tier 2)
- ✅ `el::extra::ramp00` — sample-accurate one-shot ramp (Rust + TS + demo)
- ✅ `el::extra::sample_count` — VFS asset length as a constant signal
- ✅ VFS FFI (`add_shared_resource_f32[_multi]`) always linkable

### In Progress
- 🔄 Documentation pass for the new APIs
- 🔄 Production integration testing via nel-x-audio-dev / NEL-StrideDelay

### Upcoming
- ⚪ Additional `DspGraph` implementations (reverb, chorus, etc.)
- ⚪ `el::select` fix for keyed const gate nodes (avoid duplicate key workaround)
- ⚪ Cross-platform plugin bundler (Linux, Windows)
- ⚪ `Engine::set_params` Tier 3: eliminate allocations in the *changed-params*
      path (currently Tier 1 early-return and Tier 2 plugin-side gate are done;
      Tier 3 would reuse hashmap buffers via `clear()`, switch keys to
      `&'static str`, or replace the full `G::build` rebuild with a direct
      `G::diff(old, new) -> InstructionBatch` contract)
