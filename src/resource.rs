//! Rust-native resource registry for Elementary-style integrations.
//!
//! This module keeps resource ownership in Rust so hosts can store file-backed
//! buffers, decoded media, ring buffers, or custom shared state behind a small
//! and safe API.

use crate::error::{Error, Result};
use std::any::Any;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fmt::{Debug, Formatter};
use std::sync::Arc;

/// Identifier used to address a resource.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ResourceId(String);

impl ResourceId {
    /// Creates a new resource identifier.
    pub fn new(id: impl Into<String>) -> Result<Self> {
        let id = id.into();

        if id.trim().is_empty() {
            return Err(Error::InvalidArgument("resource id cannot be empty"));
        }

        Ok(Self(id))
    }

    /// Returns the identifier as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<ResourceId> for String {
    fn from(value: ResourceId) -> Self {
        value.0
    }
}

impl AsRef<str> for ResourceId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

/// A resource stored in the manager.
#[derive(Clone)]
pub enum Resource {
    /// Shared decoded audio buffer.
    Audio(AudioBuffer),
    /// Shared floating-point samples.
    F32(Arc<[f32]>),
    /// Shared double-precision samples.
    F64(Arc<[f64]>),
    /// Raw shared bytes.
    Bytes(Arc<[u8]>),
    /// UTF-8 text payload.
    Text(Arc<str>),
    /// Any custom Rust type wrapped in `Arc`.
    Any(Arc<dyn Any + Send + Sync>),
}

impl Debug for Resource {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Audio(buffer) => f
                .debug_struct("Audio")
                .field("sample_rate", &buffer.sample_rate)
                .field("samples", &buffer.samples.len())
                .finish(),
            Self::F32(data) => f.debug_tuple("F32").field(&data.len()).finish(),
            Self::F64(data) => f.debug_tuple("F64").field(&data.len()).finish(),
            Self::Bytes(data) => f.debug_tuple("Bytes").field(&data.len()).finish(),
            Self::Text(data) => f.debug_tuple("Text").field(&data.len()).finish(),
            Self::Any(_) => f.write_str("Any(<opaque>)"),
        }
    }
}

impl Resource {
    /// Wraps a `f32` slice in an owned shared resource.
    pub fn f32(data: impl Into<Arc<[f32]>>) -> Self {
        Self::F32(data.into())
    }

    /// Wraps a decoded audio buffer.
    pub fn audio(buffer: AudioBuffer) -> Self {
        Self::Audio(buffer)
    }

    /// Wraps a `f64` slice in an owned shared resource.
    pub fn f64(data: impl Into<Arc<[f64]>>) -> Self {
        Self::F64(data.into())
    }

    /// Wraps a byte slice in an owned shared resource.
    pub fn bytes(data: impl Into<Arc<[u8]>>) -> Self {
        Self::Bytes(data.into())
    }

    /// Wraps text in an owned shared resource.
    pub fn text(data: impl Into<Arc<str>>) -> Self {
        Self::Text(data.into())
    }

    /// Wraps any `Send + Sync + 'static` Rust value in an opaque resource.
    pub fn custom<T>(value: T) -> Self
    where
        T: Any + Send + Sync,
    {
        Self::Any(Arc::new(value))
    }

    /// Wraps an already shared Rust value in an opaque resource.
    pub fn shared<T>(value: Arc<T>) -> Self
    where
        T: Any + Send + Sync,
    {
        Self::Any(value)
    }

    /// Wraps a boxed Rust value in an opaque resource.
    pub fn boxed<T>(value: Box<T>) -> Self
    where
        T: Any + Send + Sync,
    {
        let value: Arc<T> = Arc::from(value);
        Self::Any(value)
    }

    /// Returns the resource kind for diagnostics.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Audio(_) => "audio",
            Self::F32(_) => "f32",
            Self::F64(_) => "f64",
            Self::Bytes(_) => "bytes",
            Self::Text(_) => "text",
            Self::Any(_) => "any",
        }
    }

    /// Attempts to view the resource as shared `f32` samples.
    pub fn as_f32(&self) -> Option<&[f32]> {
        match self {
            Self::F32(data) => Some(data.as_ref()),
            _ => None,
        }
    }

    /// Attempts to view the resource as a decoded audio buffer.
    pub fn as_audio(&self) -> Option<&AudioBuffer> {
        match self {
            Self::Audio(buffer) => Some(buffer),
            _ => None,
        }
    }

    /// Attempts to view the resource as shared `f64` samples.
    pub fn as_f64(&self) -> Option<&[f64]> {
        match self {
            Self::F64(data) => Some(data.as_ref()),
            _ => None,
        }
    }

    /// Attempts to view the resource as bytes.
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Bytes(data) => Some(data.as_ref()),
            _ => None,
        }
    }

    /// Attempts to view the resource as text.
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(data) => Some(data.as_ref()),
            _ => None,
        }
    }

    /// Attempts to downcast an opaque resource to a concrete Rust type.
    pub fn downcast<T>(&self) -> Option<Arc<T>>
    where
        T: Any + Send + Sync,
    {
        match self {
            Self::Any(value) => value.clone().downcast::<T>().ok(),
            _ => None,
        }
    }
}

/// Decoded audio stored in Rust-owned memory.
#[derive(Clone, Debug)]
pub struct AudioBuffer {
    /// Interleaved or mono PCM data.
    pub samples: Arc<[f32]>,
    /// Source sample rate in Hz.
    pub sample_rate: u32,
    /// Number of channels in `samples`.
    pub channels: u16,
}

impl AudioBuffer {
    /// Creates a mono audio buffer.
    pub fn mono(samples: impl Into<Arc<[f32]>>, sample_rate: u32) -> Self {
        Self {
            samples: samples.into(),
            sample_rate,
            channels: 1,
        }
    }

