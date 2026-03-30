# JS/TS Authoring Plan

Marker: `JS-TS-AUTHORING`

## Goal

Provide a simple, modern JS/TS composition surface for `el.*` graphs, `render(...)`, keys, and refs without the old vendor generator style.

## Principles

- Use plain ES modules and modern TypeScript.
- Keep graph code readable and idiomatic.
- Preserve normal language features: variables, arrays, functions, modules, helpers.
- Support `render(...roots)` as the graph handoff.
- Support `key` for structural identity and refs for direct updates.
- Avoid generated ES5-style code in the authoring path.

## Desired Developer Loop

1. Write `el.*` composition code in JS/TS.
2. Use normal JS/TS state, helpers, arrays, and functions.
3. Call `render(...roots)` to describe the current graph.
4. Use `key` on stable leaf nodes when you want structural reuse.
5. Use refs when you want direct property updates without full reconciliation.
6. Lower the graph to instruction batches.
7. Send the batch to the native runtime when ready.

## Shape Of The API

The API should feel like a normal JS/TS library:

```ts
import { el, render } from "@elemaudio/core";

const base = 220;
const harmony = base * 1.618;

const graph = [
  el.cycle(el.sm(el.const({ value: base }))),
  el.cycle(el.sm(el.const({ value: harmony }))),
];

render(...graph);
```

## Package Layout

The authoring package is split by domain to track upstream changes more easily:

- `core.ts`
- `math.ts`
- `filters.ts`
- `oscillators.ts`
- `signals.ts`
- `dynamics.ts`
- `envelopes.ts`
- `mc.ts`
- `index.ts` as the composed public entrypoint

## Sync Flow

- `scripts/sync-elementary.sh` refreshes the vendor tree from upstream.
- `scripts/regen-elementary-ts.sh` copies the upstream helper modules into `packages/core`.
- Handwritten package code stays limited to the shared lower/render/ref scaffolding.

### Keys

- `key` should be used on stable leaf nodes when the graph changes over time.
- It helps the renderer preserve identity across successive `render(...)` calls.

### Refs

- Refs should provide direct updates to mounted nodes.
- Use them when you know exactly which node property should change.
- They complement, rather than replace, normal reconciliation.

## MVP Scope

### Authoring Surface

- `el.*` helpers in modern JS/TS
- multichannel roots as arrays
- `render(...roots)` as the graph handoff
- `key` and refs as first-class concepts

### Lowering

- Convert JS/TS graphs into instruction batches
- Preserve the runtime contract
- Surface rich errors before transport

### Transport

- print batches
- send batches to runtime

## Non-Goals For MVP

- ReScript-generated authoring code
- a Rust-native graph language
- a full browser IDE

## Success Criteria

- A developer can write `el.*` graphs in JS/TS.
- Keys and refs are explainable in the authoring model.
- The runtime still receives the same instruction batches.
