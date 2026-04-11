//! Authoring surface for graph composition.
//!
//! This module provides three submodules for constructing Elementary-style
//! audio graph nodes:
//!
//! - `el` – Functional helpers mirroring Elementary's `el.*` style with math,
//!   signals, filters, and oscillators.
//! - `mc` – Multichannel helpers for sample, table, and capture operations.
//! - `extra` – Extended helpers for native DSP nodes (frequency shifter, crunch,
//!   foldback, etc.).

pub mod el;
pub mod extra;
pub mod mc;

pub use el::IntoNodeList;
