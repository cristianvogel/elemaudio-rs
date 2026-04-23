# Web UI Example

Browser demo app for `elemaudio-rs`.

The shell in `examples/web-ui/index.html` loads demos in an iframe and the shared bootstrapping lives in `src/demos/demo-harness.ts`.

## What it covers

- basic synth and sample demos
- box sum / box average demos
- vocoder demo
- waveshaper and resonator-bank demos
- optional resource-manager demo backed by the separate `elemaudio-resources` repo

## Run it

```bash
./scripts/dev-web-ui.sh
```

That runs the base demos.

To include the resource-manager path:

```bash
./scripts/dev-all.sh
```

That starts the browser app with `VITE_ELEMAUDIO_RESOURCES=1` and launches the external resource server through the `resources` Cargo feature.

## Notes

- `resource-manager.html` is feature-gated.
- The browser rebuild scripts require Emscripten tools on `PATH`.
- After changing native `el::extra::*` registrations, rebuild the browser WASM bundle first.
