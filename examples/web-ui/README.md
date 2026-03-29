# Web UI Example

Minimal browser frontend for `elemaudio-rs`.

## What It Does

1. Opens a page with a start button and frequency slider.
2. Creates a `WebRenderer` and an `AudioContext` on user gesture.
3. Builds a JS graph with Elementary `createNode` calls.
4. Sends packed instructions to the native runtime bridge.

## Run It

```bash
cd examples/web-ui
npm install
npm run dev
```

Open the local Vite URL, click `Start audio`, and adjust the slider.

If Vite reports a missing module from the vendored Elementary sources, reinstall after the dependency list changes.

## Notes

- This is a source example; it is not wired into a workspace-level build yet.
- The example depends on the vendored Elementary JS sources in this repository.
