## <div style="font-weight: 300; color: orange; height: 0.5em;">elemaudiors</div>
### <span style="font-weight: 100; color: antiquewhite;">( ɛlɛˈmɔːdiɔːrz )</span>
* Rust-native bindings for [Elementary Audio](https://www.elementary.audio/) 
* Extended JS/TS authoring surfaces (`@elem-rs/core`) 
* Many custom DSP extras available for your graphs,  the `el::extra` and `el.extra` namespaces.

Last updated: 2026-04-23.

## Status

In development.

The Rust runtime, native bridge, authoring surface, browser demos, first-party extras, and CLAP plugin milestone are all in place and covered by tests. The repo is still being tightened up for parity with upstream Elementary where that makes sense.

## What is here

- Rust bindings and runtime in `src/`
- JS/TS authoring surface in `packages/core/`
- Browser demos in `examples/web-ui/`
- CLAP plugin milestone in `examples/plugin/`
- Vendored Elementary runtime under `src/vendor/elementary/`

## Layout

```text
elemaudio-rs/
├── src/
│   ├── authoring/      # Rust graph helpers
│   ├── engine.rs       # typed graph-to-params support
│   ├── runtime.rs      # runtime handle, process, VFS, updates
│   ├── ffi/            # bridge to vendored C++ runtime
│   ├── native/extra/   # first-party native node implementations
│   └── vendor/         # pinned Elementary snapshot
├── packages/core/      # @elem-rs/core
└── examples/
    ├── web-ui/         # browser demos
    ├── plugin/         # CLAP milestone
    └── runtime_oscillator.rs
```

## Authoring

Elementary keeps the graph surface functional. This repo follows that shape.

- Rust uses tuple-based helpers: `el::mul((a, b, c))`
- TS uses object-style helpers: `el.mul(a, b, c)`
- Multichannel graphs are ordered arrays of per-channel nodes
- Keys are part of composition; use them for stable leaf identity across renders

Example:

```rust
use elemaudio_rs::{el, Graph};

fn build_graph() -> Graph {
    let left = el::cycle(el::sm(el::const_with_key("left", 220.0)));
    let right = el::cycle(el::sm(el::const_with_key("right", 330.0)));

    Graph::new().render([left, right])
}
```

## First-party extras

`el::extra::*` helpers are repo-owned. They are implemented in `src/native/extra/`, exposed through `src/authoring/extra.rs`, and registered in both the native and browser runtimes.

Current extras include:

- `freqshift`
- `extra.convolve`
- `crunch`
- `foldback`
- `vari_slope_svf`
- `vocoder`
- `sample`
- `box_sum` / `box_average`
- `limiter` / `stereo_limiter`
- `stride_delay` / `stereo_stride_delay`
- `stride_delay_with_insert` / `stereo_stride_delay_with_insert`

## Runtime

`Graph::mount()` returns a mounted graph. `Runtime::process()` renders audio frames.

```rust
use elemaudio_rs::{el, Graph, Result, Runtime};

fn main() -> Result<()> {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(128)
        .call()?;

    let graph = Graph::new().render([
        el::cycle(el::sm(el::const_with_key("left", 220.0))),
        el::cycle(el::sm(el::const_with_key("right", 330.0))),
    ]);

    let mounted = graph.mount()?;
    runtime.apply_instructions(mounted.batch())?;

    let mut left = vec![0.0_f64; 128];
    let mut right = vec![0.0_f64; 128];
    let inputs: [&[f64]; 0] = [];
    let mut outputs = [&mut left[..], &mut right[..]];

    runtime.process(128, &inputs, &mut outputs)?;
    Ok(())
}
```

## JS/TS package

`packages/core/` mirrors the upstream Elementary authoring surface for TS users.

The current entrypoint is `packages/core/src/index.ts`.

## Browser demos

`examples/web-ui/` is the browser demo app.

- `synth.html` - additive synth
- `sample.html` - VFS sample playback
- `boxsum.html` - moving-window mean visualizer
- `waveshaper.html` - soft clip and foldback shaping
- `vocoder.html` - STFT channel vocoder
- `resource-manager.html` - Rust resource manager and browser VFS mirror

Rebuild the browser runtime after changing native node registrations:

```bash
./scripts/rebuild-web-wasm.sh
```

Rebuild the browser runtime and Vite bundle:

```bash
./scripts/rebuild-web-ui.sh
```

## Development

Requirements:

- Rust toolchain via `rustup`
- C++ toolchain for the native bridge
- Xcode Command Line Tools on macOS
- Emscripten if the browser runtime needs rebuilding

The browser rebuild scripts require `emcmake` and `emmake` on `PATH`.

The vendored browser runtime has been validated against Emscripten `3.1.52`. Newer SDK builds may fail in `src/vendor/elementary/runtime/elem/deps/json.hpp`.

## Commands

```bash
cargo build
cargo test
cargo check
cargo doc --open

./scripts/dev-web-ui.sh
./scripts/dev-resources.sh
./scripts/dev-all.sh
./scripts/rebuild-web-wasm.sh
./scripts/rebuild-web-ui.sh
./scripts/sync-elementary.sh
```

## Docs

- Rust API docs: https://cristianvogel.github.io/elemaudio-rs/
- Elementary: https://www.elementary.audio/
- Keys guide: https://www.elementary.audio/docs/guides/Understanding_Keys

### Internal Technical Docs

- [FrameLib FFT Integration](docs/FrameLib-FFT-Integration.md) - Details on block sizes, latency, and spectral format.
- [Spectral Convolver Design](docs/Spectral-Convolver-FrameLib-Design.md) - Design notes for the `convolveSpectral` node.

Development notes live under `docs/`.

## Notes

- The vendored Elementary tree is pinned and flattened under `src/vendor/elementary/`.
- `packages/core/` is generated from the repo-owned authoring surface, not hand-copied from vendor sources.
- The optional `resources` feature pulls in the separate `elemaudio-resources` repo for the browser resource demos.

## Attribution

Thanks to the upstream projects that this repo builds on:

- Elementary Audio core DSP and runtime: Copyright (c) 2023 Nick Thompson, MIT License.
- Signalsmith DSP / stretch code used in the vendored runtime: Copyright (c) 2021-2022 Geraint Luff / Signalsmith Audio Ltd., MIT License.

Repo-owned code in this tree is covered by `LICENSE` unless a file says otherwise.

Additional project-owned terms:

- All `examples/web-ui/**/*.dsp.ts` composition sources are copyright NeverEngineLabs (https://www.neverenginelabs.com/). They are not licensed for commercial derivatives or embedding in commercial products.
- All custom nodes under `src/native/extra/` are copyright NeverEngineLabs and licensed under MIT.
