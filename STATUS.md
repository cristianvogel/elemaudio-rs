# elemaudio-rs Status

<!--
TEMPLATE_VERSION: 1.0.0
TEMPLATE_SOURCE: Ydun_ai_workflow/templates/core/STATUS.md.template
LAST_SYNC: 2026-03-30
PURPOSE: Track project progress, status, and metrics across development sessions
-->

**Last Updated:** 2026-04-07
**Project Phase:** DEVELOPMENT
**Completion:** 72% (Rust graph authoring surface expanded, JS/TS authoring surface in place, and vendor snapshot flattened)
**Next Phase:** Tighten parity between Rust graph helpers, multichannel wrappers, and native runtime integration

---

## Project Overview

**Project Type:** Implementation
**Primary Goal:** Provide safe Rust bindings for Elementary plus a JS/TS authoring package and native resource management.
**Target Deployment:** Local Rust applications and audio tooling.
**Status:** Active development with a working authoring package and Rust resource manager.

---

## Current Session Status

### Active Tasks
- 🔄 Keep the Rust resource manager simple and versatile

### Completed This Session
- [x] Flattened the vendored Elementary snapshot into the repo and removed upstream sync scripts
- [x] Vendored and pinned third-party dependencies locally: `signalsmith-linear` 0.3.2, `signalsmith-dsp` v1.7.1, `signalsmith-hilbert` 1.0.0, `FFTConvolver` f2cdeb04c42141d2caec19ca4f137398b2a76b85, and `stfx` from `basics/main`
- [x] Pruned non-runtime `choc`/tooling subtrees from the vendored snapshot after verifying `runtime/elem` did not directly include them
- [x] Restored the browser demo series after the vendor flattening and include-path fixes
- [x] Reduced the vendored Elementary snapshot footprint to about 5.3 MB
- [x] Added `AGENTS.md` and `CLAUDE.md`
- [x] Added `JIMMYS-WORKFLOW.md` and `NEXT-SESSION-START-HERE.md`
- [x] Updated `STATUS.md` for the current project state
- [x] Implemented the Rust-native `ResourceManager`
- [x] Added optional `resources` Cargo feature backed by the public `elemaudio-resources` repo
- [x] Removed local native resource binaries from the core crate
- [x] Verified `cargo build`, `cargo build --features resources`, and `npm --prefix examples/web-ui run build`
- [x] Added Rust graph authoring helpers for the upstream `el.*` surface
- [x] Added `src/core.rs` with `create_node`, `resolve`, `is_node`, and `unpack`
- [x] Added multichannel `mc.*` helpers on the Rust side
- [x] Added `el.convolve`-based IR channel splitting in the web-ui sample demo
- [x] Added an IR pair toggle for swapping between channel pairs without remounting the graph
- [x] Added `el::extra::freqshift` / `el.extra.freqshift` as a native DSP helper backed by a vendored Hilbert IIR
- [x] Confirmed the Rust graph authoring surface remains function-based, with bracketed variadic math helpers
- [x] Added `Graph::render(...)` as the preferred graph composition API
- [x] Documented `key`-driven composition guidance using the upstream keys guide
- [x] Added unit tests for the new Rust core utilities
- [x] Documented the Rust and JS/TS authoring split in the repo README files
- [x] Added a feature-gated audible `mc.sample` test that uses `symphonia` and the `resources` feature

### Blockers
- None currently identified.

---

## Current Milestones

### Completed
- ✅ JS/TS package split by domain modules
- ✅ `Renderer` exposed from `@elem-rs/core`
- ✅ Rust-native `ResourceManager` added
- ✅ Public optional resource extension split into `elemaudio-resources`
- ✅ Rust graph authoring surface now covers the upstream `el.*` core, math, filters, oscillators, envelopes, dynamics, and multichannel helpers
- ✅ Extended Rust/JS authoring with `el::extra::*` for native DSP nodes
- ✅ Replaced `StateSpaceFilterNode` with `VariSlopeSVFNode` — true Simper SVF kernel with Rossum-style continuous slope morphing (12–48 dB/oct), Q exposed (Butterworth default), fully documented in header, bridge, and Rust authoring layer

### In Progress
- 🔄 Connect resource management to runtime-facing usage patterns
- 🔄 Continue parity work between Rust graph helpers and upstream Elementary core utilities

### Upcoming
- ⚪ Add handle-based resource lookups for Elementary integrations if needed
- ⚪ Extend integration tests around resource lifecycle operations
- ⚪ Review remaining upstream surface gaps against `@elemaudio/core`
