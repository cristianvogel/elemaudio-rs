# Web UI Example

Minimal browser frontend for `elemaudio-rs`.

## What It Does

1. Opens a page with a start button and frequency slider.
2. Creates a `WebRenderer` and an `AudioContext` on user gesture.
3. Builds a JS graph with Elementary `createNode` calls.
4. Sends packed instructions to the native runtime bridge.

The example now also includes:

- `sample.html` for sample playback from `demo-resources/`
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

For the Rust resource manager demo, start the local server in another terminal:

```bash
./scripts/dev-all.sh
```

That command updates the `elemaudio-resources` dependency, starts the server from the public repo, and enables the browser feature flag.

Then open `/resource-manager.html` in the Vite app. The server owns the resources in Rust, and the browser mirrors the selected resource into the VFS before playing it with `el.sample(...)`.

This demo is feature-gated. Set `VITE_ELEMAUDIO_RESOURCES=1` when running Vite to enable the resource manager UI in the browser build.

If Vite reports a missing module from the vendored Elementary sources, reinstall after the dependency list changes.

## Notes

- This is a source example; it is not wired into a workspace-level build yet.
- The example depends on the vendored Elementary JS sources in this repository.
