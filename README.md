# elemaudio-rs

Safe Rust bindings for the Elementary audio runtime.

## Development Setup

1. Install Rust with `rustup`.
2. Install a C++ toolchain compatible with `cc` builds.
3. On macOS, install the Xcode Command Line Tools if they are not already present.
4. Clone the repository.
5. Run `cargo build`.
6. Run `cargo test`.

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
