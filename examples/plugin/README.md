# CLAP Plugin Example

This example packages a Rust-authored Elementary graph as a CLAP plugin with a Wry webview editor.

The DSP graph lives under `examples/plugin/crates/dsp`, the plugin host under `examples/plugin/crates/plugin`, and the bundle script produces the macOS `.clap` package.

## What it proves

- the Rust authoring surface can drive the native runtime directly
- the plugin path uses the same runtime and DSP kernels as the browser path
- parameter updates flow through the engine without rebuilding the graph tree when keys are stable

## Build

```bash
cd examples/plugin
./bundle.sh
```

To install into `~/Library/Audio/Plug-Ins/CLAP/`:

```bash
./bundle.sh --install
```

## Current graph

The example uses `strideDelay`-based DSP with `delayMs` and `fb` as node children, not props. The plugin code handles the CLAP buffer bridge and the GUI lifecycle; the DSP crate handles the graph.
