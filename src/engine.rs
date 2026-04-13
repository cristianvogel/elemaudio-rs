//! Generic DSP engine that pairs a [`DspGraph`] implementation with a
//! [`Runtime`], handling graph mounting, parameter diffing, and audio
//! processing.
//!
//! # Usage
//!
//! 1. Implement [`DspGraph`] for your graph — a pure function that
//!    builds `Vec<Node>` from parameters.
//! 2. Create an [`Engine`] at activation time.
//! 3. Call [`Engine::set_params`] on parameter changes — the engine
//!    auto-discovers keyed consts and native node props from the graph
//!    and emits only the minimal update batches.
//! 4. Call [`Engine::process`] on every audio block.
//!
//! # Example
//!
//! ```ignore
//! use elemaudio_rs::{el, extra, Node};
//! use elemaudio_rs::engine::{DspGraph, Engine};
//! use serde_json::json;
//!
//! struct MyDelay;
//!
//! impl DspGraph for MyDelay {
//!     type Params = f64; // just delay_ms for this example
//!
//!     fn build(params: &f64) -> Vec<Node> {
//!         let delay = el::const_with_key("delay", *params);
//!         let fb = el::const_(0.3);
//!         let input = el::r#in(json!({"channel": 0}), None);
//!         vec![extra::stride_delay(json!({"maxDelayMs": 1500}), delay, fb, input)]
//!     }
//! }
//!
//! let engine = Engine::<MyDelay>::new(44100.0, 512, &250.0).unwrap();
//! ```

use std::collections::HashMap;
use std::marker::PhantomData;

use crate::graph::{Graph, MountedGraph, Node};
use crate::runtime::{Instruction, InstructionBatch, Runtime};

// Re-export legacy types for backward compatibility during migration.
pub use legacy::{KeyedConst, NativeProp};

/// A pure graph-building function.
///
/// Implement this trait for each DSP topology. The engine handles
/// mounting, parameter diffing, and runtime delegation. Keyed consts
/// and native node props are discovered automatically from the graph
/// — no manual declarations needed.
pub trait DspGraph {
    /// Parameter snapshot type (e.g., a struct with delay_ms, feedback, etc.).
    type Params: Clone;

    /// Build the graph from parameters. Returns output root nodes.
    ///
    /// Called once at activation to mount the graph, and again on each
    /// `set_params` call to diff keyed consts and native props.
    fn build(params: &Self::Params) -> Vec<Node>;
}

/// Generic DSP engine that owns a [`Runtime`] and a mounted graph.
pub struct Engine<G: DspGraph> {
    runtime: Runtime,
    mounted: MountedGraph,
    /// Keyed const values snapshot from the last build, for change detection.
    keyed_consts: HashMap<String, f64>,
    /// Native node props snapshot from the last build, for change detection.
    /// Key: (node_kind, prop_name) → value. Used with node ID index for SetProperty.
    native_props: HashMap<(String, String), serde_json::Value>,
    /// Native node IDs grouped by kind, for SetProperty targeting.
    native_node_ids: HashMap<String, Vec<i32>>,
    /// Current parameters.
    current: G::Params,
    _phantom: PhantomData<G>,
}

impl<G: DspGraph> Engine<G> {
    /// Create the engine, build and mount the graph, apply it to the runtime.
    pub fn new(sample_rate: f64, buffer_size: usize, params: &G::Params) -> Result<Self, String> {
        let runtime = Runtime::new()
            .sample_rate(sample_rate)
            .buffer_size(buffer_size)
            .call()
            .map_err(|e| format!("failed to create runtime: {e}"))?;

        let roots = G::build(params);
        let keyed_consts = collect_keyed_consts(&roots);
        let native_props = collect_native_props(&roots);

        let graph = Graph::new().render(roots);
        let mounted = graph
            .mount()
            .map_err(|e| format!("graph mount failed: {e}"))?;

        runtime
            .apply_instructions(mounted.batch())
            .map_err(|e| format!("failed to apply initial graph: {e}"))?;

        let mut native_node_ids: HashMap<String, Vec<i32>> = HashMap::new();
        for (_, node) in mounted.all_nodes() {
            native_node_ids
                .entry(node.kind().to_string())
                .or_default()
                .push(node.id());
        }

        log::info!(
            "Engine<{}> created: {} keyed consts, {} native prop groups",
            std::any::type_name::<G>(),
            keyed_consts.len(),
            native_props.len(),
        );

        Ok(Self {
            runtime,
            mounted,
            keyed_consts,
            native_props,
            native_node_ids,
            current: params.clone(),
            _phantom: PhantomData,
        })
    }