    /// Returns the number of frames in the buffer.
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels as usize
    }
}

/// Simple resource registry with safe add, replace, remove, and rename operations.
#[derive(Debug, Clone, Default)]
pub struct ResourceManager {
    resources: HashMap<ResourceId, Resource>,
}

impl ResourceManager {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    fn normalize_id(id: impl AsRef<str>) -> Result<ResourceId> {
        ResourceId::new(id.as_ref())
    }

    /// Returns the number of registered resources.
    pub fn len(&self) -> usize {
        self.resources.len()
    }

    /// Returns `true` when the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.resources.is_empty()
    }

    /// Returns a resource by id.
    pub fn get(&self, id: impl AsRef<str>) -> Option<&Resource> {
        let id = Self::normalize_id(id).ok()?;
        self.resources.get(&id)
    }

    /// Returns a cloned resource by id.
    pub fn get_cloned(&self, id: impl AsRef<str>) -> Option<Resource> {
        self.get(id).cloned()
    }

    /// Returns a shared `f32` slice by id.
    pub fn get_f32(&self, id: impl AsRef<str>) -> Option<&[f32]> {
        self.get(id)?.as_f32()
    }

    /// Returns a shared `f64` slice by id.
    pub fn get_f64(&self, id: impl AsRef<str>) -> Option<&[f64]> {
        self.get(id)?.as_f64()
    }

    /// Returns raw bytes by id.
    pub fn get_bytes(&self, id: impl AsRef<str>) -> Option<&[u8]> {
        self.get(id)?.as_bytes()
    }

    /// Returns text by id.
    pub fn get_text(&self, id: impl AsRef<str>) -> Option<&str> {
        self.get(id)?.as_text()
    }

    /// Attempts to downcast a custom resource to a concrete Rust type.
    pub fn get_custom<T>(&self, id: impl AsRef<str>) -> Option<Arc<T>>
    where
        T: Any + Send + Sync,
    {
        self.get(id)?.downcast::<T>()
    }

    /// Returns a shared `f32` slice or a type mismatch error.
    pub fn require_f32(&self, id: impl AsRef<str>) -> Result<&[f32]> {
        let id = Self::normalize_id(id)?;
        let resource = self
            .resources
            .get(&id)
            .ok_or_else(|| Error::ResourceNotFound(id.as_str().to_string()))?;

        resource
            .as_f32()
            .ok_or_else(|| Error::ResourceTypeMismatch {
                id: id.as_str().to_string(),
                expected: "f32",
                actual: resource.kind(),
            })
    }

    /// Returns `true` if a resource with the given id exists.
    pub fn contains(&self, id: impl AsRef<str>) -> bool {
        self.get(id).is_some()
    }

    /// Inserts or replaces a resource.
    pub fn insert(&mut self, id: impl AsRef<str>, resource: Resource) -> Result<Option<Resource>> {
        let id = Self::normalize_id(id)?;
        Ok(self.resources.insert(id, resource))
    }

    /// Adds a resource if the id is unused.
    pub fn add(&mut self, id: impl AsRef<str>, resource: Resource) -> Result<()> {
        let id = Self::normalize_id(id)?;

        if self.resources.contains_key(&id) {
            return Err(Error::ResourceExists(id.as_str().to_string()));
        }

        self.resources.insert(id, resource);
        Ok(())
    }

    /// Replaces an existing resource.
    pub fn replace(&mut self, id: impl AsRef<str>, resource: Resource) -> Result<Resource> {
        let id = Self::normalize_id(id)?;

        if !self.resources.contains_key(&id) {
            return Err(Error::ResourceNotFound(id.as_str().to_string()));
        }

        Ok(self
            .resources
            .insert(id, resource)
            .expect("resource existed before replace"))
    }

    /// Removes a resource from the registry.
    pub fn remove(&mut self, id: impl AsRef<str>) -> Result<Resource> {
        let id = Self::normalize_id(id)?;

        self.resources
            .remove(&id)
            .ok_or_else(|| Error::ResourceNotFound(id.as_str().to_string()))
    }

    /// Renames a resource identifier without changing the underlying value.
    pub fn rename(&mut self, from: impl AsRef<str>, to: impl AsRef<str>) -> Result<()> {
        let from = Self::normalize_id(from)?;
        let to = Self::normalize_id(to)?;

        if from == to {
            return Ok(());
        }

        if self.resources.contains_key(&to) {
            return Err(Error::ResourceExists(to.as_str().to_string()));
        }

        let resource = self
            .resources
            .remove(&from)
            .ok_or_else(|| Error::ResourceNotFound(from.as_str().to_string()))?;

        self.resources.insert(to, resource);
        Ok(())
    }

    /// Clears the registry.
    pub fn clear(&mut self) {
        self.resources.clear();
    }

    /// Returns an iterator over all registered ids and resources.
    pub fn iter(&self) -> impl Iterator<Item = (&ResourceId, &Resource)> {
        self.resources.iter()
    }

    /// Returns a cloned snapshot of all registered resources.
    pub fn snapshot(&self) -> Vec<(ResourceId, Resource)> {
        self.resources
            .iter()
            .map(|(id, resource)| (id.clone(), resource.clone()))
            .collect()
    }

    /// Removes every resource whose id is not listed in `keep`.
    pub fn prune_except<I, S>(&mut self, keep: I) -> Vec<(ResourceId, Resource)>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let keep: HashSet<String> = keep.into_iter().map(|id| id.as_ref().to_string()).collect();

        let mut removed = Vec::new();
        self.resources.retain(|id, resource| {
            if keep.contains(id.as_str()) {
                true
            } else {
                removed.push((id.clone(), resource.clone()));
                false
            }
        });

        removed
    }
}
