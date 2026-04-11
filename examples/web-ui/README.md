# Web UI Example

Minimal browser frontend for `elemaudio-rs`.

## What It Does

1. Opens a page with a start button and frequency slider.
2. Creates a `WebRenderer` and an `AudioContext` on user gesture.
3. Builds a JS graph with Elementary `createNode` calls.
4. Sends packed instructions to the native runtime bridge.

The example now also includes:

- `sample.html` for sample playback from `demo-resources/`
- IR channel splitting for multichannel convolution demoing with plain `el.convolve(...)`
- An IR pair toggle that switches between `_ch1/_ch2` and `_ch3/_ch4` when the IR has at least 4 channels
- `resource-manager.html` for Rust-owned resource upload, rename, delete, prune, and browser VFS playback mirroring
- This resource flow is an optional extension to the vendor VFS model, not a replacement for it.

## Run It

```bash
cd examples/web-ui
npm install
npm run dev
```

Or from the repo root:

```bash
./scripts/dev-web-ui.sh
./scripts/dev-all.sh
```

- `dev-web-ui.sh` runs the base demos without the resource feature.
- `dev-all.sh` runs the Vite app with `VITE_ELEMAUDIO_RESOURCES=1` and starts the public `elemaudio-resources` server through the `resources` Cargo feature.

Open the local Vite URL, click `Start audio`, and adjust the slider.

For the Rust resource manager demo, use the feature-enabled launcher:

```bash
./scripts/dev-all.sh
```

That command updates the `elemaudio-resources` dependency, starts the server from the public repo, and enables the browser feature flag.

Then open `/resource-manager.html` in the Vite app. The server owns the resources in Rust, the resource id is derived from the source filename, and the browser mirrors the selected resource into the VFS before playing it with `el.sample(...)` for mono or `el.mc.sample(...)` for multichannel.

Open `/sample.html` to try the IR demo. It splits the loaded IR into per-channel VFS paths like `demo-resources/DEEPNESS_ch1.wav` and `demo-resources/DEEPNESS_ch2.wav`, then uses plain `el.convolve(...)` nodes against the selected pair.

If the derived resource id already exists, the upload flow asks before overwriting it.

The resource demo also requests metadata by resource id and displays `duration_ms` plus channel count.

This demo is feature-gated. Set `VITE_ELEMAUDIO_RESOURCES=1` when running Vite to enable the resource manager UI in the browser build.
