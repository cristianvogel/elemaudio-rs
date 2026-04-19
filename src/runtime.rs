//! Safe wrapper around the Elementary runtime handle and instruction batches.

use crate::error::{Error, Result, describe_return_code};
use crate::ffi;
use crate::resource::{AudioBuffer, Resource, ResourceManager};
use bon::bon;
use serde_json::Value as JsonValue;
use std::cell::Cell;
use std::cell::{Ref, RefCell};
use std::convert::TryFrom;
use std::ffi::{CStr, CString, c_void};
use std::marker::PhantomData;
use std::ptr::NonNull;
use std::sync::Arc;

/// Runtime node identifier used by instruction batches and GC results.
pub type NodeId = i32;

/// Event drained from the runtime's queued event relay.
#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeEvent {
    /// Event type emitted by the runtime node.
    pub kind: String,
    /// Event payload.
    pub event: JsonValue,
}

/// Instruction supported by the current wrapper surface.
#[derive(Debug, Clone)]
pub enum Instruction {
    /// Create a runtime node with the given identifier and type.
    CreateNode {
        /// Node identifier assigned by the caller.
        node_id: NodeId,
        /// Native node type name.
        node_type: String,
    },
    /// Set a property on an existing node.
    SetProperty {
        /// Target node identifier.
        node_id: NodeId,
        /// Property name.
        property: String,
        /// JSON value to assign to the property.
        value: JsonValue,
    },
    /// Append one node as a child of another node.
    AppendChild {
        /// Parent node identifier.
        parent_id: NodeId,
        /// Child node identifier.
        child_id: NodeId,
        /// Output channel index on the child node.
        child_output_channel: i32,
    },
    /// Activate the provided root nodes.
    ActivateRoots {
        /// Root node identifiers.
        roots: Vec<NodeId>,
    },
    /// Commit a pending set of runtime updates.
    CommitUpdates,
}

impl Instruction {
    fn to_json_value(&self) -> JsonValue {
        match self {
            Self::CreateNode { node_id, node_type } => JsonValue::Array(vec![
                JsonValue::from(0),
                JsonValue::from(*node_id),
                JsonValue::from(node_type.clone()),
            ]),
            Self::SetProperty {
                node_id,
                property,
                value,
            } => JsonValue::Array(vec![
                JsonValue::from(3),
                JsonValue::from(*node_id),
                JsonValue::from(property.clone()),
                value.clone(),
            ]),
            Self::AppendChild {
                parent_id,
                child_id,
                child_output_channel,
            } => JsonValue::Array(vec![
                JsonValue::from(2),
                JsonValue::from(*parent_id),
                JsonValue::from(*child_id),
                JsonValue::from(*child_output_channel),
            ]),
            Self::ActivateRoots { roots } => JsonValue::Array(vec![
                JsonValue::from(4),
                JsonValue::Array(roots.iter().copied().map(JsonValue::from).collect()),
            ]),
            Self::CommitUpdates => JsonValue::Array(vec![JsonValue::from(5)]),
        }
    }
}

/// A batch of instructions serialized to the runtime JSON array shape.
#[derive(Debug, Clone, Default)]
pub struct InstructionBatch {
    instructions: Vec<Instruction>,
}

impl InstructionBatch {
    /// Creates an empty instruction batch.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends one instruction to the batch.
    pub fn push(&mut self, instruction: Instruction) {
        self.instructions.push(instruction);
    }

    /// Serializes the batch to the JSON payload expected by the native runtime.
    pub fn to_json_string(&self) -> String {
        let payload = JsonValue::Array(
            self.instructions
                .iter()
                .map(Instruction::to_json_value)
                .collect(),
        );
        serde_json::to_string(&payload).expect("instruction batch serialization is infallible")
    }
}

/// Safe owner for a native runtime handle.
pub struct Runtime {
    handle: NonNull<ffi::ElementaryRuntimeHandle>,
    resources: RefCell<ResourceManager>,
    retired_resources: RefCell<Vec<Resource>>,
    buffer_size: usize,
    _not_send_or_sync: PhantomData<Cell<()>>, // keep Runtime movable but not shareable
}

unsafe impl Send for Runtime {}

#[bon]
impl Runtime {
    /// Starts building a runtime.
    pub fn builder() -> RuntimeConstructBuilder {
        Self::create()
    }

    /// Backward-compatible constructor entrypoint used by examples and tests.
    pub fn new() -> RuntimeConstructBuilder {
        Self::builder()
    }

    /// Creates a runtime for the given sample rate and buffer size.
    #[builder(start_fn(name = create, vis = ""))]
    pub fn construct(sample_rate: f64, buffer_size: usize) -> Result<Self> {
        let block_size = i32::try_from(buffer_size)
            .map_err(|_| Error::InvalidArgument("buffer_size must fit in i32"))?;
        let handle = unsafe { ffi::elementary_runtime_new(sample_rate, block_size) };
        let handle = NonNull::new(handle).ok_or(Error::NullHandle)?;

        Ok(Self {
            handle,
            resources: RefCell::new(ResourceManager::new()),
            retired_resources: RefCell::new(Vec::new()),
            buffer_size,
            _not_send_or_sync: PhantomData,
        })
    }

