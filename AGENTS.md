# elemaudio-rs - Safe Rust FFI bindings for the Elementary audio runtime

<!--
TEMPLATE_VERSION: 1.7.0
TEMPLATE_SOURCE: templates/core/AGENTS.md.template
LAST_SYNC: 2026-03-29
SYNC_CHECK: Run check-version.sh from your Ydun_ai_workflow clone to verify you have the latest template version
AUTO_SYNC: Run sync-templates.sh from your Ydun_ai_workflow clone to update (preserves your customizations)
CHANGELOG: See CHANGELOG.md for version history
-->

**STATUS: IN DEVELOPMENT** - Last Updated: 2026-03-29

## Repository Information
- **GitHub Repository**: git@github-cristianvogel:cristianvogel/elemaudio-rs.git
- **Local Directory**: `/Users/cristianvogel/RustroverProjects/elemaudio-rs`
- **Primary Purpose**: Provides safe Rust bindings around the Elementary audio runtime and its native C++ engine surface.

## Important Context

This project is a Rust wrapper over `src/vendor/elementary`, which is a C++ runtime with header-only native APIs. The current implementation approach is a small C++ bridge plus a safe Rust layer that owns runtime handles, serializes instruction batches, and keeps raw FFI hidden from consumers.

The repository is intentionally narrow at this stage: initialize the crate correctly, keep the wrapper surface small, and expand only when a real runtime use case requires it.

## Core Development Principles (MANDATORY)

### 1. KISS
- Prefer the smallest safe wrapper that can express the runtime API.
- Avoid abstraction layers unless they reduce unsafe surface area.

### 2. TDD
- Add tests for instruction encoding, argument validation, and error mapping.
- Do not add behavior without a corresponding validation path.

### 3. Separation of Concerns
- Keep C++ bridge code isolated from Rust API code.
- Keep vendor code untouched unless a bridge file is explicitly required.

### 4. DRY
- Centralize return-code mapping and JSON instruction encoding.
- Do not duplicate FFI pointer setup across methods.

### 5. Documentation Standards
- Use factual, dated, objective language.
- Document what the wrapper currently supports, not what it might support later.

### 5.5. AI-Optimized Documentation
- Keep status docs structured and current.
- Use tables or bullet lists for commands and current work.

### 6. Jimmy's Workflow v2.1
Use for all implementation tasks:

```
🔴 PRE-FLIGHT → 🔴 IMPLEMENT → 🟢 VALIDATE → 🔵 CHECKPOINT
```

- 🔴 **PRE-FLIGHT**: Verify context, vendor API surface, and build path.
- 🔴 **IMPLEMENT**: Make the minimal safe change.
- 🟢 **VALIDATE**: Run cargo checks/tests and note confidence.
- 🔵 **CHECKPOINT**: Record what is complete and what could invalidate it.

### 7. YAGNI
- Do not add features like audio file loading, device enumeration, or event streaming until the wrapper needs them.

### 8. Fix Now, Not Later
- Fix build and lint issues immediately.
- Do not suppress warnings without documented reason.

### 9. Measure Twice, Cut Once
- Verify vendor paths and crate commands before editing.
- Read the native headers before extending the wrapper.

### 10. No Shortcuts
- Keep the unsafe boundary explicit and auditable.
- Validate the wrapper after every meaningful change.

### 11. Rules Persist
- All principles remain in effect across sessions.

## Commands

### Development
- `cargo build`
- `cargo run`
- `cargo test`
- `cargo check`
- `cargo clippy --all-targets --all-features`

### Native Bridge
- `cargo clean` if the C++ bridge needs a rebuild from stale artifacts.

## Project Structure
- `src/lib.rs` - Public Rust API surface
- `src/runtime.rs` - Safe runtime wrapper and instruction types
- `src/error.rs` - Shared error types and return-code mapping
- `src/ffi.rs` - Raw FFI declarations
- `src/ffi/elementary_bridge.cpp` - C++ bridge into `src/vendor/elementary`
- `src/vendor/elementary/` - Vendored Elementary runtime source
- `build.rs` - Compiles the C++ bridge

## Current Status
- ✅ Repository initialized on `dev`
- ✅ Core workflow docs added
- ✅ Initial safe FFI scaffold validated with `cargo test`
- 🔄 Native integration coverage beyond runtime/core instructions
- ⚪ Tests for real runtime behavior

## Known Issues & Technical Debt

### Critical Issues
- None currently identified.

### Important Issues
- The wrapper currently covers only the runtime constructor, instruction batches, processing, shared resources, and GC callbacks.
- Event streaming and richer resource types are not exposed yet.

### Technical Debt
- Instruction encoding is JSON-based and should stay aligned with the vendor runtime contract.
- The bridge should gain focused integration tests once the first real runtime flow is available.

## Environment Variables
- None required yet.

## Session Notes
- This repo is on the `dev` branch.
- The Elementary vendor code lives under `src/vendor/elementary`.
