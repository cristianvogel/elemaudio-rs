# Graph Export v1.0

**Date:** 2026-03-30
**Status:** Draft

## Purpose

This document defines the first graph-template export/import format for `elemaudio-rs`.
The intent is to freeze a composed Elementary graph as a versioned asset that can be:

- exported from Rust
- stored on disk
- imported later to reconstruct the same graph shape

This first version is intentionally small and does not attempt to model runtime state.

## Scope

v1.0 preserves the authored graph structure:

- node kind
- node props
- child nodes
- stable `key` values when they are present in node props

v1.0 does not define explicit ref semantics.

## API Shape

Proposed Rust API:

```rust
pub struct GraphTemplateV1 {
    pub version: u16,
    pub roots: Vec<NodeTemplateV1>,
}

pub struct NodeTemplateV1 {
    pub kind: String,
    pub props: serde_json::Value,
    pub children: Vec<NodeTemplateV1>,
}

impl Graph {
    pub fn export_v1(&self) -> GraphTemplateV1;
    pub fn import_v1(template: GraphTemplateV1) -> Result<Self>;
}
```

## Round-Trip Rules

- `kind` must round-trip exactly.
- `props` must round-trip exactly as JSON.
- `children` must preserve tree order.
- `key` is preserved when authored as a property.
- runtime node ids are not part of the export format.
- lowered instruction batches are not part of the export format.

## Non-Goals For v1.0

- ref semantics
- runtime GC state
- backend-specific node ids
- transport serialization for buffers/resources
- instruction-batch export as the primary format

## Example

```json
{
  "version": 1,
  "roots": [
    {
      "kind": "cycle",
      "props": {},
      "children": [
        {
          "kind": "sm",
          "props": {},
          "children": [
            {
              "kind": "const",
              "props": { "key": "freqL", "value": 220.0 },
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

## Versioning

- `version = 1` means Graph Export v1.0.
- Future schema revisions should be additive where possible.
- Breaking changes should receive a new version field and a dedicated importer.

## Notes

- This format lives in `elemaudio-rs` because it defines the Elementary graph shape.
- The resource system in `elemaudio-resources` may store or load exported graph templates later, but it does not define the schema.
