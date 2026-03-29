//! Raw FFI declarations for the Elementary runtime bridge.
//!
//! The safe wrapper in `runtime` is the only code that should call these
//! functions directly.

use std::ffi::c_void;
use std::os::raw::{c_char, c_int};

/// Opaque native runtime handle.
pub enum ElementaryRuntimeHandle {}

/// Callback used by native garbage collection traversal.
pub type GcCallback = Option<unsafe extern "C" fn(node_id: i32, user_data: *mut c_void)>;

unsafe extern "C" {
    /// Constructs a native runtime instance.
    pub fn elementary_runtime_new(
        sample_rate: f64,
        block_size: c_int,
    ) -> *mut ElementaryRuntimeHandle;
    /// Frees a native runtime instance.
    pub fn elementary_runtime_free(handle: *mut ElementaryRuntimeHandle);
    /// Applies a serialized instruction batch to the runtime.
    pub fn elementary_runtime_apply_instructions(
        handle: *mut ElementaryRuntimeHandle,
        json: *const c_char,
    ) -> c_int;
    /// Resets runtime state.
    pub fn elementary_runtime_reset(handle: *mut ElementaryRuntimeHandle);
    /// Sets the current time in samples.
    pub fn elementary_runtime_set_current_time_samples(
        handle: *mut ElementaryRuntimeHandle,
        sample_time: i64,
    );
    /// Sets the current time in milliseconds.
    pub fn elementary_runtime_set_current_time_ms(
        handle: *mut ElementaryRuntimeHandle,
        sample_time_ms: f64,
    );
    /// Adds a shared `f32` resource to the runtime.
    pub fn elementary_runtime_add_shared_resource_f32(
        handle: *mut ElementaryRuntimeHandle,
        name: *const c_char,
        data: *const f32,
        num_samples: usize,
    ) -> c_int;
    /// Processes one audio block.
    pub fn elementary_runtime_process(
        handle: *mut ElementaryRuntimeHandle,
        input_channel_data: *const *const f64,
        num_input_channels: usize,
        output_channel_data: *mut *mut f64,
        num_output_channels: usize,
        num_samples: usize,
    ) -> c_int;
    /// Triggers runtime garbage collection and reports live node ids.
    pub fn elementary_runtime_gc(
        handle: *mut ElementaryRuntimeHandle,
        callback: GcCallback,
        user_data: *mut c_void,
    );
}
