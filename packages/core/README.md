# `@elem-rs/core`

JS/TS authoring surface for Elementary-style graphs.

The Rust crate owns runtime, FFI, native DSP, and browser execution. This package owns the public authoring API consumed by app code.

## What this package does

- exposes `el.*` helpers
- exposes `Renderer`
- mirrors the vendor helper surface from `src/vendor/elementary`
- stays separate from the runtime bridge so vendor refreshes stay mechanical

## Code path

- package source: `packages/core/src`
- vendor source of truth: `src/vendor/elementary`
- vendor refresh: `scripts/sync-elementary.sh`
- TS regeneration: `scripts/regen-elementary-ts.sh`

## Public API

- `el.*` graph helpers
- `createNode(...)`
- `resolve(...)`
- `unpack(...)`
- `Renderer`
- `NodeRepr_t`

Use `Renderer` when you want the upstream reconciliation flow, including `renderWithOptions`, `createRef`, and `prune`.

## Import

```ts
import { el, Renderer } from "@elem-rs/core";
import type { NodeRepr_t } from "@elem-rs/core";
```
