# elemaudio-rs

Safe Rust bindings for the Elementary audio runtime.
For detailed documentation and examples please visit the original website by Nick Thompson  => https://www.elementary.audio/

👀 You might also want to take a look at the sister repo, a Rust resource server for the Elem VFS https://github.com/cristianvogel/elemaudio-resources 


## Authoring Surfaces

This repository exposes two composition surfaces:

- Rust helpers in `src/graph.rs` for native examples and lower-level control
- `@elem-rs/core` in `packages/core` for the JS/TS authoring layer

The Rust runtime executes lowered instruction batches through the FFI bridge. The JS/TS package provides the higher-level authoring API used by the browser demos.
The Rust graph helpers also include `el.custom(...)` for custom node kinds and `mc.*` for multichannel wrappers.
The Rust `core` module exposes `create_node`, `resolve`, `is_node`, and `unpack`.
The Rust helper surface stays function-based: the fold-style math helpers use tuple inputs, rather than a macro DSL.

For key-driven composition guidance, see Elementary's guide on understanding keys:
https://www.elementary.audio/docs/guides/Understanding_Keys

## Elementary Graph Style

Elementary uses a functional graph style built around the `el.*` helpers.

- Each call returns a node, not an imperative side effect.
- Nodes are composed by nesting them: `el.cycle(el.sm(el.const(...)))`.
- In Rust, variadic math helpers take tuple inputs, for example `el::mul((a, b, c))` and `el::div((node, 0.5))`.
- Multichannel graphs are expressed as an ordered array of channel graphs, then rendered with `Graph::render(...)`.
- The browser POC in `examples/web-ui` shows this pattern end to end.

Rust example:

```rust
use elemaudio_rs::{el, Graph};

fn build_graph() -> Graph {
    let left = el::cycle(el::sm(el::const_with_key("left", 220.0)));
    let right = el::cycle(el::sm(el::const_with_key("right", 220.0 * 1.618)));

    Graph::new().render([left, right])
}

let batch = build_graph().lower();
```

## JS/TS Authoring

The intended composition workflow is JS/TS-first:

1. Write `el.*` graphs in modern JS/TS.
2. Use normal language features like variables, arrays, helpers, and functions.
3. Use `render(...)` to describe the current graph.
4. Use `key` to compose stable identity into the graph structure.
5. Use refs for direct property updates on mounted nodes _(not fully implemented yet for JS layer!)_
6. Lower the graph to instruction batches.
7. Inspect or transport the batch with tooling.
8. Keep iteration fast with file watch / reload.

Keys are part of composition, not an afterthought. They let the renderer preserve node identity across successive `render(...)` calls while the surrounding graph shape changes. That is the recommended pattern for stable leaf nodes and direct updates.

JS/TS example:

```ts
const base = 220;
const graph = [
  el.cycle(el.sm(el.const({ value: base, key: "left" }))),
  el.cycle(el.sm(el.const({ value: base * 1.618, key: "right" }))),
];

render(...graph);
```

For stable node updates during a live session, keep the `key` values fixed and change only the surrounding graph inputs or props. That lets the renderer reconcile the tree without replacing the keyed leaf nodes.

See `docs/JS-TS-AUTHORING-PLAN.md` for the target surface.
The current package entrypoint lives in `packages/core/src/index.ts`.

## Development Setup

1. Install Rust with `rustup`.
2. Install a C++ toolchain compatible with `cc` builds.
3. On macOS, install the Xcode Command Line Tools if they are not already present.
4. Clone the repository.
5. Run `cargo build`.
6. Run `cargo test`.

## Upstream Vendor Sync

The Elementary JS/runtime sources are vendored under `src/vendor/elementary`.
The JS/TS authoring package is generated into `packages/core`.

To refresh that copy from the upstream repository:

```bash
./scripts/sync-elementary.sh
```

To sync a specific ref:

```bash
./scripts/sync-elementary.sh <branch-or-tag>
```

The sync script also regenerates `packages/core` from the upstream helper modules.


## Common Commands

```bash
cargo build
cargo test
cargo check
cargo doc --open
cargo run
```

