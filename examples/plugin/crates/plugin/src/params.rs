//! CLAP parameter declarations, state save/load, and parameter relay.

use std::ffi::CStr;
use std::fmt::Write as _;
use std::io::Write as _;
use std::sync::Arc;

use clack_extensions::params::{
    ParamDisplayWriter, ParamInfo, ParamInfoFlags, ParamInfoWriter, PluginAudioProcessorParams,
    PluginMainThreadParams,
};
use clack_extensions::state::PluginStateImpl;
use clack_plugin::events::event_types::ParamValueEvent;
use clack_plugin::events::spaces::CoreEventSpace;
use clack_plugin::events::UnknownEvent;
use clack_plugin::prelude::*;
use clack_plugin::stream::{InputStream, OutputStream};
use clack_plugin::utils::Cookie;

use stride_delay_dsp::{
    clamp_delay_ms, clamp_feedback, clamp_mix, clamp_transition_ms, DEFAULT_DELAY_MS,
    DEFAULT_FEEDBACK, DEFAULT_MIX, DEFAULT_TRANSITION_MS, DELAY_MS_MAX, DELAY_MS_MIN, FEEDBACK_MAX,
    FEEDBACK_MIN, MIX_MAX, MIX_MIN, PARAM_ID_DELAY_MS, PARAM_ID_FEEDBACK, PARAM_ID_MIX,
    PARAM_ID_TRANSITION_MS, TRANSITION_MS_MAX, TRANSITION_MS_MIN,
};

use crate::plugin::{AudioProcessor, MainThread};
use crate::shared::{ParameterUpdate, SharedParameterStore, UpdateSource};

// ---- CLAP parameter IDs -----------------------------------------------

pub const DELAY_MS_PARAM_ID: ClapId = ClapId::new(1);
pub const FEEDBACK_PARAM_ID: ClapId = ClapId::new(2);
pub const TRANSITION_MS_PARAM_ID: ClapId = ClapId::new(3);
pub const MIX_PARAM_ID: ClapId = ClapId::new(4);

// ---- Shared wrapper ---------------------------------------------------

pub struct PluginParamsShared {
    store: SharedParameterStore,
    request_callback: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl PluginParamsShared {
    pub fn new(request_callback: Option<Arc<dyn Fn() + Send + Sync>>) -> Self {
        Self {
            store: SharedParameterStore::default(),
            request_callback,
        }
    }

    pub fn delay_ms(&self) -> f32 {
        self.store.delay_ms()
    }
    pub fn feedback(&self) -> f32 {
        self.store.feedback()
    }
    pub fn transition_ms(&self) -> f32 {
        self.store.transition_ms()
    }
    pub fn mix(&self) -> f32 {
        self.store.mix()
    }

    pub fn set_parameter_from_ui(&self, parameter_id: &str, value: f32, sequence: u64) -> bool {
        self.store
            .set_parameter_from_ui(parameter_id, value, sequence)
    }

    pub fn set_from_host(&self, state: &PluginParamsLocal) {
        self.store.set_all_from_host(
            state.delay_ms,
            state.feedback,
            state.transition_ms,
            state.mix,
        );
    }

    pub fn source(&self) -> UpdateSource {
        self.store.source()
    }
    pub fn sequence(&self) -> u64 {
        self.store.sequence()
    }

    pub fn snapshot_all(&self) -> Vec<ParameterUpdate> {
        self.store.snapshot_all()
    }

    pub fn request_host_callback(&self) {
        if let Some(cb) = &self.request_callback {
            cb();
        }
    }
}

impl Default for PluginParamsShared {
    fn default() -> Self {
        Self::new(None)
    }
}

// ---- Local (per-thread) copy ------------------------------------------

#[derive(Debug, Clone)]
pub struct PluginParamsLocal {
    pub(crate) delay_ms: f32,
    pub(crate) feedback: f32,
    pub(crate) transition_ms: f32,
    pub(crate) mix: f32,
    source: UpdateSource,
    sequence: u64,
}

impl PluginParamsLocal {
    pub fn new(shared: &PluginParamsShared) -> Self {
        Self {
            delay_ms: shared.delay_ms(),
            feedback: shared.feedback(),
            transition_ms: shared.transition_ms(),
            mix: shared.mix(),
            source: shared.source(),
            sequence: shared.sequence(),
        }
    }

    pub fn delay_ms(&self) -> f32 {
        self.delay_ms
    }
    pub fn feedback(&self) -> f32 {
        self.feedback
    }
    pub fn transition_ms(&self) -> f32 {
        self.transition_ms
    }
    pub fn mix(&self) -> f32 {
        self.mix
    }

    pub fn set_from_param_id(&mut self, param_id: ClapId, value: f32) {
        if param_id == DELAY_MS_PARAM_ID {
            self.delay_ms = clamp_delay_ms(value);
        } else if param_id == FEEDBACK_PARAM_ID {
            self.feedback = clamp_feedback(value);
        } else if param_id == TRANSITION_MS_PARAM_ID {
            self.transition_ms = clamp_transition_ms(value);
        } else if param_id == MIX_PARAM_ID {
            self.mix = clamp_mix(value);
        }
    }

