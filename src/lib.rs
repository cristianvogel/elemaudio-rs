//! Safe Rust bindings for the Elementary audio runtime.
//!
//! This crate exposes a small wrapper around the native runtime handle,
//! JSON instruction batches, a Rust-native resource manager, and audio
//! processing entrypoints.

mod audio_ring_buffer;
pub mod core;
mod error;
mod ffi;
mod graph;
mod resource;
mod runtime;

pub extern crate self as elemaudio_rs;

/// Lock-free audio transport for producer/consumer playback.
pub use audio_ring_buffer::AudioRingBuffer;
/// Core node utilities mirroring the upstream package surface.
pub use core::{create_node, is_node, resolve, unpack, ElemNode};
/// Expression DSL proc macro for authoring graphs.
pub use elemaudio_rs_macros::el;
/// Error types and helpers used by the public API.
pub use error::{Error, Result};
/// Rust-native graph primitives.
pub use graph::{el, mc, Graph, MountedGraph, MountedNode, Node};
/// Rust-native resource registry and resource values.
pub use resource::{AudioBuffer, Resource, ResourceId, ResourceManager};
/// Instruction types and the runtime wrapper.
pub use runtime::{Instruction, InstructionBatch, NodeId, Runtime};
