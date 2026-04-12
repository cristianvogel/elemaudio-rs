//! Shared parameter types and lock-free atomic store.
//!
//! Inlined from nel-x-audio-dev-shared for a self-contained example.

use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};

use stride_delay_dsp::{
    clamp_delay_ms, clamp_feedback, clamp_mix, clamp_transition_ms, DspParameters,
    PARAM_ID_DELAY_MS, PARAM_ID_FEEDBACK, PARAM_ID_MIX, PARAM_ID_TRANSITION_MS,
};

const SOURCE_UI: u8 = 1;
const SOURCE_HOST: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateSource {
    Ui,
    Host,
}

impl serde::Serialize for UpdateSource {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Ui => serializer.serialize_str("ui"),
            Self::Host => serializer.serialize_str("host"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParameterUpdate {
    pub parameter_id: String,
    pub value: f32,
    pub source: UpdateSource,
    pub sequence: u64,
}

#[derive(Debug)]
pub struct SharedParameterStore {
    delay_ms: AtomicU32,
    feedback: AtomicU32,
    transition_ms: AtomicU32,
    mix: AtomicU32,
    source: AtomicU8,
    sequence: AtomicU64,
    host_sequence: AtomicU64,
}

impl SharedParameterStore {
    pub fn delay_ms(&self) -> f32 {
        f32::from_bits(self.delay_ms.load(Ordering::Relaxed))
    }
    pub fn feedback(&self) -> f32 {
        f32::from_bits(self.feedback.load(Ordering::Relaxed))
    }
    pub fn transition_ms(&self) -> f32 {
        f32::from_bits(self.transition_ms.load(Ordering::Relaxed))
    }
    pub fn mix(&self) -> f32 {
        f32::from_bits(self.mix.load(Ordering::Relaxed))
    }

    pub fn source(&self) -> UpdateSource {
        match self.source.load(Ordering::Relaxed) {
            SOURCE_UI => UpdateSource::Ui,
            _ => UpdateSource::Host,
        }
    }

    pub fn sequence(&self) -> u64 {
        self.sequence.load(Ordering::Relaxed)
    }

    pub fn to_dsp_parameters(&self) -> DspParameters {
        DspParameters {
            delay_ms: self.delay_ms(),
            feedback: self.feedback(),
            transition_ms: self.transition_ms(),
            mix: self.mix(),
        }
    }

    pub fn set_parameter_from_ui(&self, parameter_id: &str, value: f32, sequence: u64) -> bool {
        let accepted = self.set_parameter_value(parameter_id, value);
        if accepted {
            self.source.store(SOURCE_UI, Ordering::Relaxed);
            self.sequence.store(sequence, Ordering::Relaxed);
        }
        accepted
    }

    pub fn set_parameter_from_host(&self, parameter_id: &str, value: f32) -> bool {
        let accepted = self.set_parameter_value(parameter_id, value);
        if accepted {
            self.bump_host_sequence();
        }
        accepted
    }

    pub fn set_all_from_host(
        &self,
        delay_ms: f32,
        feedback: f32,
        transition_ms: f32,
        mix: f32,
    ) -> u64 {
        self.delay_ms
            .store(clamp_delay_ms(delay_ms).to_bits(), Ordering::Relaxed);
        self.feedback
            .store(clamp_feedback(feedback).to_bits(), Ordering::Relaxed);
        self.transition_ms.store(
            clamp_transition_ms(transition_ms).to_bits(),
            Ordering::Relaxed,
        );
        self.mix.store(clamp_mix(mix).to_bits(), Ordering::Relaxed);
        self.bump_host_sequence()
    }

    pub fn snapshot_all(&self) -> Vec<ParameterUpdate> {
        [
            PARAM_ID_DELAY_MS,
            PARAM_ID_FEEDBACK,
            PARAM_ID_TRANSITION_MS,
            PARAM_ID_MIX,
        ]
        .iter()
        .filter_map(|id| self.snapshot(id))
        .collect()
    }

    pub fn snapshot(&self, parameter_id: &str) -> Option<ParameterUpdate> {
        let value = self.parameter_value(parameter_id)?;
        Some(ParameterUpdate {
            parameter_id: parameter_id.to_string(),
            value,
            source: self.source(),
            sequence: self.sequence(),
        })
    }

    pub fn parameter_value(&self, parameter_id: &str) -> Option<f32> {
        match parameter_id {
            PARAM_ID_DELAY_MS => Some(self.delay_ms()),
            PARAM_ID_FEEDBACK => Some(self.feedback()),
            PARAM_ID_TRANSITION_MS => Some(self.transition_ms()),
            PARAM_ID_MIX => Some(self.mix()),
            _ => None,
        }
    }

    fn set_parameter_value(&self, parameter_id: &str, value: f32) -> bool {
        match parameter_id {
            PARAM_ID_DELAY_MS => {
                self.delay_ms
                    .store(clamp_delay_ms(value).to_bits(), Ordering::Relaxed);
                true
            }
            PARAM_ID_FEEDBACK => {
                self.feedback
                    .store(clamp_feedback(value).to_bits(), Ordering::Relaxed);
                true
            }
            PARAM_ID_TRANSITION_MS => {
                self.transition_ms
                    .store(clamp_transition_ms(value).to_bits(), Ordering::Relaxed);
                true
            }
            PARAM_ID_MIX => {
                self.mix
                    .store(clamp_mix(value).to_bits(), Ordering::Relaxed);
                true
            }
            _ => false,
        }
    }

    fn bump_host_sequence(&self) -> u64 {
        self.source.store(SOURCE_HOST, Ordering::Relaxed);
        let sequence = self.host_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.sequence.store(sequence, Ordering::Relaxed);
        sequence
    }
}

impl Default for SharedParameterStore {
    fn default() -> Self {
        let defaults = DspParameters::default();
        Self {
            delay_ms: AtomicU32::new(defaults.delay_ms.to_bits()),
            feedback: AtomicU32::new(defaults.feedback.to_bits()),
            transition_ms: AtomicU32::new(defaults.transition_ms.to_bits()),
            mix: AtomicU32::new(defaults.mix.to_bits()),
            source: AtomicU8::new(SOURCE_HOST),
            sequence: AtomicU64::new(0),
            host_sequence: AtomicU64::new(0),
        }
    }
}