    /// Update parameters. Rebuilds the graph declaratively, diffs keyed
    /// consts and native node props against the previous build, and emits
    /// minimal instruction batches for any changes.
    pub fn set_params(&mut self, params: &G::Params) {
        let new_roots = G::build(params);
        let new_keyed_consts = collect_keyed_consts(&new_roots);
        let new_native_props = collect_native_props(&new_roots);

        // Diff keyed consts.
        for (key, &new_val) in &new_keyed_consts {
            let changed = self
                .keyed_consts
                .get(key)
                .map_or(true, |&old| (old - new_val).abs() > f64::EPSILON);

            if changed {
                if let Some(batch) = self.mounted.set_const_value(key, new_val) {
                    let _ = self.runtime.apply_instructions(&batch);
                }
            }
        }

        // Diff native props.
        for ((kind, prop), new_val) in &new_native_props {
            let changed = self
                .native_props
                .get(&(kind.clone(), prop.clone()))
                .map_or(true, |old| old != new_val);

            if changed {
                if let Some(ids) = self.native_node_ids.get(kind) {
                    let mut batch = InstructionBatch::new();
                    for &id in ids {
                        batch.push(Instruction::SetProperty {
                            node_id: id,
                            property: prop.clone(),
                            value: new_val.clone(),
                        });
                    }
                    batch.push(Instruction::CommitUpdates);
                    let _ = self.runtime.apply_instructions(&batch);
                }
            }
        }

        self.keyed_consts = new_keyed_consts;
        self.native_props = new_native_props;
        self.current = params.clone();
    }

    /// Process a block of audio.
    pub fn process(
        &self,
        num_samples: usize,
        inputs: &[&[f64]],
        outputs: &mut [&mut [f64]],
    ) -> crate::Result<()> {
        self.runtime.process(num_samples, inputs, outputs)
    }

    /// Returns a reference to the mounted graph.
    pub fn mounted(&self) -> &MountedGraph {
        &self.mounted
    }

    /// Returns a reference to the underlying runtime.
    pub fn runtime(&self) -> &Runtime {
        &self.runtime
    }

    /// Returns the current parameters.
    pub fn params(&self) -> &G::Params {
        &self.current
    }
}

// ---- Graph tree walkers -----------------------------------------------

/// Walk the node tree and collect all keyed `const` nodes with their values.
fn collect_keyed_consts(roots: &[Node]) -> HashMap<String, f64> {
    let mut result = HashMap::new();
    for root in roots {
        walk_keyed_consts(root, &mut result);
    }
    result
}

fn walk_keyed_consts(node: &Node, result: &mut HashMap<String, f64>) {
    if node.kind() == "const" {
        if let serde_json::Value::Object(props) = node.props() {
            if let (Some(key), Some(value)) = (
                props.get("key").and_then(|v| v.as_str()),
                props.get("value").and_then(|v| v.as_f64()),
            ) {
                result.insert(key.to_string(), value);
            }
        }
    }
    for child in node.children() {
        walk_keyed_consts(child, result);
    }
}

/// Walk the node tree and collect all non-const, non-structural node props.
/// Returns a map of (node_kind, prop_name) → prop_value.
///
/// Excludes: `const`, `root`, `in`, `add`, `sub`, `mul`, `div` (structural
/// nodes whose props are either empty or don't change between builds).
/// Also excludes the `key` prop itself (it's identity, not a parameter).
fn collect_native_props(roots: &[Node]) -> HashMap<(String, String), serde_json::Value> {
    let mut result = HashMap::new();
    for root in roots {
        walk_native_props(root, &mut result);
    }
    result
}

const STRUCTURAL_KINDS: &[&str] = &[
    "const", "root", "in", "add", "sub", "mul", "div", "mod", "sin", "cos", "tan", "tanh", "exp",
    "log", "log2", "sqrt", "abs", "ceil", "floor", "round", "le", "ge", "eq", "and", "or", "pow",
    "min", "max", "pole", "z", "prewarp", "phasor", "sphasor",
];

fn walk_native_props(node: &Node, result: &mut HashMap<(String, String), serde_json::Value>) {
    let kind = node.kind();
    if !STRUCTURAL_KINDS.contains(&kind) {
        if let serde_json::Value::Object(props) = node.props() {
            for (prop_name, prop_value) in props {
                if prop_name == "key" {
                    continue;
                }
                result.insert((kind.to_string(), prop_name.clone()), prop_value.clone());
            }
        }
    }
    for child in node.children() {
        walk_native_props(child, result);
    }
}

// ---- Legacy types (backward compatibility) ----------------------------

/// Legacy types kept for backward compatibility during migration.
/// New code should not use these — the engine auto-discovers keyed
/// consts and native props from the graph tree.
mod legacy {
    /// A keyed const declaration (legacy — auto-discovered by engine).
    #[derive(Debug, Clone)]
    pub struct KeyedConst {
        pub key: String,
        pub value: f64,
    }

    impl KeyedConst {
        pub fn new(key: impl Into<String>, value: f64) -> Self {
            Self {
                key: key.into(),
                value,
            }
        }
    }

    /// A native node property declaration (legacy — auto-discovered by engine).
    #[derive(Debug, Clone)]
    pub struct NativeProp {
        pub node_kind: String,
        pub property: String,
        pub value: f64,
    }

