# elemaudio-rs

Safe Rust bindings for the Elementary audio runtime.
For detailed documentation and examples please visit the original website by Nick Thompson  => https://www.elementary.audio/

Current state:
- Native Rust wrapper around the Elementary runtime is working.
- Browser POC is running from `examples/web-ui`.
- JS/TS authoring is implemented in `packages/core`.
- Multichannel graph rendering is demonstrated with idiomatic `el.*` syntax.
- Planned next step: a simpler modern JS/TS authoring layer with no ES5-style lockin.

Package layout:
- `packages/core/src/core.ts`
- `packages/core/src/math.ts`
- `packages/core/src/filters.ts`
- `packages/core/src/oscillators.ts`
- `packages/core/src/signals.ts`
- `packages/core/src/dynamics.ts`
- `packages/core/src/envelopes.ts`
- `packages/core/src/mc.ts`

## Elementary Graph Style

Elementary uses a functional graph style built around the `el.*` helpers.

- Each call returns a node, not an imperative side effect.
- Nodes are composed by nesting them: `el.cycle(el.sm(el.const(...)))`.
- Multichannel graphs are expressed as an array of roots, then rendered with `render(...graph)`.
- The browser POC in `examples/web-ui` shows this pattern end to end.

Example:

```ts
function buildGraph(frequency: number) {
  return [
    el.cycle(el.sm(el.const({ value: frequency }))),
    el.cycle(el.sm(el.const({ value: frequency * 1.618 }))),
  ];
}

await renderer.render(...buildGraph(220));
```

## JS/TS Authoring

The intended composition workflow is JS/TS-first:

1. Write `el.*` graphs in modern JS/TS.
2. Use normal language features like variables, arrays, helpers, and functions.
3. Use `render(...roots)` to describe the current graph.
4. Use `key` for stable leaf identity when graphs change over time.
5. Use refs for direct property updates on mounted nodes.
6. Lower the graph to instruction batches.
7. Inspect or transport the batch with tooling.
8. Keep iteration fast with file watch / reload.

Authoring example:

```ts
const base = 220;
const graph = [
  el.cycle(el.sm(el.const({ value: base }))),
  el.cycle(el.sm(el.const({ value: base * 1.618 }))),
];

render(...graph);
```

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

## Usage

### Create a runtime

```rust
use elemaudio_rs::{Result, Runtime};

fn main() -> Result<()> {
    let runtime = Runtime::new(48_000.0, 128)?;
    runtime.reset();
    Ok(())
}
```

### Apply instructions

```rust
use elemaudio_rs::{Instruction, InstructionBatch, Result, Runtime};
use serde_json::json;

fn configure(runtime: &Runtime) -> Result<()> {
    let mut batch = InstructionBatch::new();
    batch.push(Instruction::CreateNode {
        node_id: 1,
        node_type: "osc".to_string(),
    });
    batch.push(Instruction::SetProperty {
        node_id: 1,
        property: "gain".to_string(),
        value: json!(0.5),
    });
    batch.push(Instruction::CommitUpdates);

    runtime.apply_instructions(&batch)
}
```

### Process audio

```rust
use elemaudio_rs::{Result, Runtime};

fn render(runtime: &Runtime) -> Result<()> {
    let input_l = vec![0.0_f64; 128];
    let input_r = vec![0.0_f64; 128];
    let mut output_l = vec![0.0_f64; 128];
    let mut output_r = vec![0.0_f64; 128];

    let inputs = [&input_l[..], &input_r[..]];
    let mut outputs = [&mut output_l[..], &mut output_r[..]];

    runtime.process(128, &inputs, &mut outputs)
}
```

## Notes

- The crate currently wraps the runtime constructor, instruction batches, shared `f32` resources, processing, timing, and GC.
- The native bridge is built from `build.rs` and the vendored Elementary source tree.

## Examples

- `examples/web-ui` is the working browser POC.

## Plan

- `docs/JS-TS-AUTHORING-PLAN.md` describes the new authoring surface.

## Whats Next

- Improve the JS/TS authoring surface and reconciliation model.
