# Next Session Start Here

<!--
TEMPLATE_VERSION: 1.0.0
TEMPLATE_SOURCE: templates/core/NEXT-SESSION-START-HERE.md.template
LAST_SYNC: 2026-03-29
PURPOSE: Provide quick context and continuity between development sessions
-->

**Last Updated:** 2026-03-29
**Last Session:** Added and validated the initial safe Rust/C++ bridge scaffold for Elementary
**Current Phase:** Development
**Session Summary:** See STATUS.md for complete details

---

## ⚡ Quick Context Load (Read This First!)

### What This Project Is

**elemaudio-rs** is a safe Rust wrapper around the Elementary audio runtime.

**Your Role:** Developer
- Keep the unsafe boundary inside the FFI layer
- Expand the wrapper only when the runtime needs it
- Do not edit vendor code unless the bridge requires it

**Current Status:** 15% complete
- ✅ Project docs initialized
- ✅ Runtime wrapper scaffold added and validated
- 🔄 Broader runtime coverage and integration tests

---

## 🟢 Current Status Summary

### What's Been Completed ✅

**Initialization:**
- ✅ `AGENTS.md`
- ✅ `STATUS.md`
- ✅ `NEXT-SESSION-START-HERE.md`

**Wrapper Scaffold:**
- ✅ `build.rs`
- ✅ `src/lib.rs`
- ✅ `src/runtime.rs`
- ✅ `src/ffi.rs`
- ✅ `src/ffi/elementary_bridge.cpp`

**Metrics:**
- Rust modules: 4
- C++ bridge files: 1

---

## 🎯 Current Task: Expand the Bridge (20% Complete)

### Completed Steps
- [x] Read the vendor runtime API surface
- [x] Added the initial FFI bridge and safe wrapper types
- [x] Validated the bridge with `cargo test`

### Remaining Steps
- [ ] Add the next runtime surface area that is actually needed
- [ ] Add integration tests for the real usage path

**Estimated Time:** One to two sessions

---

## 📁 Key Project Files (Quick Access)

### Start Here if You're New
1. **STATUS.md** - Complete project status and metrics
2. **AGENTS.md** - Development guidelines and context
3. **Cargo.toml** - Rust crate and build configuration

### Runtime Wrapper Files
4. **src/runtime.rs** - Safe runtime wrapper and instruction batches
5. **src/ffi.rs** - Raw FFI declarations
6. **src/ffi/elementary_bridge.cpp** - C++ bridge into the vendor runtime

---

## 🎯 Immediate Next Steps (Choose One)

### Option 1: Expand runtime coverage ⭐ RECOMMENDED (1-2 sessions)

**Goal:** Add the next safe wrapper surface required by the runtime.

**Tasks:**
- [ ] Add the next runtime operation that is actually needed
- [ ] Keep the unsafe boundary inside the bridge
- [ ] Add validation for the new path

**Why First:** The scaffold is already validated, so the next step is the smallest useful expansion.

**Commands:**
```bash
cargo test
```

---

### Option 2: Expand runtime coverage (next)

**Goal:** Add more Elementary operations only if validation passes.

**Tasks:**
- [ ] Add event processing if needed
- [ ] Add richer resource wrappers if needed

---

### Option 3: Add integration tests (after validation)

**Goal:** Verify the wrapper against a real Elementary usage path.

**Tasks:**
- [ ] Add a runtime smoke test
- [ ] Add instruction batch coverage

---

## 🔑 Quick Reference

### Access Project
```bash
cd /Users/cristianvogel/RustroverProjects/elemaudio-rs

# Read session context
cat NEXT-SESSION-START-HERE.md
cat STATUS.md

# Check git status
git status
git log --oneline -5
```

### Common Commands
```bash
cargo check
cargo test
cargo clippy --all-targets --all-features
```

---

## ⚠️ Important Reminders

### 1. Keep the FFI boundary small
The Rust API should own all runtime handles and hide raw pointers.

### 2. Validate after every meaningful change
Do not assume the C++ bridge compiles until `cargo test` or `cargo check` says so.

### 3. Jimmy's Workflow
Always follow PRE-FLIGHT, IMPLEMENT, VALIDATE, CHECKPOINT.
