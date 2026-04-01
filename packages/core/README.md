# `@elem-rs/core`

This package is the JS/TS authoring surface for Elementary-style graphs.

The Rust crate in this repository owns the native runtime, FFI bridge, and DSP execution path. `@elem-rs/core` is the separate authoring surface for browser and application code.

## Design

- `src/vendor/elementary` is the upstream vendor source of truth.
- `packages/core/src` is the stable package boundary we consume from app code.
- The package re-exports/mirrors the vendor helper surface in a controlled way.
- `scripts/sync-elementary.sh` refreshes vendor, and `scripts/regen-elementary-ts.sh` regenerates this package from the vendor helper modules.

## Why this split exists

Keeping the vendor code separate makes upstream updates mechanical and reduces drift. The package stays small and focused on the public authoring API, while vendor remains the authoritative implementation.

## Public API

- `el.*` graph helpers
- `createNode(...)`, `isNode(...)`, `resolve(...)`, `unpack(...)`, `Renderer`
- `NodeRepr_t`

Use `Renderer` when you want the full upstream reconciliation flow, including `renderWithOptions`, `createRef`, and `prune`.

## Import

Use the package alias:

```ts
import { createCore, el } from "@elem-rs/core";
import type { NodeRepr_t } from "@elem-rs/core";
```
