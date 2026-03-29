# elemaudio-rs

Safe Rust bindings for the Elementary audio runtime.

Current state:
- Native Rust wrapper around the Elementary runtime is working.
- Browser POC is running from `examples/web-ui`.
- Multichannel graph rendering is demonstrated with idiomatic `el.*` syntax.
- Planned next step: a Rust-native REPL DSL for graph authoring and debugging.

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

## Development Setup

1. Install Rust with `rustup`.
2. Install a C++ toolchain compatible with `cc` builds.
3. On macOS, install the Xcode Command Line Tools if they are not already present.
4. Clone the repository.
5. Run `cargo build`.
6. Run `cargo test`.

## Upstream Vendor Sync

The Elementary JS/runtime sources are vendored under `src/vendor/elementary`.

To refresh that copy from the upstream repository:

```bash
./scripts/sync-elementary.sh
```

To sync a specific ref:

```bash
./scripts/sync-elementary.sh <branch-or-tag>
```


## Common Commands

```bash
cargo build
cargo test
cargo check
cargo doc --open
```

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

## Whats Next

- `REPL-DSL-RUST`: planned Rust-native graph DSL with a fast edit/evaluate loop and better diagnostics.
