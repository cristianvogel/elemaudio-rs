//! Stride delay DSP graph and parameters for the CLAP plugin example.
//!
//! The graph is authored as a pure `DspGraph` implementation. The
//! framework's `Engine<StrideDelayGraph>` handles mounting, parameter
//! diffing, and runtime delegation.

mod graph_script;
pub use graph_script::StrideDelayGraph;

// ---- Parameter IDs (shared with plugin crate) -------------------------

pub const PARAM_ID_DELAY_MS: &str = "delay_ms";
pub const PARAM_ID_FEEDBACK: &str = "feedback";
pub const PARAM_ID_TRANSITION_MS: &str = "transition_ms";
pub const PARAM_ID_MIX: &str = "mix";

// ---- Defaults and ranges ----------------------------------------------

pub const DEFAULT_DELAY_MS: f32 = 250.0;
pub const DEFAULT_FEEDBACK: f32 = 0.0;
pub const DEFAULT_TRANSITION_MS: f32 = 25.0;
pub const DEFAULT_MIX: f32 = 0.5;

pub const DELAY_MS_MIN: f32 = 10.0;
pub const DELAY_MS_MAX: f32 = 1500.0;
pub const FEEDBACK_MIN: f32 = 0.0;
pub const FEEDBACK_MAX: f32 = 0.95;
pub const TRANSITION_MS_MIN: f32 = 1.0;
pub const TRANSITION_MS_MAX: f32 = 250.0;
pub const MIX_MIN: f32 = 0.0;
pub const MIX_MAX: f32 = 1.0;

pub const MAX_DELAY_MS: f64 = 1500.0;

// ---- Clamping helpers -------------------------------------------------

pub fn clamp_delay_ms(v: f32) -> f32 {
    v.clamp(DELAY_MS_MIN, DELAY_MS_MAX)
}
pub fn clamp_feedback(v: f32) -> f32 {
    v.clamp(FEEDBACK_MIN, FEEDBACK_MAX)
}
pub fn clamp_transition_ms(v: f32) -> f32 {
    v.clamp(TRANSITION_MS_MIN, TRANSITION_MS_MAX)
}
pub fn clamp_mix(v: f32) -> f32 {
    v.clamp(MIX_MIN, MIX_MAX)
}

// ---- DSP parameter snapshot -------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DspParameters {
    pub delay_ms: f32,
    pub feedback: f32,
    pub transition_ms: f32,
    pub mix: f32,
}

impl Default for DspParameters {
    fn default() -> Self {
        Self {
            delay_ms: DEFAULT_DELAY_MS,
            feedback: DEFAULT_FEEDBACK,
            transition_ms: DEFAULT_TRANSITION_MS,
            mix: DEFAULT_MIX,
        }
    }
}

impl DspParameters {
    pub fn clamped(self) -> Self {
        Self {
            delay_ms: clamp_delay_ms(self.delay_ms),
            feedback: clamp_feedback(self.feedback),
            transition_ms: clamp_transition_ms(self.transition_ms),
            mix: clamp_mix(self.mix),
        }
    }
}
