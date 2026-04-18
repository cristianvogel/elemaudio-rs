# elemaudio-rs

Rust-native bindings for [Elementary Audio](https://www.elementary.audio/), with a
matching JS/TS authoring surface published as `@elem-rs/core` and a set of
first-party extras for DSP work that is not in the upstream runtime.

For detailed documentation about the core DSP blocks and for programming audio
with Elementary Audio, see the official site by Nick Thompson:
https://www.elementary.audio/

Elementary Audio and elemaudio-rs both include DSP code by Geraint Luff,
Copyright 2022+ Signalsmith Audio Ltd, under the MIT License.

> 👀 See also the sister project
> [elemaudio-resources](https://github.com/cristianvogel/elemaudio-resources) —
> a Rust resource server for the Elementary
> [VFS](https://www.elementary.audio/docs/guides/Virtual_File_System).

## Status

Work in progress. The Rust runtime, authoring surface, JS/TS package, first-party
`el::extra::*` helpers, and a working CLAP plugin milestone are all in place and
covered by the integration test suite. The project aims to reach parity with
the upstream Elementary JS/TS authoring surface while also providing a
Rust-native authoring layer and extending DSP with Rust-native node kinds.

## Table of Contents

- [Layout](#layout)
- [Authoring](#authoring)
  - [Graph style](#graph-style)
  - [Rust: `el::*` and `el::extra::*`](#rust-el-and-elextra)
  - [JS/TS: `@elem-rs/core`](#jsts-elem-rscore)
  - [Keys](#keys)
- [Runtime](#runtime)
  - [Mount and process a graph](#mount-and-process-a-graph)
  - [Update without rebuilding](#update-without-rebuilding)
  - [`DspGraph` + `Engine<G>`](#dspgraph--enginegg)
- [Examples](#examples)
  - [Web UI (browser demos)](#web-ui-browser-demos)
  - [CLAP plugin](#clap-plugin)
  - [CPAL host bridge](#cpal-host-bridge)
- [Vendored Elementary](#vendored-elementary)
- [Development Setup](#development-setup)
- [Common Commands](#common-commands)
- [Docs](#docs)

---

## Layout

```
elemaudio-rs/
├── src/
│   ├── authoring/            # Rust graph authoring surface
│   │   ├── el.rs             # core el::* helpers
│   │   ├── extra.rs          # first-party el::extra::* helpers
│   │   └── mc.rs             # multichannel wrappers
│   ├── engine.rs             # Engine<G> + DspGraph trait
│   ├── graph.rs              # Graph, MountedGraph, lowering to instruction batches
│   ├── runtime.rs            # Runtime handle, process(), VFS, keyed-const updates
│   ├── ffi/                  # FFI bridge to the vendored C++ runtime
│   ├── native/extra/         # First-party C++ native nodes (headers)
│   └── vendor/elementary/    # Vendored upstream Elementary runtime + JS sources
├── packages/core/            # @elem-rs/core — JS/TS authoring package
└── examples/
    ├── plugin/               # Self-contained CLAP plugin milestone
    ├── web-ui/               # Browser demos (synth, sampler, boxsum, etc.)
    └── runtime_oscillator.rs # Smallest-possible Rust runtime example
```

## Authoring

### Graph style

Elementary uses a functional graph style. Each call returns a node; nodes are
composed by nesting.

- **Rust**: variadic math helpers take tuple inputs — `el::mul((a, b, c))`,
  `el::div((node, 0.5))`. No macro DSL; the surface stays function-based.
- **TS**: object props — `el.mul(a, b, c)`; `el.const({ value, key })`.
- Multichannel graphs are ordered arrays of per-channel graphs rendered
  together — `Graph::new().render([left, right])` in Rust,
  `render(left, right)` in TS.

### Rust: `el::*` and `el::extra::*`

Rust authoring lives in `src/authoring/`:

- `el::*` — core helpers (oscillators, math, filters, envelopes, delays)
- `el::extra::*` — first-party extras not in upstream Elementary
- `el::mc::*` — multichannel wrappers

First-party extras currently available:

| Rust helper | Description |
|---|---|
| `el::extra::freqshift` | Signalsmith-style complex frequency shifter |
| `el::extra::crunch` | Bit-crusher / sample-rate reducer |
| `el::extra::foldback` | Foldback distortion with soft-knee |
| `el::extra::vari_slope_svf` | Rossum-style continuously morphable SVF (12–72 dB/oct, Butterworth) |
| `el::extra::vocoder` | STFT channel vocoder (port of Geraint Luff's JSFX) |
| `el::extra::box_sum` / `box_average` | Moving-window sum and mean |
| `el::extra::limiter` / `stereo_limiter` | Lookahead brick-wall limiter |
| `el::extra::stride_delay` / `stereo_stride_delay` | Delay with continuous time modulation across mode transitions |
| `el::extra::stride_delay_with_insert` / `stereo_stride_delay_with_insert` | Feedback-insert variant using `tapIn`/`tapOut` |

Each extra is documented in `src/authoring/extra.rs`, has a corresponding C++
node under `src/native/extra/`, and is registered in both
`src/ffi/elementary_bridge.cpp` (native) and
`src/vendor/elementary/wasm/Main.cpp` (browser).

```rust
use elemaudio_rs::{el, Graph};

fn build_graph() -> Graph {
    let left  = el::cycle(el::sm(el::const_with_key("left",  220.0)));
    let right = el::cycle(el::sm(el::const_with_key("right", 220.0 * 1.618)));

    Graph::new().render([left, right])
}
```

### JS/TS: `@elem-rs/core`

The Rust runtime executes lowered instruction batches through the FFI bridge
into the [upstream C++ runtime](https://github.com/elemaudio/elementary/tree/main/runtime).
The same graph authoring surface that Elementary.js users expect is generated
into `packages/core/`, so a TS author can target `@elem-rs/core` and emit the
same instruction JSON that drives the native side.

```ts
import { el, Renderer } from "@elem-rs/core";

const base = 220;
const graph = [
  el.cycle(el.sm(el.const({ value: base,         key: "left"  }))),
  el.cycle(el.sm(el.const({ value: base * 1.618, key: "right" }))),
];

renderer.render(...graph);
```

The current package entrypoint lives in `packages/core/src/index.ts`. See
`docs/JS-TS-AUTHORING-PLAN.md` for the roadmap.

### Keys

Keys are part of composition. They let the renderer preserve node identity
across successive `render(...)` calls while the surrounding graph shape
changes — the recommended pattern for stable leaf nodes and for direct
property updates on mounted nodes.

See Elementary's official guide:
https://www.elementary.audio/docs/guides/Understanding_Keys

## Runtime

### Mount and process a graph

`Graph::mount` returns `Result<MountedGraph, MountError>`. `Runtime::process`
is what produces audio frames; any host that can call it with input/output
buffers is compatible.

```rust
use elemaudio_rs::{el, Graph, Result, Runtime};

fn main() -> Result<()> {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(128)
        .call()?;

    let graph = Graph::new().render([
        el::cycle(el::sm(el::const_with_key("left",  220.0))),
        el::cycle(el::sm(el::const_with_key("right", 330.0))),
    ]);

    let mounted = graph.mount()?;
    runtime.apply_instructions(mounted.batch())?;

    let mut left  = vec![0.0_f64; 128];
    let mut right = vec![0.0_f64; 128];

    let inputs: [&[f64]; 0] = [];
    let mut outputs = [&mut left[..], &mut right[..]];

    runtime.process(128, &inputs, &mut outputs)?;
    Ok(())
}
```

### Update without rebuilding

```rust
use elemaudio_rs::{el, Graph, Result, Runtime};

fn update(runtime: &Runtime) -> Result<()> {
    let graph = Graph::new().render([
        el::cycle(el::sm(el::const_with_key("left",  220.0))),
        el::cycle(el::sm(el::const_with_key("right", 330.0))),
    ]);
    let mounted = graph.mount()?;

    // Change the keyed leaf's value without rebuilding the graph tree.
    if let Some(batch) = mounted.set_const_value("left", 330.0) {
        runtime.apply_instructions(&batch)?;
    }

    Ok(())
}
```

The graph stays mounted; only the property batch changes.

### `DspGraph` + `Engine<G>`

For applications that want a typed, declarative parameter-to-graph contract
(e.g. a plugin), `src/engine.rs` exposes:

- `trait DspGraph` — implement `type Params` and `fn build(params) -> Vec<Node>`.
- `struct Engine<G: DspGraph>` — owns a `Runtime`, auto-discovers keyed consts
  and native props from the rendered graph tree, and applies minimal
  property updates when `set_params` is called.

The CLAP plugin example under `examples/plugin/` uses this pattern.

## Examples

### Web UI (browser demos)

`examples/web-ui/` contains the browser demo SPA. Each HTML file is a
standalone demo:

- `synth.html` — additive synth
- `sample.html` — VFS sample playback
- `boxsum.html` — moving-window mean visualizer
- `waveshaper.html` — soft-clip / foldback shaping
- `vocoder.html` — STFT channel vocoder
- `resource-manager.html` — Rust resource manager + browser VFS mirror

### CLAP plugin

`examples/plugin/` is a self-contained CLAP effect plugin milestone:
a stereo stride-delay authored in Rust via `Engine<StrideDelayGraph>`, hosted
in a CLAP container, with a Wry webview GUI. It demonstrates the full pipeline
from DSP authoring to a signed-ready CLAP bundle on macOS via
`examples/plugin/bundle.sh`.

See `examples/plugin/README.md` for build, bundle, and host-integration notes.

### CPAL host bridge

`tests/audio_playback.rs` is a working host-bridge example that wires a Rust
`el::*` graph into CPAL for local audio output — a useful template for any
host that can hand buffers to `Runtime::process(...)`.

## Vendored Elementary

The Elementary JS/runtime sources are vendored under `src/vendor/elementary` as
a flattened, pinned snapshot. The JS/TS authoring package is generated into
`packages/core`.

Current pinned vendor footprint: about 5.3 MB for `src/vendor/elementary`.

Pinned vendored dependencies:

- `signalsmith-linear` 0.3.2
- `signalsmith-dsp` v1.7.1
- `signalsmith-hilbert` 1.0.0
- `FFTConvolver` f2cdeb04c42141d2caec19ca4f137398b2a76b85
- `stfx` from `Signalsmith-Audio/basics` `main`

The vendored `choc` tree was pruned to the runtime-facing surface — example,
test, web, and other tooling-only subtrees were removed after verifying that
`runtime/elem` does not include them.

To rebuild the browser runtime after changing native node registrations such
as any `el::extra::*` helpers:

```bash
./scripts/rebuild-web-wasm.sh
```

`scripts/rebuild-web-ui.sh` rebuilds the full web UI (WASM + Vite bundle).

## Development Setup

1. Install Rust with `rustup`.
2. Install a C++ toolchain compatible with `cc` builds.
3. On macOS, install the Xcode Command Line Tools if they are not already present.
4. Clone the repository.
5. `cargo build`
6. `cargo test`
7. Install Emscripten if you need to rebuild the browser runtime. The
   rebuild helpers require `emcmake` and `emmake` on `PATH`.

To install Emscripten with the official SDK:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

If you want those tools available in future shells, add the SDK environment
setup to your shell profile after activation.

**Emscripten version**: the vendor browser runtime currently expects
Emscripten `3.1.52`. Newer `latest` SDK builds may fail in
`src/vendor/elementary/runtime/elem/deps/json.hpp` during the WASM rebuild.

## Common Commands

```bash
cargo build
cargo test
cargo check
cargo doc --open
cargo run                     # prints a small crate banner

./scripts/dev-web-ui.sh       # launches the base browser demos
./scripts/dev-resources.sh    # launches the Rust resource server alone
./scripts/dev-all.sh          # browser demos + resource server together
./scripts/rebuild-web-wasm.sh # rebuilds elementary-wasm.js after native changes
./scripts/rebuild-web-ui.sh   # rebuilds WASM then the Vite bundle
./scripts/sync-elementary.sh  # re-pulls the vendored Elementary snapshot
```

`dev-all.sh` boots the `elemaudio-resources` server as a separate process
(expected at `../elemaudio-resources/` by default, override with
`ELEMAUDIO_RESOURCES_DIR`) and runs the Vite dev server with
`VITE_ELEMAUDIO_RESOURCES=1` so the resource-manager demo is live.
`dev-web-ui.sh` does not start that server and leaves the flag unset —
the base demos run without the resource server.

## Docs

Rust API docs publish on GitHub Pages:
https://cristianvogel.github.io/elemaudio-rs/

"How we added" development logs under `docs/`:

- `docs/How-We-Added-BoxSum.md`
- `docs/How-We-Added-FreqShift.md`
- `docs/How-We-Added-StrideDelay.md`
- `docs/How-We-Added-Vocoder.md`
- `docs/JS-TS-AUTHORING-PLAN.md`

## Notes

- The crate wraps the runtime constructor, instruction batches, processing,
  timing, and GC.
- The native bridge is built from `build.rs` and the vendored Elementary
  source tree.
- The Rust resource manager and browser mirror demos are an optional
  extension to the vendor VFS model, not a replacement for Elementary's
  original resource lookup path.
- The optional `resources` Cargo feature pulls the public
  `elemaudio-resources` repo for the resource demos and native resource
  tooling.
- In the resource demo, ids are derived from the source filename, mono stays
  on `sample`, and multichannel playback uses `mc.sample(...)`.
- The resource demo metadata endpoint currently returns `duration_ms` and
  `channels` for a resource id.
- Browser uploads confirm before overwriting an existing filename-derived
  resource id.