    pub fn fetch_updates(&mut self, shared: &PluginParamsShared) -> bool {
        let latest = Self {
            delay_ms: shared.delay_ms(),
            feedback: shared.feedback(),
            transition_ms: shared.transition_ms(),
            mix: shared.mix(),
            source: shared.source(),
            sequence: shared.sequence(),
        };
        let changed = (latest.delay_ms - self.delay_ms).abs() > f32::EPSILON
            || (latest.feedback - self.feedback).abs() > f32::EPSILON
            || (latest.transition_ms - self.transition_ms).abs() > f32::EPSILON
            || (latest.mix - self.mix).abs() > f32::EPSILON
            || latest.sequence != self.sequence;
        if changed {
            *self = latest;
        }
        changed
    }

    pub fn push_updates(&mut self, shared: &PluginParamsShared) -> bool {
        let changed = (shared.delay_ms() - self.delay_ms).abs() > f32::EPSILON
            || (shared.feedback() - self.feedback).abs() > f32::EPSILON
            || (shared.transition_ms() - self.transition_ms).abs() > f32::EPSILON
            || (shared.mix() - self.mix).abs() > f32::EPSILON;
        if changed {
            shared.set_from_host(self);
            self.source = UpdateSource::Host;
            self.sequence = shared.sequence();
        }
        changed
    }

    pub fn handle_event(&mut self, event: &UnknownEvent) {
        if let Some(CoreEventSpace::ParamValue(event)) = event.as_core_event() {
            if let Some(param_id) = event.param_id() {
                self.set_from_param_id(param_id, event.value() as f32);
            }
        }
    }

    pub fn send_param_events(&self, output_events: &mut OutputEvents) {
        for (param_id, value) in [
            (DELAY_MS_PARAM_ID, self.delay_ms as f64),
            (FEEDBACK_PARAM_ID, self.feedback as f64),
            (TRANSITION_MS_PARAM_ID, self.transition_ms as f64),
            (MIX_PARAM_ID, self.mix as f64),
        ] {
            let event =
                ParamValueEvent::new(0, param_id, Pckn::match_all(), value, Cookie::empty());
            let _ = output_events.try_push(event);
        }
    }

    pub fn updates(&self) -> Vec<ParameterUpdate> {
        [
            (PARAM_ID_DELAY_MS, self.delay_ms),
            (PARAM_ID_FEEDBACK, self.feedback),
            (PARAM_ID_TRANSITION_MS, self.transition_ms),
            (PARAM_ID_MIX, self.mix),
        ]
        .iter()
        .map(|(id, value)| ParameterUpdate {
            parameter_id: (*id).to_string(),
            value: *value,
            source: self.source,
            sequence: self.sequence,
        })
        .collect()
    }
}

// ---- CLAP PluginMainThreadParams --------------------------------------

impl PluginMainThreadParams for MainThread<'_> {
    fn count(&mut self) -> u32 {
        4
    }

    fn get_info(&mut self, param_index: u32, info: &mut ParamInfoWriter) {
        match param_index {
            0 => info.set(&ParamInfo {
                id: DELAY_MS_PARAM_ID,
                flags: ParamInfoFlags::IS_AUTOMATABLE,
                cookie: Default::default(),
                name: b"Delay Time",
                module: b"",
                min_value: DELAY_MS_MIN as f64,
                max_value: DELAY_MS_MAX as f64,
                default_value: DEFAULT_DELAY_MS as f64,
            }),
            1 => info.set(&ParamInfo {
                id: FEEDBACK_PARAM_ID,
                flags: ParamInfoFlags::IS_AUTOMATABLE,
                cookie: Default::default(),
                name: b"Feedback",
                module: b"",
                min_value: FEEDBACK_MIN as f64,
                max_value: FEEDBACK_MAX as f64,
                default_value: DEFAULT_FEEDBACK as f64,
            }),
            2 => info.set(&ParamInfo {
                id: TRANSITION_MS_PARAM_ID,
                flags: ParamInfoFlags::IS_AUTOMATABLE,
                cookie: Default::default(),
                name: b"Transition",
                module: b"",
                min_value: TRANSITION_MS_MIN as f64,
                max_value: TRANSITION_MS_MAX as f64,
                default_value: DEFAULT_TRANSITION_MS as f64,
            }),
            3 => info.set(&ParamInfo {
                id: MIX_PARAM_ID,
                flags: ParamInfoFlags::IS_AUTOMATABLE,
                cookie: Default::default(),
                name: b"Mix",
                module: b"",
                min_value: MIX_MIN as f64,
                max_value: MIX_MAX as f64,
                default_value: DEFAULT_MIX as f64,
            }),
            _ => {}
        }
    }

