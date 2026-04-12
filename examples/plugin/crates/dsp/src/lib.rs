//! Stride delay DSP engine backed by elemaudio-rs.
//!
//! Wraps the Elementary runtime and builds a stereo stride delay graph
//! with keyed nodes for fast-path parameter updates from the plugin host.

use elemaudio_rs::{el, extra, Graph, Instruction, InstructionBatch, MountedGraph, Runtime};
use serde_json::json;

// ---- Parameter IDs (shared with plugin-core and shared crates) --------

pub const PARAM_ID_DELAY_MS: &str = "delay_ms";
pub const PARAM_ID_FEEDBACK: &str = "feedback";
pub const PARAM_ID_TRANSITION_MS: &str = "transition_ms";
pub const PARAM_ID_MIX: &str = "mix";

// ---- Defaults and ranges ----------------------------------------------

pub const DEFAULT_DELAY_MS: f32 = 250.0;
pub const DEFAULT_FEEDBACK: f32 = 0.0;
pub const DEFAULT_TRANSITION_MS: f32 = 60.0;
pub const DEFAULT_MIX: f32 = 0.5;

pub const DELAY_MS_MIN: f32 = 10.0;
pub const DELAY_MS_MAX: f32 = 1200.0;
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

#[derive(Debug, Clone, Copy)]
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

// ---- Engine -----------------------------------------------------------

/// Stride delay engine backed by elemaudio-rs.
///
/// Builds the graph once at activation. Parameter updates use targeted
/// `SetProperty` instructions on the mounted native nodes — no graph
/// rebuild, no new node IDs, matching how the TS `Renderer.render()`
/// reconciler sends property deltas to existing nodes.
pub struct StrideDelayEngine {
    runtime: Runtime,
    /// Mounted graph retaining node handles for future graph queries.
    #[allow(dead_code)]
    mounted: MountedGraph,
    /// Runtime node IDs of the two stridedelay native nodes [L, R].
    delay_ids: [i32; 2],
    /// Runtime node IDs of the four mix const nodes [mix_L_wet, mix_L_dry, mix_R_wet, mix_R_dry].
    /// Wet = the const inside mul(mix, delayed), Dry = the const inside sub(1, mix) → mul(1-mix, dry).
    mix_const_ids: [i32; 4],
    /// Cached params to detect changes.
    current: DspParameters,
}

impl StrideDelayEngine {
    /// Create and activate the engine. Builds the initial stride delay graph.
    pub fn new(sample_rate: f64, buffer_size: usize) -> Result<Self, String> {
        let runtime = Runtime::new()
            .sample_rate(sample_rate)
            .buffer_size(buffer_size)
            .call()
            .map_err(|e| format!("failed to create Elementary runtime: {e}"))?;

        let defaults = DspParameters::default();
        let graph = Self::build_graph(&defaults);
        let mounted = graph.mount();

        // Find the stridedelay and mix const node IDs from the mounted graph.
        let delay_ids = Self::find_delay_ids(&mounted)?;
        let mix_const_ids = Self::find_mix_const_ids(&mounted)?;

        runtime
            .apply_instructions(mounted.batch())
            .map_err(|e| format!("failed to apply initial graph: {e}"))?;

        Ok(Self {
            runtime,
            mounted,
            delay_ids,
            mix_const_ids,
            current: defaults,
        })
    }

    /// Build the stereo stride delay graph.
    ///
    /// Graph topology (per channel):
    /// ```text
    /// in -> stridedelay -> mul(mix_const, _) -+
    ///                                          +-> add -> root
    /// in -> mul(sub(1.0, mix_const), _) ------+
    /// ```
    fn build_graph(p: &DspParameters) -> Graph {
        let mix = el::const_(p.mix as f64);

        let in_l = el::r#in(json!({"channel": 0}), None);
        let delayed_l = extra::stride_delay(
            json!({
                "delayMs": p.delay_ms as f64,
                "maxDelayMs": MAX_DELAY_MS,
                "fb": p.feedback as f64,
                "transitionMs": p.transition_ms as f64,
                "bigLeapMode": "linear",
            }),
            in_l.clone(),
        );
        let out_l = el::select(mix.clone(), delayed_l, in_l);

        let in_r = el::r#in(json!({"channel": 1}), None);
        let delayed_r = extra::stride_delay(
            json!({
                "delayMs": p.delay_ms as f64,
                "maxDelayMs": MAX_DELAY_MS,
                "fb": p.feedback as f64,
                "transitionMs": p.transition_ms as f64,
                "bigLeapMode": "linear",
            }),
            in_r.clone(),
        );
        let out_r = el::select(mix, delayed_r, in_r);

        Graph::new().render(vec![out_l, out_r])
    }

