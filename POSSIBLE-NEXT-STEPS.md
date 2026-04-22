# Possible Next Steps

Date: 2026-04-22

## Preset System Direction

Possible next step: build presets as a library-level state service, not as a DSP node like `el.extra.preset()`.

Recommended shape:

- Add a Rust-side preset module such as `src/preset.rs`
- Re-export it from the library root as `elemaudio_rs::preset::*`
- Keep preset capture/save/load/recall on the host or message thread
- Reuse existing fast paths for recall:
  - keyed const updates via `MountedGraph::set_const_value(...)`
  - native prop updates via `MountedNode::set_property(...)`
  - typed graph reconciliation via `Engine<G>::set_params(...)`

## Why Not `el.extra.preset()`

- A preset is not an audio signal
- Persistence and recall are not audio-thread responsibilities
- File or browser storage should stay outside the graph runtime
- `extra` currently means first-party graph helpers / native DSP nodes, which is not a good semantic fit for preset storage

## Recommended Rust API Shape

Possible core types:

- `PresetStore`
- `PresetBank`
- `PresetSnapshot`
- `RecallOptions`
- `RecallResult`
- `RecallWarning`

Possible store implementations:

- `MemoryPresetStore`
- `FilePresetStore`
- browser-side store remains separate for now, for example `localStorage`

Possible `PresetSnapshot` contents:

- typed params snapshot (`serde` value or typed `Params`)
- keyed const values
- keyed native prop values
- metadata such as linked sample/resource ids

## Preferred Recall Strategy

Preset recall should be defensive by default.

Recommended behavior:

- no preset bank: do not panic
- empty bank: do not panic
- missing selected preset: do not panic
- missing named preset: do not panic
- stale keyed const links: apply what matches, warn for the rest
- stale native prop links: apply what matches, warn for the rest
- missing resource/sample links: keep current value or fall back to a neutral default, but do not crash recall

## Recommended Recall Contract

Recall should return structured warnings, not just `Result<()>`.

Possible warnings:

- `NoPresetsInBank`
- `SelectedPresetMissing { selected }`
- `NamedPresetMissing { name }`
- `MissingNodeKey { key }`
- `MissingNativePropTarget { node_key, prop }`
- `MetadataLinkMissing { field, value }`
- `UnknownField { field }`
- `FellBackToDefaults`

Possible behavior rules:

- apply what can be applied
- skip what cannot be resolved
- report warnings for all skipped links
- optionally fall back to defaults when the requested preset is absent

## Stable Addressing Rule

Preset recall should use stable node keys.

Prefer:

- keyed const ids such as `osc1:freq`
- keyed native node ids plus prop names

Avoid as persisted public format:

- runtime node ids
- anonymous structural paths
- node kind alone

## Suggested Implementation Order

1. Add `preset.rs` with serializable `PresetBank` / `PresetSnapshot` types.
2. Add typed capture/apply support on `Engine<G>` for serde-capable `Params`.
3. Add a file-backed Rust store.
4. Add tests for round-trip save/load and defensive recall behavior.
5. Add generic mounted-graph capture/apply support for raw graph users.
6. Align browser demo preset helpers with the same bank/snapshot terminology.

## Engine-First Recommendation

Best v1 path: start with `Engine<G>` presets first.

Reason:

- `Engine<G>` already owns the current parameter snapshot
- it already has minimal-update reconciliation
- it gives a cleaner default/fallback story
- it is easier to serialize and validate than anonymous graph topology

Possible pattern:

- store `default_params`
- on recall, start from defaults
- overlay preset values
- call `set_params(...)`
- apply extra keyed/native overrides if needed
- return `RecallResult` with warnings for anything skipped