    fn get_value(&mut self, param_id: ClapId) -> Option<f64> {
        self.params.fetch_updates(&self.shared.params);
        if param_id == DELAY_MS_PARAM_ID {
            Some(self.params.delay_ms() as f64)
        } else if param_id == FEEDBACK_PARAM_ID {
            Some(self.params.feedback() as f64)
        } else if param_id == TRANSITION_MS_PARAM_ID {
            Some(self.params.transition_ms() as f64)
        } else if param_id == MIX_PARAM_ID {
            Some(self.params.mix() as f64)
        } else {
            None
        }
    }

    fn value_to_text(
        &mut self,
        param_id: ClapId,
        value: f64,
        writer: &mut ParamDisplayWriter,
    ) -> std::fmt::Result {
        if param_id == DELAY_MS_PARAM_ID {
            write!(writer, "{value:.0} ms")
        } else if param_id == FEEDBACK_PARAM_ID {
            write!(writer, "{:.0} %", value * 100.0)
        } else if param_id == TRANSITION_MS_PARAM_ID {
            write!(writer, "{value:.0} ms")
        } else if param_id == MIX_PARAM_ID {
            write!(writer, "{:.0} %", value * 100.0)
        } else {
            Err(std::fmt::Error)
        }
    }

    fn text_to_value(&mut self, param_id: ClapId, text: &CStr) -> Option<f64> {
        let text = text.to_str().ok()?;
        let stripped = text
            .strip_suffix('%')
            .or_else(|| text.strip_suffix("ms"))
            .unwrap_or(text)
            .trim();
        let numeric = stripped.parse::<f64>().ok()?;
        if param_id == DELAY_MS_PARAM_ID {
            Some(numeric.clamp(DELAY_MS_MIN as f64, DELAY_MS_MAX as f64))
        } else if param_id == FEEDBACK_PARAM_ID {
            let v = if text.contains('%') {
                numeric / 100.0
            } else {
                numeric
            };
            Some(v.clamp(FEEDBACK_MIN as f64, FEEDBACK_MAX as f64))
        } else if param_id == TRANSITION_MS_PARAM_ID {
            Some(numeric.clamp(TRANSITION_MS_MIN as f64, TRANSITION_MS_MAX as f64))
        } else if param_id == MIX_PARAM_ID {
            let v = if text.contains('%') {
                numeric / 100.0
            } else {
                numeric
            };
            Some(v.clamp(MIX_MIN as f64, MIX_MAX as f64))
        } else {
            None
        }
    }

    fn flush(&mut self, input: &InputEvents, output: &mut OutputEvents) {
        let before = (
            self.params.delay_ms(),
            self.params.feedback(),
            self.params.transition_ms(),
            self.params.mix(),
        );
        for event in input {
            self.params.handle_event(event);
        }
        let after = (
            self.params.delay_ms(),
            self.params.feedback(),
            self.params.transition_ms(),
            self.params.mix(),
        );
        if before != after {
            self.params.push_updates(&self.shared.params);
            self.params.send_param_events(output);
        }
    }
}

impl PluginAudioProcessorParams for AudioProcessor<'_> {
    fn flush(&mut self, input: &InputEvents, output: &mut OutputEvents) {
        let before = (
            self.params.delay_ms(),
            self.params.feedback(),
            self.params.transition_ms(),
            self.params.mix(),
        );
        for event in input {
            self.params.handle_event(event);
        }
        let after = (
            self.params.delay_ms(),
            self.params.feedback(),
            self.params.transition_ms(),
            self.params.mix(),
        );
        if before != after {
            self.params.push_updates(&self.shared.params);
            self.params.send_param_events(output);
        }
    }
}

// ---- State save/load --------------------------------------------------

impl PluginStateImpl for MainThread<'_> {
    fn save(&mut self, output: &mut OutputStream) -> Result<(), PluginError> {
        self.params.fetch_updates(&self.shared.params);
        let payload = serde_json::json!({
            PARAM_ID_DELAY_MS: self.params.delay_ms(),
            PARAM_ID_FEEDBACK: self.params.feedback(),
            PARAM_ID_TRANSITION_MS: self.params.transition_ms(),
            PARAM_ID_MIX: self.params.mix(),
        })
        .to_string();
        output.write_all(payload.as_bytes())?;
        Ok(())
    }

    fn load(&mut self, input: &mut InputStream) -> Result<(), PluginError> {
        let snap: serde_json::Value = serde_json::from_reader(input)
            .map_err(|_| PluginError::Message("failed to deserialize state"))?;
        self.params.delay_ms = clamp_delay_ms(
            snap.get(PARAM_ID_DELAY_MS)
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_DELAY_MS as f64) as f32,
        );
        self.params.feedback = clamp_feedback(
            snap.get(PARAM_ID_FEEDBACK)
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_FEEDBACK as f64) as f32,
        );
        self.params.transition_ms = clamp_transition_ms(
            snap.get(PARAM_ID_TRANSITION_MS)
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_TRANSITION_MS as f64) as f32,
        );
        self.params.mix = clamp_mix(
            snap.get(PARAM_ID_MIX)
                .and_then(|v| v.as_f64())
                .unwrap_or(DEFAULT_MIX as f64) as f32,
        );
        self.params.push_updates(&self.shared.params);
        Ok(())
    }
}
