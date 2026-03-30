//! Safe Rust bindings for the Elementary audio runtime.
//!
//! This crate exposes a small wrapper around the native runtime handle,
//! JSON instruction batches, a Rust-native resource manager, and audio
//! processing entrypoints.

mod error;
mod ffi;
mod graph;
mod resource;
mod runtime;

/// Error types and helpers used by the public API.
pub use error::{Error, Result};
/// Rust-native graph primitives.
pub use graph::{el, Graph, Node};
/// Rust-native resource registry and resource values.
pub use resource::{Resource, ResourceId, ResourceManager};
/// Instruction types and the runtime wrapper.
pub use runtime::{Instruction, InstructionBatch, NodeId, Runtime};