`cargo run` prints a small crate banner.

## Demo Launchers

```bash
./scripts/dev-web-ui.sh
./scripts/dev-all.sh
```

- `dev-web-ui.sh` starts the base browser demos.
- `dev-all.sh` starts the browser demos plus the resource-manager server, with `VITE_ELEMAUDIO_RESOURCES=1` enabled and the `resources` Cargo feature pulled from the public repo.

## Usage

### 1. Compose a graph

```rust
use elemaudio_rs::{el, Graph};

let graph = Graph::new().render([
    el::cycle(el::sm(el::const_with_key("left", 220.0))),
    el::cycle(el::sm(el::const_with_key("right", 220.0 * 1.618))),
]);
```

The Rust surface is `el::*`-first. Use `key` on stable leaf nodes so the mounted graph can preserve identity across successive `render(...)` calls.

### 2. Create a runtime and mount the graph

```rust
use elemaudio_rs::{el, Graph, Result, Runtime};

fn main() -> Result<()> {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(128)
        .call()?;

    let graph = Graph::new().render([
        el::cycle(el::sm(el::const_with_key("left", 220.0))),
        el::cycle(el::sm(el::const_with_key("right", 220.0 * 1.618))),
    ]);

    let mounted = graph.mount();
    runtime.apply_instructions(mounted.batch())?;
    Ok(())
}
```

### 3. Produce sound through a host backend

`elemaudio-rs` does not require CPAL specifically. Any audio host that can provide input and output buffers and call `Runtime::process(...)` works.

CPAL is used in `tests/audio_playback.rs` as one working host bridge example.

```rust
use elemaudio_rs::{el, Graph, Result, Runtime};

fn render(runtime: &Runtime) -> Result<()> {
    let graph = Graph::new().render([
        el::cycle(el::sm(el::const_with_key("left", 220.0))),
        el::cycle(el::sm(el::const_with_key("right", 330.0))),
    ]);

    let mounted = graph.mount();
    runtime.apply_instructions(mounted.batch())?;

    let input_l = vec![0.0_f64; 128];
    let input_r = vec![0.0_f64; 128];
    let mut output_l = vec![0.0_f64; 128];
    let mut output_r = vec![0.0_f64; 128];

    let inputs = [&input_l[..], &input_r[..]];
    let mut outputs = [&mut output_l[..], &mut output_r[..]];

    runtime.process(128, &inputs, &mut outputs)
}
```

### 4. Update keyed nodes without rebuilding

```rust
use elemaudio_rs::{el, Graph, Result, Runtime};

fn update(runtime: &Runtime) -> Result<()> {
    let graph = Graph::new().render([
        el::cycle(el::sm(el::const_with_key("left", 220.0))),
        el::cycle(el::sm(el::const_with_key("right", 330.0))),
    ]);

    let mounted = graph.mount();

    if let Some(batch) = mounted.set_const_value("left", 330.0) {
        runtime.apply_instructions(&batch)?;
    }

    Ok(())
}
```

This updates the keyed node directly. The graph stays mounted; only the property batch changes. CPAL is not required; any host bridge that calls `Runtime::process(...)` can drive audio.

## Notes

- The crate currently wraps the runtime constructor, instruction batches, processing, timing, and GC.
- The native bridge is built from `build.rs` and the vendored Elementary source tree.
- The Rust resource manager and browser mirror demos are an optional extension to the vendor VFS model, not a replacement for Elementary's original resource lookup path.
- The optional `resources` feature pulls the public `elemaudio-resources` repo for the resource demos and native resource tooling.
- In the resource demo, ids are derived from the source filename, mono stays `sample`, and multichannel playback uses `mc.sample(...)`.
- The resource demo metadata endpoint currently returns `duration_ms` and `channels` for a resource id.
- Browser uploads confirm before overwriting an existing filename-derived resource id.

## Examples

- `examples/web-ui` is the working browser POC.

## Plan

- `docs/JS-TS-AUTHORING-PLAN.md` describes the new authoring surface.

## Whats Next

- Improve the JS/TS authoring surface and reconciliation model.
