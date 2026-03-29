use std::ffi::c_void;
use std::os::raw::{c_char, c_int};

pub enum ElementaryRuntimeHandle {}

pub type GcCallback = Option<unsafe extern "C" fn(node_id: i32, user_data: *mut c_void)>;

unsafe extern "C" {
    pub fn elementary_runtime_new(
        sample_rate: f64,
        block_size: c_int,
    ) -> *mut ElementaryRuntimeHandle;
    pub fn elementary_runtime_free(handle: *mut ElementaryRuntimeHandle);
    pub fn elementary_runtime_apply_instructions(
        handle: *mut ElementaryRuntimeHandle,
        json: *const c_char,
    ) -> c_int;
    pub fn elementary_runtime_reset(handle: *mut ElementaryRuntimeHandle);
    pub fn elementary_runtime_set_current_time_samples(
        handle: *mut ElementaryRuntimeHandle,
        sample_time: i64,
    );
    pub fn elementary_runtime_set_current_time_ms(
        handle: *mut ElementaryRuntimeHandle,
        sample_time_ms: f64,
    );
    pub fn elementary_runtime_add_shared_resource_f32(
        handle: *mut ElementaryRuntimeHandle,
        name: *const c_char,
        data: *const f32,
        num_samples: usize,
    ) -> c_int;
    pub fn elementary_runtime_process(
        handle: *mut ElementaryRuntimeHandle,
        input_channel_data: *const *const f64,
        num_input_channels: usize,
        output_channel_data: *mut *mut f64,
        num_output_channels: usize,
        num_samples: usize,
    ) -> c_int;
    pub fn elementary_runtime_gc(
        handle: *mut ElementaryRuntimeHandle,
        callback: GcCallback,
        user_data: *mut c_void,
    );
}
