# Claude AI Assistant Instructions

Please refer to **AGENTS.md** for complete project guidelines and context.

This project follows the [agents.md](https://agents.md/) standard for AI coding assistants.

## Quick Reference

**Project**: elemaudio-rs
**Purpose**: Safe Rust FFI bindings for the Elementary audio runtime

### Core Principles

1. KISS
2. TDD
3. SOC
4. DRY
5. Documentation Standards
6. Jimmy's Workflow
7. YAGNI
8. Fix Now
9. Measure Twice
10. No Shortcuts
11. Rules Persist

### Jimmy's Workflow v2.1

```
PRE-FLIGHT → IMPLEMENT → VALIDATE → CHECKPOINT
```

HIGH (proceed) | MEDIUM (human spot-check) | LOW (human required)

### Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Complete project guidelines and context |
| `JIMMYS-WORKFLOW.md` | Full validation system v2.1 |
| `STATUS.md` | Live project status and metrics |
| `NEXT-SESSION-START-HERE.md` | Session continuity and next steps |
| `src/runtime.rs` | Safe Rust wrapper around the Elementary runtime |
| `src/ffi/elementary_bridge.cpp` | Native bridge into the vendored C++ runtime |

### Common Commands

```bash
cargo build
cargo test
cargo check
cargo clippy --all-targets --all-features
```

---

*Last updated: 2026-03-29*
