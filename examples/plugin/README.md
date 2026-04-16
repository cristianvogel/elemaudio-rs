# CLAP Plugin Example — elemaudio-rs

A minimal stereo stride delay effect plugin demonstrating how to author an Elementary Audio
graph in Rust and host it inside a CLAP plugin with a Wry webview GUI. This is a milestone for the development of this project.
---
#### 📍 This bundler does NOT clean the Library/Audio/Plug-Ins/CLAP/ folder , but will erase previous builds of the plugin.

---
## What this proves

The same DSP graph that runs in the browser (via the TS authoring surface in
`packages/core`) can be authored in Rust and hosted natively inside a plugin.
The node types, props, and processing kernels are identical across both surfaces.

```
              TS (browser)                          Rust (native plugin)
  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
  │ el.extra.strideDelay(           │   │ extra::stride_delay(            │
  │   { maxDelayMs: 1500 },         │   │   json!({"maxDelayMs": 1500}),  │
  │   el.const({value: 250}),       │   │   el::const_(250.0),            │
  │   el.const({value: 0.3}),       │   │   el::const_(0.3),              │
  │   input,                        │   │   input,                        │
  │ )                               │   │ )                               │
  └────────────┬────────────────────┘   └────────────┬────────────────────┘
               │                                     │
               ▼                                     ▼
        elem::Runtime<float>                  elem::Runtime<double>
        (WASM, AudioWorklet)                  (native C++ via FFI)
```

`delayMs` and `fb` are signal children (not props), enabling sample-rate
modulation and graph-level per-channel variation.

The key difference is the **input source**:

| Context          | `input` is                                  |
|------------------|---------------------------------------------|
| Browser demo     | `el.cycle(el.const({ value: 440 }))` — self-generated test tone |
| CLAP plugin      | `el::r#in(json!({"channel": 0}), None)` — reads from runtime input buffer 0 |
| Standalone test  | Any signal node — oscillator, noise, file playback |

Everything downstream of the input is the same graph, same props, same audio result.

### How `el::r#in` maps to audio channels

The `channel` prop on `el::r#in` selects which **runtime input buffer** to read
from. It does not directly mean "left" or "right" — it indexes into the input
array passed to `runtime.process(num_samples, &inputs, &mut outputs)`.

In this example, the plugin process callback provides two input buffers:

```rust
let inputs: [&[f64]; 2] = [&self.in_l[..block], &self.in_r[..block]];
//                          ^^^^^^^^ channel 0    ^^^^^^^^ channel 1
```

So `el::r#in(json!({"channel": 0}), None)` reads the left input buffer and
`el::r#in(json!({"channel": 1}), None)` reads the right. The graph is built
per-channel — one `stride_delay` for L and one for R — then rendered as a
two-root graph:

```rust
Graph::new().render(vec![out_l, out_r])
//                       root 0  root 1
```

Root 0 writes to output buffer 0 (left), root 1 writes to output buffer 1
(right). For multichannel (e.g. surround), add more `el::r#in` nodes with
higher channel indices and more roots in the render call.

## Structure

```
examples/plugin/
├── Cargo.toml                 workspace manifest
├── bundle.sh                  macOS .clap bundler (build + optional install)
├── ui/
│   └── index.html             webview GUI (vanilla JS, no build step)
├── crates/
│   ├── dsp/
│   │   └── src/
│   │       ├── lib.rs          DspParameters, constants, clamping
│   │       └── graph_script.rs StrideDelayGraph — pure el::* graph (~50 lines)
│   └── plugin/
│       └── src/
│           ├── clack_entry.rs  CLAP entry point
│           ├── shared.rs       lock-free parameter store (atomic f32 relay)
│           ├── editor.rs       Wry webview editor (macOS, embedded HTML)
│           ├── plugin.rs       audio processor, main thread, GUI lifecycle
│           └── params.rs       CLAP parameter declarations, state save/load
```

No npm, no SolidJS, no Vite, no bundler. The HTML is embedded at compile time
via `include_str!`.

## Build

```bash
cd examples/plugin

# Build, bundle, and install to ~/Library/Audio/Plug-Ins/CLAP/
./bundle.sh --install

# Or build without installing:
./bundle.sh
# Output: target/bundle/stride-delay-example.clap
```

Then open your CLAP host (Bitwig, Reaper, etc.) and load "Stride Delay Example".
The plugin is a stereo audio effect — insert it on a track with audio.

## How it works

### DSP (`crates/dsp/src/graph_script.rs`)

The graph is authored as a pure `DspGraph` implementation — the framework's
`Engine<StrideDelayGraph>` handles mounting, parameter diffing, and runtime
delegation. The graph script is ~50 lines of `el::*` code:

```rust
impl DspGraph for StrideDelayGraph {
    type Params = DspParameters;

    fn build(p: &DspParameters) -> Vec<Node> {
        let channel = |ch: usize, tag: &str| {
            let input = el::r#in(json!({"channel": ch}), None);
            let delay = el::const_with_key(&format!("sd:{tag}:delay"), p.delay_ms as f64);
            let fb = el::const_with_key(&format!("sd:{tag}:fb"), p.feedback as f64);

            let delayed = extra::stride_delay(
                json!({ "maxDelayMs": MAX_DELAY_MS, "transitionMs": p.transition_ms as f64 }),
                delay, fb, input.clone(),
            );
            // wet/dry blend ...
        };
        vec![channel(0, "L"), channel(1, "R")]
    }
}
```

The engine auto-discovers keyed consts and native node props from the graph
tree — no manual declarations needed. Parameter changes emit targeted
`set_const_value` / `SetProperty` instructions — no graph rebuild.

### Feedback insert loop

The `stride_delay_with_insert` helper enables processing in the feedback path:

```rust
let delayed = extra::stride_delay_with_insert(
    json!({ "maxDelayMs": 1500, "fbtap": "fb_loop" }),
    delay_ms, fb_amount,
    |fb_audio| el::lowpass(cutoff, q, fb_audio),  // darken each repeat
    input,
);
```

The insert closure receives the feedback audio signal and returns a processed
version. Implemented via `tapIn`/`tapOut` with 1-block latency. A stereo
variant (`stereo_stride_delay_with_insert`) builds per-channel tap pairs.

### Audio processing (`plugin.rs`)

The process callback:

1. Reads host f32 audio into f64 scratch buffers
2. Runs `elem::Runtime<double>` — the same C++ kernel as the browser
3. Writes f64 output back as f32
4. Handles all `ChannelPair` variants (in-place, split I/O, output-only)
5. Chunks into `max_frames`-sized blocks if the host sends oversized buffers

### Parameter flow

```
Host knobs ──► CLAP ParamValue events ──► PluginParamsLocal ──► engine.set_params()
                                                                      │
WebView UI ──► window.ipc.postMessage ──► SharedParameterStore ───────┘
       ▲                                        │
       └──── CustomEvent (parameter_changed) ◄──┘
```

Bidirectional: host faders reflect webview changes, webview sliders reflect
host automation. The `SharedParameterStore` uses lock-free atomics safe for
real-time audio threads.

## Date

2026-04-13
