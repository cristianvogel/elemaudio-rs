# Examples

The JS graph lives in your frontend application, not inside the Rust runtime wrapper.

This folder shows the split in practice:

1. Write the audio graph in JS or TS with the Elementary `core` package, preferably through `el.*` helpers.
2. Use a `Renderer` to turn that graph into packed instruction batches.
3. Pass the packed instructions into `elemaudio-rs`.

## Files

- `frontend-graph.ts` - example frontend graph that emits instructions
- `web-ui/` - minimal browser app with a start button and oscillator

## Flow

```text
JS graph -> Reconciler -> packed instructions -> elemaudio-rs -> native runtime
```

## Notes

- The JS example imports from the vendored Elementary JS package path in this repository.
- In a real application, you would copy the same pattern into your own app or package.
- The web UI example can be run from `examples/web-ui` with `npm install` and `npm run dev`.
- REPL DSL marker: `REPL-DSL-RUST`.