    /// Find the two stridedelay node IDs from the mounted graph.
    fn find_delay_ids(mounted: &MountedGraph) -> Result<[i32; 2], String> {
        let ids: Vec<i32> = mounted
            .all_nodes()
            .filter(|(_, n)| n.kind() == "stridedelay")
            .map(|(_, n)| n.id())
            .collect();
        if ids.len() < 2 {
            return Err(format!("expected 2 stridedelay nodes, found {}", ids.len()));
        }
        Ok([ids[0], ids[1]])
    }

    /// Find the four mix const node IDs.
    ///
    /// `el::select(g, a, b)` expands to `add(mul(g, a), mul(sub(1, g), b))`.
    /// The mix value appears at two const nodes per channel:
    /// - The "wet" const (first child of the first mul)
    /// - The "dry" const (second child of the sub node)
    ///
    /// We identify them by finding const nodes whose value matches the
    /// initial mix value and that are NOT the sub's "1.0" const.
    fn find_mix_const_ids(mounted: &MountedGraph) -> Result<[i32; 4], String> {
        // The graph has several const nodes:
        // - mix value (appears 4 times: wet_L, dry_L, wet_R, dry_R)
        // - 1.0 (appears 2 times: in sub(1.0, mix) for L and R)
        // We need all 4 mix consts. They are the ones that are NOT value=1.0.
        // At init, mix=0.5, so any const with value != 1.0 is a mix const.
        //
        // However this heuristic is fragile. Instead, use structural paths.
        // The select expansion for channel 0 has structure:
        //   root[0] -> add -> mul[0] -> const (mix wet)  [path: 0, 0, 0]
        //                  -> mul[1] -> sub -> const(1.0) [path: 0, 1, 0, 0]
        //                            -> sub -> const(mix) [path: 0, 1, 0, 1]
        // For channel 1, same structure offset by channel.
        //
        // Paths from mount: [channel, child_in_add, child_in_mul_or_sub, ...]
        // Wet L = [0, 0, 0], Dry L = [0, 1, 0, 1]
        // Wet R = [1, 0, 0], Dry R = [1, 1, 0, 1]

        let wet_l = mounted
            .node_at(&[0, 0, 0])
            .ok_or("missing wet_l const")?
            .id();
        let dry_l = mounted
            .node_at(&[0, 1, 0, 1])
            .ok_or("missing dry_l const")?
            .id();
        let wet_r = mounted
            .node_at(&[1, 0, 0])
            .ok_or("missing wet_r const")?
            .id();
        let dry_r = mounted
            .node_at(&[1, 1, 0, 1])
            .ok_or("missing dry_r const")?
            .id();

        Ok([wet_l, dry_l, wet_r, dry_r])
    }

    /// Update parameters via targeted SetProperty instructions.
    pub fn set_params(&mut self, params: DspParameters) {
        let params = params.clamped();

        let delay_changed = (params.delay_ms - self.current.delay_ms).abs() > f32::EPSILON
            || (params.feedback - self.current.feedback).abs() > f32::EPSILON
            || (params.transition_ms - self.current.transition_ms).abs() > f32::EPSILON;

        let mix_changed = (params.mix - self.current.mix).abs() > f32::EPSILON;

        if !delay_changed && !mix_changed {
            return;
        }

        let mut batch = InstructionBatch::new();

        if delay_changed {
            // Update both stridedelay native nodes via SetProperty.
            for &id in &self.delay_ids {
                batch.push(Instruction::SetProperty {
                    node_id: id,
                    property: "delayMs".to_string(),
                    value: json!(params.delay_ms as f64),
                });
                batch.push(Instruction::SetProperty {
                    node_id: id,
                    property: "fb".to_string(),
                    value: json!(params.feedback as f64),
                });
                batch.push(Instruction::SetProperty {
                    node_id: id,
                    property: "transitionMs".to_string(),
                    value: json!(params.transition_ms as f64),
                });
            }
        }

        if mix_changed {
            // Update all 4 mix const nodes.
            let mix_val = params.mix as f64;
            for &id in &self.mix_const_ids {
                batch.push(Instruction::SetProperty {
                    node_id: id,
                    property: "value".to_string(),
                    value: json!(mix_val),
                });
            }
        }

        batch.push(Instruction::CommitUpdates);
        let _ = self.runtime.apply_instructions(&batch);

        self.current = params;
    }

    /// Process a block of audio. Inputs and outputs are planar f64.
    pub fn process(&self, num_samples: usize, inputs: &[&[f64]], outputs: &mut [&mut [f64]]) {
        self.runtime
            .process(num_samples, inputs, outputs)
            .expect("Elementary runtime process failed");
    }
}