    impl NativeProp {
        pub fn new(node_kind: impl Into<String>, property: impl Into<String>, value: f64) -> Self {
            Self {
                node_kind: node_kind.into(),
                property: property.into(),
                value,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authoring::{el, extra};
    use serde_json::json;

    #[derive(Debug, Clone)]
    struct TestParams {
        delay_ms: f64,
        fb: f64,
        transition_ms: f64,
    }

    struct TestDelayGraph;

    impl DspGraph for TestDelayGraph {
        type Params = TestParams;

        fn build(p: &TestParams) -> Vec<Node> {
            let delay = el::const_with_key("delay", p.delay_ms);
            let fb = el::const_with_key("fb", p.fb);
            let input = el::r#in(json!({"channel": 0}), None);
            vec![extra::stride_delay(
                json!({ "maxDelayMs": 500, "transitionMs": p.transition_ms }),
                delay,
                fb,
                input,
            )]
        }
    }

    #[test]
    fn engine_creates_and_processes() {
        let params = TestParams {
            delay_ms: 50.0,
            fb: 0.0,
            transition_ms: 10.0,
        };

        let engine = Engine::<TestDelayGraph>::new(44100.0, 512, &params).expect("engine creation");

        let mut input_buf = vec![0.0_f64; 512];
        input_buf[0] = 1.0;
        let mut output_buf = vec![0.0_f64; 512];

        let inputs = [input_buf.as_slice()];
        let mut outputs = [output_buf.as_mut_slice()];
        engine.process(512, &inputs, &mut outputs).expect("process");

        let silence = vec![0.0_f64; 512];
        let mut found = false;
        for _ in 0..20 {
            let inputs = [silence.as_slice()];
            let mut out = vec![0.0_f64; 512];
            let mut outputs = [out.as_mut_slice()];
            engine.process(512, &inputs, &mut outputs).expect("process");
            if outputs[0].iter().any(|&s| s.abs() > 1e-10) {
                found = true;
                break;
            }
        }
        assert!(found, "engine should produce delayed output");
    }

    #[test]
    fn engine_auto_discovers_keyed_consts() {
        let params = TestParams {
            delay_ms: 50.0,
            fb: 0.3,
            transition_ms: 10.0,
        };

        let engine = Engine::<TestDelayGraph>::new(44100.0, 64, &params).expect("engine creation");

        assert_eq!(engine.keyed_consts.len(), 2);
        assert!((engine.keyed_consts["delay"] - 50.0).abs() < f64::EPSILON);
        assert!((engine.keyed_consts["fb"] - 0.3).abs() < f64::EPSILON);
    }

    #[test]
    fn engine_auto_discovers_native_props() {
        let params = TestParams {
            delay_ms: 50.0,
            fb: 0.0,
            transition_ms: 10.0,
        };

        let engine = Engine::<TestDelayGraph>::new(44100.0, 64, &params).expect("engine creation");

        // stridedelay has props: maxDelayMs, transitionMs, bigLeapMode
        assert!(engine
            .native_props
            .contains_key(&("stridedelay".to_string(), "transitionMs".to_string())));
        assert!(engine
            .native_props
            .contains_key(&("stridedelay".to_string(), "maxDelayMs".to_string())));
    }

    #[test]
    fn engine_set_params_diffs_automatically() {
        let params = TestParams {
            delay_ms: 50.0,
            fb: 0.0,
            transition_ms: 10.0,
        };

        let mut engine =
            Engine::<TestDelayGraph>::new(44100.0, 64, &params).expect("engine creation");

        let new_params = TestParams {
            delay_ms: 100.0,
            fb: 0.3,
            transition_ms: 20.0,
        };
        engine.set_params(&new_params);

        assert!((engine.keyed_consts["delay"] - 100.0).abs() < f64::EPSILON);
        assert!((engine.keyed_consts["fb"] - 0.3).abs() < f64::EPSILON);
        assert_eq!(
            engine.native_props[&("stridedelay".to_string(), "transitionMs".to_string())],
            serde_json::json!(20.0)
        );
    }

    #[test]
    fn engine_no_update_when_params_unchanged() {
        let params = TestParams {
            delay_ms: 50.0,
            fb: 0.0,
            transition_ms: 10.0,
        };

        let mut engine =
            Engine::<TestDelayGraph>::new(44100.0, 64, &params).expect("engine creation");

        engine.set_params(&params);
        assert!((engine.keyed_consts["delay"] - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn engine_rejects_duplicate_keys() {
        struct BadGraph;

        impl DspGraph for BadGraph {
            type Params = ();

            fn build(_: &()) -> Vec<Node> {
                let a = el::const_with_key("dup", 1.0);
                let b = el::const_with_key("dup", 2.0);
                vec![el::add((a, b))]
            }
        }

        let result = Engine::<BadGraph>::new(44100.0, 64, &());
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("duplicate"), "got: {err}");
    }
}