    /// Applies a serialized batch of instructions to the runtime.
    pub fn apply_instructions(&self, batch: &InstructionBatch) -> Result<()> {
        let json = CString::new(batch.to_json_string())?;
        let code = unsafe {
            ffi::elementary_runtime_apply_instructions(self.handle.as_ptr(), json.as_ptr())
        };

        if code == 0 {
            return Ok(());
        }

        Err(Error::Native {
            operation: "apply_instructions",
            code,
            message: describe_return_code(code).to_string(),
        })
    }

    /// Resets the runtime state.
    pub fn reset(&self) {
        unsafe { ffi::elementary_runtime_reset(self.handle.as_ptr()) }
    }

    /// Sets the current runtime time in samples.
    pub fn set_current_time_samples(&self, sample_time: i64) {
        unsafe {
            ffi::elementary_runtime_set_current_time_samples(self.handle.as_ptr(), sample_time)
        }
    }

    /// Sets the current runtime time in milliseconds.
    pub fn set_current_time_ms(&self, sample_time_ms: f64) {
        unsafe { ffi::elementary_runtime_set_current_time_ms(self.handle.as_ptr(), sample_time_ms) }
    }

    /// Drains queued runtime events collected since the previous call.
    pub fn process_queued_events(&self) -> Result<Vec<RuntimeEvent>> {
        let json_ptr =
            unsafe { ffi::elementary_runtime_process_queued_events_json(self.handle.as_ptr()) };
        if json_ptr.is_null() {
            return Err(Error::Native {
                operation: "process_queued_events",
                code: 7,
                message: describe_return_code(7).to_string(),
            });
        }

        let json = unsafe { CStr::from_ptr(json_ptr) }
            .to_string_lossy()
            .into_owned();

        unsafe { ffi::elementary_string_free(json_ptr) };

        let parsed: JsonValue = serde_json::from_str(&json)?;
        let events = parsed
            .as_array()
            .ok_or(Error::InvalidArgument("queued event payload must be a JSON array"))?
            .iter()
            .map(|entry| {
                let kind = entry
                    .get("type")
                    .and_then(JsonValue::as_str)
                    .ok_or(Error::InvalidArgument("queued event is missing string field 'type'"))?
                    .to_string();
                let event = entry
                    .get("event")
                    .cloned()
                    .ok_or(Error::InvalidArgument("queued event is missing field 'event'"))?;
                Ok(RuntimeEvent { kind, event })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(events)
    }

    /// Returns the current resource registry.
    pub fn resources(&self) -> Ref<'_, ResourceManager> {
        self.resources.borrow()
    }

    /// Adds a resource to the registry if the id is unused.
    pub fn add_resource(&self, name: impl AsRef<str>, resource: Resource) -> Result<()> {
        self.resources.borrow_mut().add(name, resource)
    }

    /// Inserts or replaces a resource in the registry.
    pub fn set_resource(
        &self,
        name: impl AsRef<str>,
        resource: Resource,
    ) -> Result<Option<Resource>> {
        self.resources.borrow_mut().insert(name, resource)
    }

    /// Replaces an existing resource and returns the previous value.
    pub fn replace_resource(&self, name: impl AsRef<str>, resource: Resource) -> Result<Resource> {
        self.resources.borrow_mut().replace(name, resource)
    }

    /// Removes a resource from the registry.
    pub fn remove_resource(&self, name: impl AsRef<str>) -> Result<Resource> {
        let removed = self.resources.borrow_mut().remove(name)?;
        self.retired_resources.borrow_mut().push(removed.clone());
        Ok(removed)
    }

    /// Renames a resource without changing its value.
    pub fn rename_resource(&self, from: impl AsRef<str>, to: impl AsRef<str>) -> Result<()> {
        let resource = self
            .resource(from.as_ref())
            .ok_or_else(|| Error::ResourceNotFound(from.as_ref().to_string()))?;

        self.resources
            .borrow_mut()
            .rename(from.as_ref(), to.as_ref())?;

        if let Resource::F32(samples) = &resource {
            self.add_shared_resource_f32(to.as_ref(), samples.as_ref())?;
        } else if let Resource::Audio(buffer) = &resource {
            self.add_audio_resource(to.as_ref(), buffer.clone())?;
        }

        self.retired_resources.borrow_mut().push(resource);
        Ok(())
    }

    /// Returns a cloned resource by name.
    pub fn resource(&self, name: impl AsRef<str>) -> Option<Resource> {
        self.resources.borrow().get_cloned(name)
    }

    /// Adds a shared `f32` resource by name and mirrors it into the Rust registry.
    pub fn add_shared_resource_f32(&self, name: &str, data: &[f32]) -> Result<()> {
        if name.trim().is_empty() {
            return Err(Error::InvalidArgument("resource id cannot be empty"));
        }

        let resource = Resource::f32(Arc::from(data.to_vec().into_boxed_slice()));
        let resource_name = CString::new(name)?;
        let code = unsafe {
            ffi::elementary_runtime_add_shared_resource_f32(
                self.handle.as_ptr(),
                resource_name.as_ptr(),
                data.as_ptr(),
                data.len(),
            )
        };

        if code == 0 {
            self.resources.borrow_mut().insert(name, resource)?;
            return Ok(());
        }

        Err(Error::Native {
            operation: "add_shared_resource_f32",
            code,
            message: "native runtime rejected the shared resource".to_string(),
        })
    }

    /// Adds a decoded mono audio buffer as a shared resource.
    pub fn add_audio_resource(&self, name: &str, buffer: AudioBuffer) -> Result<()> {
        if buffer.channels == 1 {
            self.add_shared_resource_f32(name, buffer.samples.as_ref())?;
        } else {
            self.add_shared_resource_f32_multi(name, &buffer)?;
        }
        self.resources
            .borrow_mut()
            .insert(name, Resource::audio(buffer))?;
        Ok(())
    }

    /// Adds a decoded multichannel audio buffer as a shared resource.
    fn add_shared_resource_f32_multi(&self, name: &str, buffer: &AudioBuffer) -> Result<()> {
        if name.trim().is_empty() {
            return Err(Error::InvalidArgument("resource id cannot be empty"));
        }

        let channels = buffer.channels as usize;
        let frames = buffer.frames();
        let samples = buffer.samples.as_ref();
        let mut channel_slices: Vec<Vec<f32>> =
            (0..channels).map(|_| Vec::with_capacity(frames)).collect();

        for frame in 0..frames {
            let base = frame * channels;
            for channel in 0..channels {
                channel_slices[channel].push(samples[base + channel]);
            }
        }

        let channel_ptrs: Vec<*const f32> = channel_slices
            .iter()
            .map(|channel| channel.as_ptr())
            .collect();
        let resource_name = CString::new(name)?;
        let code = unsafe {
            ffi::elementary_runtime_add_shared_resource_f32_multi(
                self.handle.as_ptr(),
                resource_name.as_ptr(),
                channel_ptrs.as_ptr(),
                channel_ptrs.len(),
                frames,
            )
        };

        if code == 0 {
            self.resources
                .borrow_mut()
                .insert(name, Resource::audio(buffer.clone()))?;
            return Ok(());
        }

        Err(Error::Native {
            operation: "add_shared_resource_f32_multi",
            code,
            message: "native runtime rejected the shared multichannel resource".to_string(),
        })
    }

    /// Prunes native shared resources and releases retired Rust buffers.
    pub fn prune_shared_resources(&self) {
        unsafe { ffi::elementary_runtime_prune_shared_resources(self.handle.as_ptr()) }
        self.retired_resources.borrow_mut().clear();
    }

    /// Processes one audio block.
    ///
    /// Every input and output channel must have at least `num_samples` samples.
    pub fn process(
        &self,
        num_samples: usize,
        inputs: &[&[f64]],
        outputs: &mut [&mut [f64]],
    ) -> Result<()> {
        if num_samples > self.buffer_size {
            return Err(Error::InvalidArgument(
                "num_samples exceeds the configured buffer_size",
            ));
        }

        if inputs.iter().any(|channel| channel.len() < num_samples) {
            return Err(Error::InvalidArgument(
                "an input channel is shorter than num_samples",
            ));
        }

        if outputs.iter().any(|channel| channel.len() < num_samples) {
            return Err(Error::InvalidArgument(
                "an output channel is shorter than num_samples",
            ));
        }

        let input_ptrs: Vec<*const f64> = inputs.iter().map(|channel| channel.as_ptr()).collect();
        let mut output_ptrs: Vec<*mut f64> = outputs
            .iter_mut()
            .map(|channel| channel.as_mut_ptr())
            .collect();

        let code = unsafe {
            ffi::elementary_runtime_process(
                self.handle.as_ptr(),
                input_ptrs.as_ptr(),
                input_ptrs.len(),
                output_ptrs.as_mut_ptr(),
                output_ptrs.len(),
                num_samples,
            )
        };

        if code == 0 {
            return Ok(());
        }

        Err(Error::Native {
            operation: "process",
            code,
            message: describe_return_code(code).to_string(),
        })
    }

    /// Runs garbage collection and returns the collected node identifiers.
    pub fn gc(&self) -> Vec<NodeId> {
        unsafe extern "C" fn collect(node_id: i32, user_data: *mut c_void) {
            // The pointer comes from `gc` below and remains valid for the duration of the call.
            let ids = unsafe { &mut *(user_data as *mut Vec<NodeId>) };
            ids.push(node_id);
        }

        let mut ids = Vec::new();
        unsafe {
            ffi::elementary_runtime_gc(
                self.handle.as_ptr(),
                Some(collect),
                &mut ids as *mut _ as *mut c_void,
            );
        }
        ids
    }
}

impl Drop for Runtime {
    /// Releases the native runtime handle.
    fn drop(&mut self) {
        unsafe { ffi::elementary_runtime_free(self.handle.as_ptr()) }
    }
}
