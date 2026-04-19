//! Safe Rust bindings for the Elementary audio runtime.
//!
//! This crate exposes a small wrapper around the native runtime handle,
//! JSON instruction batches, a Rust-native resource manager, and audio
//! processing entrypoints.

mod audio_ring_buffer;
pub mod authoring;
pub mod core;
pub mod engine;
mod error;
mod ffi;
pub mod graph;
pub mod logging;
mod resource;
mod runtime;

/// Lock-free audio transport for producer/consumer playback.
pub use audio_ring_buffer::AudioRingBuffer;
/// Authoring surface with node composition helpers.
pub use authoring::{el, extra, mc};
/// Core node utilities mirroring the upstream package surface.
pub use core::{ElemNode, create_node, is_node, resolve, unpack};
/// Generic DSP engine with auto-diffing parameter updates.
pub use engine::{DspGraph, Engine, KeyedConst, NativeProp};
/// Error types and helpers used by the public API.
pub use error::{Error, Result};
/// Rust-native graph primitives.
pub use graph::{Graph, MountError, MountedGraph, MountedNode, Node};
/// Rust-native resource registry and resource values.
pub use resource::{AudioBuffer, Resource, ResourceId, ResourceManager};
/// Instruction types and the runtime wrapper.
pub use runtime::{Instruction, InstructionBatch, NodeId, Runtime, RuntimeEvent};
