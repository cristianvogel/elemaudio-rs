//! Minimal Rust-native graph DSL for Elementary-style node composition.
//!
//! This module provides the core graph types (`Graph`, `Node`, `MountedGraph`,
//! etc.). For node composition helpers, see the `authoring` module.

use crate::{Instruction, InstructionBatch, NodeId};

/// Error returned by [`Graph::mount`] and [`Graph::mount_with_id_counter`].
#[derive(Debug, Clone)]
pub enum MountError {
    /// Two nodes in the graph share the same `key` prop value.
    DuplicateKey(String),
}

impl std::fmt::Display for MountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateKey(key) => write!(f, "duplicate mounted node key: {key}"),
        }
    }
}

impl std::error::Error for MountError {}

/// A multichannel graph is a set of root nodes, one per output channel.
#[derive(Debug, Clone, Default)]
pub struct Graph {
    roots: Vec<Node>,
}

/// Input accepted by `Graph::render(...)`.
#[derive(Debug, Clone)]
pub enum GraphRoots {
    /// A single root node.
    Single(Node),
    /// Multiple root nodes, one per output channel.
    Many(Vec<Node>),
}

impl From<Node> for GraphRoots {
    fn from(node: Node) -> Self {
        Self::Single(node)
    }
}

impl From<Vec<Node>> for GraphRoots {
    fn from(roots: Vec<Node>) -> Self {
        Self::Many(roots)
    }
}

impl<const N: usize> From<[Node; N]> for GraphRoots {
    fn from(roots: [Node; N]) -> Self {
        Self::Many(roots.into_iter().collect())
    }
}

/// Handle for a node that has already been mounted into a runtime graph.
///
/// This is the Rust-native fast path: keep the handle around and update the
/// mounted node directly instead of rebuilding and reconciling a new graph.
///
/// # Fast-Path Updates
///
/// To enable efficient parameter updates:
/// 1. Create a graph with keyed nodes: `el::const_with_key("my_param", value)`
/// 2. Mount the graph: `mounted = graph.mount()?`
/// 3. Retrieve the node by key: `mounted.node_with_key("my_param")?`
/// 4. Send direct updates: `mounted.node.set_const_value(new_value)`
///
/// This avoids rebuilding and reconciling the entire graph on each parameter change.
///
/// # Example
///
/// ```ignore
/// let mounted = Graph::new()
///     .render(el::const_with_key("freq", 440.0))
///     .mount();
///
/// // Update frequency without graph rebuild
/// if let Some(freq_node) = mounted.node_with_key("freq") {
///     let update = freq_node.set_const_value(880.0);
///     runtime.execute(&update);
/// }
/// ```
#[derive(Debug, Clone)]
pub struct MountedNode {
    node_id: NodeId,
    kind: String,
    key: Option<String>,
}

impl MountedNode {
    /// Returns the runtime node id.
    pub fn id(&self) -> NodeId {
        self.node_id
    }

    /// Returns the node kind.
    pub fn kind(&self) -> &str {
        &self.kind
    }

    /// Returns the author-supplied key, if present.
    pub fn key(&self) -> Option<&str> {
        self.key.as_deref()
    }

    /// Creates a direct property update batch for this mounted node.
    pub fn set_property(
        &self,
        property: impl Into<String>,
        value: serde_json::Value,
    ) -> InstructionBatch {
        let mut batch = InstructionBatch::new();
        batch.push(Instruction::SetProperty {
            node_id: self.node_id,
            property: property.into(),
            value,
        });
        batch.push(Instruction::CommitUpdates);
        batch
    }

    /// Convenience for updating a mounted `const` node's numeric value.
    pub fn set_const_value(&self, value: f64) -> InstructionBatch {
        self.set_property("value", serde_json::json!(value))
    }
}

/// Lowered graph plus mounted-node handles for direct updates.
#[derive(Debug, Clone, Default)]
pub struct MountedGraph {
    batch: InstructionBatch,
    roots: Vec<MountedNode>,
    nodes: Vec<(Vec<usize>, MountedNode)>,
    keyed_nodes: Vec<(String, MountedNode)>,
}

impl MountedGraph {
    /// Returns the full instruction batch for the mounted graph.
    pub fn batch(&self) -> &InstructionBatch {
        &self.batch
    }

    /// Consumes the mounted graph and returns its instruction batch.
    pub fn into_batch(self) -> InstructionBatch {
        self.batch
    }

    /// Returns the mounted root nodes in channel order.
    pub fn roots(&self) -> &[MountedNode] {
        &self.roots
    }

    /// Returns a mounted node by structural path.
    pub fn node_at(&self, path: &[usize]) -> Option<MountedNode> {
        self.nodes
            .iter()
            .find(|(node_path, _)| node_path.as_slice() == path)
            .map(|(_, node)| node.clone())
    }

    /// Returns a mounted node by author-supplied key.
    pub fn node_with_key(&self, key: &str) -> Option<MountedNode> {
        self.keyed_nodes
            .iter()
            .find(|(node_key, _)| node_key == key)
            .map(|(_, node)| node.clone())
    }

    /// Returns an iterator over all mounted nodes with their structural paths.
    pub fn all_nodes(&self) -> impl Iterator<Item = (&[usize], &MountedNode)> {
        self.nodes
            .iter()
            .map(|(path, node)| (path.as_slice(), node))
    }

    /// Convenience for updating a keyed `const` node's numeric value.
    pub fn set_const_value(&self, key: &str, value: f64) -> Option<InstructionBatch> {
        let node = self.node_with_key(key)?;

        if node.kind() != "const" {
            return None;
        }

        Some(node.set_const_value(value))
    }
}

impl Graph {
    /// Creates an empty graph.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds one or more output roots and returns the graph.
    pub fn render<R>(mut self, roots: R) -> Self
    where
        R: Into<GraphRoots>,
    {
        match roots.into() {
            GraphRoots::Single(node) => self.roots.push(node),
            GraphRoots::Many(roots) => self.roots.extend(roots),
        }
        self
    }

    /// Backward-compatible alias for `render`.
    pub fn root<R>(self, roots: R) -> Self
    where
        R: Into<GraphRoots>,
    {
        self.render(roots)
    }

    /// Backward-compatible alias for `render`.
    pub fn with_root<R>(self, roots: R) -> Self
    where
        R: Into<GraphRoots>,
    {
        self.render(roots)
    }

    /// Lowers the graph and keeps mounted-node handles for direct updates.
    ///
    /// Returns `Err(MountError::DuplicateKey(...))` if two nodes in the
    /// graph share the same `key` prop.
    pub fn mount(&self) -> std::result::Result<MountedGraph, MountError> {
        let mut next_id: NodeId = 1;
        self.mount_with_id_counter(&mut next_id)
    }

    /// Lowers the graph using an external node-ID counter.
    ///
    /// Each call advances `next_id` past all allocated IDs. This allows
    /// successive graph rebuilds to produce unique node IDs within the
    /// same runtime session, avoiding `NodeAlreadyExists` errors.
    ///
    /// Returns `Err(MountError::DuplicateKey(...))` if two nodes in the
    /// graph share the same `key` prop.
    pub fn mount_with_id_counter(
        &self,
        next_id: &mut NodeId,
    ) -> std::result::Result<MountedGraph, MountError> {
        let mut batch = InstructionBatch::new();
        let mut mounted = MountedGraph::default();

        let mut lowered_roots = Vec::with_capacity(self.roots.len());

        for (channel, root) in self.roots.iter().enumerate() {
            let root_id = *next_id;
            *next_id += 1;

            batch.push(Instruction::CreateNode {
                node_id: root_id,
                node_type: "root".to_string(),
            });
            batch.push(Instruction::SetProperty {
                node_id: root_id,
                property: "channel".to_string(),
                value: serde_json::json!(channel),
            });

            let child_id = *next_id;
            *next_id += 1;
            let path = vec![channel];
            let mounted_root = lower_node(
                root,
                child_id,
                &path,
                next_id,
                &mut batch,
                &mut mounted.nodes,
                &mut mounted.keyed_nodes,
            )?;

            batch.push(Instruction::AppendChild {
                parent_id: root_id,
                child_id,
                child_output_channel: root.output_channel as i32,
            });
            lowered_roots.push(root_id);
            mounted.roots.push(mounted_root);
        }

        batch.push(Instruction::ActivateRoots {
            roots: lowered_roots,
        });
        batch.push(Instruction::CommitUpdates);

        mounted.batch = batch;
        Ok(mounted)
    }

    /// Adds one root node.
    pub fn push_root(&mut self, node: Node) {
        self.roots.push(node);
    }

    /// Returns the graph roots.
    pub fn roots(&self) -> &[Node] {
        &self.roots
    }

    /// Lowers the graph into a runtime instruction batch.
    ///
    /// Panics if the graph contains duplicate keyed nodes. Prefer
    /// [`mount`] for fallible access.
    pub fn lower(&self) -> InstructionBatch {
        self.mount()
            .expect("graph contains duplicate keys")
            .into_batch()
    }
}

/// A graph node.
#[derive(Debug, Clone)]
pub struct Node {
    kind: String,
    props: serde_json::Value,
    children: Vec<Node>,
    output_channel: usize,
}

impl Node {
    pub(crate) fn new(
        kind: impl Into<String>,
        props: serde_json::Value,
        children: Vec<Node>,
    ) -> Self {
        Self {
            kind: kind.into(),
            props,
            children,
            output_channel: 0,
        }
    }

    pub(crate) fn with_output_channel(mut self, output_channel: usize) -> Self {
        self.output_channel = output_channel;
        self
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn props(&self) -> &serde_json::Value {
        &self.props
    }

    pub fn children(&self) -> &[Node] {
        &self.children
    }

    pub fn output_channel(&self) -> usize {
        self.output_channel
    }
}

pub type Value = serde_json::Value;

fn lower_node(
    node: &Node,
    node_id: NodeId,
    path: &[usize],
    next_id: &mut NodeId,
    batch: &mut InstructionBatch,
    mounted_nodes: &mut Vec<(Vec<usize>, MountedNode)>,
    keyed_nodes: &mut Vec<(String, MountedNode)>,
) -> std::result::Result<MountedNode, MountError> {
    batch.push(Instruction::CreateNode {
        node_id,
        node_type: node.kind.clone(),
    });

    if let Value::Object(props) = &node.props {
        for (key, value) in props {
            batch.push(Instruction::SetProperty {
                node_id,
                property: key.clone(),
                value: value.clone(),
            });
        }
    }

    for (child_index, child) in node.children.iter().enumerate() {
        let child_id = *next_id;
        *next_id += 1;

        let mut child_path = path.to_vec();
        child_path.push(child_index);

        lower_node(
            child,
            child_id,
            &child_path,
            next_id,
            batch,
            mounted_nodes,
            keyed_nodes,
        )?;
        batch.push(Instruction::AppendChild {
            parent_id: node_id,
            child_id,
            child_output_channel: child.output_channel as i32,
        });
    }

    let mounted_node = MountedNode {
        node_id,
        kind: node.kind.clone(),
        key: key_from_props(&node.props),
    };
    mounted_nodes.push((path.to_vec(), mounted_node.clone()));
    if let Some(key) = mounted_node.key.clone() {
        if keyed_nodes
            .iter()
            .any(|(existing_key, _)| existing_key == &key)
        {
            log::error!("duplicate mounted node key: {key}");
            return Err(MountError::DuplicateKey(key));
        }
        keyed_nodes.push((key, mounted_node.clone()));
    }
    Ok(mounted_node)
}

fn key_from_props(props: &Value) -> Option<String> {
    match props {
        Value::Object(map) => map
            .get("key")
            .and_then(|value| value.as_str())
            .map(|key| key.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::Graph;
    use crate::authoring::{el, extra, mc};

    #[test]
    fn lowers_multichannel_output_channels_on_append_edges() {
        let graph = Graph::new().root(mc::sample(
            serde_json::json!({"path": "a.wav", "channels": 2}),
            el::const_(1.0),
        ));

        let payload: serde_json::Value =
            serde_json::from_str(&graph.lower().to_json_string()).expect("valid batch json");
        let instructions = payload.as_array().expect("batch is an array");
        let mut node_types = std::collections::HashMap::new();

        for instruction in instructions {
            let array = instruction.as_array().expect("instruction is an array");
            if array.first().and_then(|value| value.as_i64()) == Some(0) {
                node_types.insert(
                    array[1].as_i64().expect("node id") as i32,
                    array[2].as_str().expect("node type"),
                );
            }
        }

        let output_channels: Vec<i64> = instructions
            .iter()
            .filter_map(|instruction| {
                let array = instruction.as_array()?;
                if array.first()?.as_i64()? != 2 {
                    return None;
                }

                let parent_id = array.get(1)?.as_i64()? as i32;
                if node_types.get(&parent_id).copied() != Some("root") {
                    return None;
                }

                array.get(3)?.as_i64()
            })
            .collect();

        assert_eq!(output_channels, vec![0, 1]);
    }

    #[test]
    fn stride_delay_mounts_with_signal_children() {
        let delay_ms = el::const_with_key("delay", 250.0);
        let fb = el::const_with_key("fb", 0.3);
        let input = el::r#in(serde_json::json!({"channel": 0}), None);

        let delayed = extra::stride_delay(
            serde_json::json!({ "maxDelayMs": 1500, "transitionMs": 60 }),
            delay_ms,
            fb,
            input,
        );

        let graph = Graph::new().render(vec![delayed]);
        let mounted = graph.mount().expect("mount");
        let batch = mounted.batch();

        // Verify the batch serializes to a non-empty JSON array.
        let json = batch.to_json_string();
        assert!(json.len() > 2, "batch should contain instructions");

        // Find the stridedelay node in the mounted graph.
        let sd_nodes: Vec<_> = mounted
            .all_nodes()
            .filter(|(_, n)| n.kind() == "stridedelay")
            .collect();
        assert_eq!(sd_nodes.len(), 1, "expected 1 stridedelay node");

        // Verify the keyed const nodes are present.
        let delay_const = mounted
            .all_nodes()
            .find(|(_, n)| n.key().as_deref() == Some("delay"));
        assert!(delay_const.is_some(), "keyed 'delay' const should exist");

        let fb_const = mounted
            .all_nodes()
            .find(|(_, n)| n.key().as_deref() == Some("fb"));
        assert!(fb_const.is_some(), "keyed 'fb' const should exist");
    }

    #[test]
    fn stride_delay_children_order_in_batch() {
        // Verify children are appended in the correct order:
        // child 0 = delayMs, child 1 = fb, child 2 = audio
        let delay_ms = el::const_with_key("delay", 250.0);
        let fb = el::const_with_key("fb", 0.0);
        let input = el::r#in(serde_json::json!({"channel": 0}), None);

        let delayed = extra::stride_delay(
            serde_json::json!({ "maxDelayMs": 1500 }),
            delay_ms,
            fb,
            input,
        );

        let graph = Graph::new().render(vec![delayed]);
        let json_str = graph.lower().to_json_string();
        let payload: serde_json::Value = serde_json::from_str(&json_str).expect("valid batch json");
        let instructions = payload.as_array().expect("batch is an array");

        // Collect CreateNode instructions to map node_id -> node_type.
        let mut node_types: std::collections::HashMap<i64, String> =
            std::collections::HashMap::new();
        for inst in instructions {
            let arr = inst.as_array().expect("instruction is array");
            if arr[0].as_i64() == Some(0) {
                // CreateNode: [0, node_id, node_type]
                node_types.insert(
                    arr[1].as_i64().unwrap(),
                    arr[2].as_str().unwrap().to_string(),
                );
            }
        }

        // Find the stridedelay node ID.
        let sd_id = node_types
            .iter()
            .find(|(_, t)| t.as_str() == "stridedelay")
            .map(|(id, _)| *id)
            .expect("stridedelay node should exist");

        // Collect AppendChild instructions for the stridedelay parent.
        // AppendChild: [2, parent_id, child_id, output_channel]
        let children_of_sd: Vec<(i64, String)> = instructions
            .iter()
            .filter_map(|inst| {
                let arr = inst.as_array()?;
                if arr[0].as_i64()? != 2 {
                    return None;
                }
                if arr[1].as_i64()? != sd_id {
                    return None;
                }
                let child_id = arr[2].as_i64()?;
                let child_type = node_types.get(&child_id)?.clone();
                Some((child_id, child_type))
            })
            .collect();

        // Expect 3 children: const (delay), const (fb), in (audio).
        assert_eq!(
            children_of_sd.len(),
            3,
            "stridedelay should have 3 children"
        );
        assert_eq!(
            children_of_sd[0].1, "const",
            "child 0 should be const (delayMs)"
        );
        assert_eq!(children_of_sd[1].1, "const", "child 1 should be const (fb)");
        assert_eq!(children_of_sd[2].1, "in", "child 2 should be in (audio)");
    }

    #[test]
    fn stride_delay_runtime_produces_output() {
        use crate::Runtime;

        let sr = 44100.0;
        let block = 64;
        let runtime = Runtime::new()
            .sample_rate(sr)
            .buffer_size(block)
            .call()
            .expect("runtime creation");

        // Build a graph: const(250ms delay) -> stride_delay -> root
        // Feed a simple impulse as input.
        let delay_ms = el::const_(250.0);
        let fb = el::const_(0.0);
        let input = el::r#in(serde_json::json!({"channel": 0}), None);

        let delayed = extra::stride_delay(
            serde_json::json!({ "maxDelayMs": 500, "transitionMs": 10 }),
            delay_ms,
            fb,
            input,
        );

        let graph = Graph::new().render(vec![delayed]);
        let mounted = graph.mount().expect("mount");
        runtime
            .apply_instructions(mounted.batch())
            .expect("apply instructions");

        // Create an impulse input: 1.0 at sample 0, then silence.
        let mut input_buf = vec![0.0_f64; block];
        input_buf[0] = 1.0;
        let mut output_buf = vec![0.0_f64; block];

        let inputs = [input_buf.as_slice()];
        let mut outputs = [output_buf.as_mut_slice()];
        runtime
            .process(block, &inputs, &mut outputs)
            .expect("process");

        // On the first block with 250ms delay at 44100Hz = 11025 samples,
        // the impulse won't appear in the output yet (delayed beyond this block).
        // But the output should NOT be all-zero if the node is processing
        // (the stride transition from 0ms to 250ms will produce some output).
        // At minimum, the node should not crash.

        // Run several more blocks to fill the delay buffer.
        let silence = vec![0.0_f64; block];
        for _ in 0..200 {
            let inputs = [silence.as_slice()];
            let mut out = vec![0.0_f64; block];
            let mut outputs = [out.as_mut_slice()];
            runtime
                .process(block, &inputs, &mut outputs)
                .expect("process");

            // Check if any non-zero output appeared (the delayed impulse).
            if outputs[0].iter().any(|&s| s.abs() > 1e-10) {
                // The delay is working — the impulse came back.
                return;
            }
        }

        panic!("stride delay produced no output after 200 blocks — delay effect is not working");
    }

    #[test]
    fn stride_delay_with_computed_children_produces_output() {
        // Mimics the nel-x MC graph: delay_ms and fb are computed
        // through el::mul/el::add expressions, not plain consts.
        use crate::Runtime;

        let sr = 44100.0;
        let block = 64;
        let runtime = Runtime::new()
            .sample_rate(sr)
            .buffer_size(block)
            .call()
            .expect("runtime creation");

        let base_delay = el::const_(250.0);
        let spread = el::const_(0.0);
        let offset = el::const_(0.0); // channel 0 = center

        // ch_delay = base_delay * (1.0 + spread * offset) = 250 * 1 = 250
        let ch_delay = el::mul((
            base_delay,
            el::add((1.0, el::mul((spread.clone(), offset.clone())))),
        ));

        // ch_fb = base_fb * (1 - spread * offset * 0.3) = 0.3 * 1 = 0.3
        let base_fb = el::const_(0.3);
        let ch_fb = el::mul((
            base_fb,
            el::sub((1.0, el::mul((spread, el::mul((offset, 0.3)))))),
        ));

        let input = el::r#in(serde_json::json!({"channel": 0}), None);

        let delayed = extra::stride_delay(
            serde_json::json!({ "maxDelayMs": 500, "transitionMs": 10 }),
            ch_delay,
            ch_fb,
            input,
        );

        let graph = Graph::new().render(vec![delayed]);
        let mounted = graph.mount().expect("mount");
        runtime
            .apply_instructions(mounted.batch())
            .expect("apply instructions");

        // Send impulse, then silence, check if the delayed impulse returns.
        let mut input_buf = vec![0.0_f64; block];
        input_buf[0] = 1.0;
        let mut output_buf = vec![0.0_f64; block];

        let inputs = [input_buf.as_slice()];
        let mut outputs = [output_buf.as_mut_slice()];
        runtime
            .process(block, &inputs, &mut outputs)
            .expect("process");

        let silence = vec![0.0_f64; block];
        for _ in 0..200 {
            let inputs = [silence.as_slice()];
            let mut out = vec![0.0_f64; block];
            let mut outputs = [out.as_mut_slice()];
            runtime
                .process(block, &inputs, &mut outputs)
                .expect("process");

            if outputs[0].iter().any(|&s| s.abs() > 1e-10) {
                return; // delay is working with computed children
            }
        }

        panic!("stride delay with computed children produced no output");
    }

    #[test]
    fn stride_delay_with_mix_blend() {
        // Test the full wet/dry blend path as used in the plugin.
        use crate::Runtime;

        let sr = 44100.0;
        let block = 512;
        let runtime = Runtime::new()
            .sample_rate(sr)
            .buffer_size(block)
            .call()
            .expect("runtime creation");

        let delay_ms = el::const_(50.0); // Short delay for quick test
        let fb = el::const_(0.0);
        let mix_val = 0.5;
        let mix_wet = el::const_(mix_val);
        let mix_dry = el::const_(mix_val);
        let input = el::r#in(serde_json::json!({"channel": 0}), None);

        let delayed = extra::stride_delay(
            serde_json::json!({ "maxDelayMs": 200, "transitionMs": 10 }),
            delay_ms,
            fb,
            input.clone(),
        );

        // Manual wet/dry: output = delayed * mix + input * (1 - mix)
        let wet = el::mul((delayed, mix_wet));
        let dry = el::mul((input, el::sub((1.0, mix_dry))));
        let out = el::add((wet, dry));

        let graph = Graph::new().render(vec![out]);
        let mounted = graph.mount().expect("mount");
        runtime
            .apply_instructions(mounted.batch())
            .expect("apply instructions");

        // Send continuous signal (not just an impulse).
        let input_signal: Vec<f64> = (0..block)
            .map(|i| if i < 100 { 1.0 } else { 0.0 })
            .collect();
        let mut output_buf = vec![0.0_f64; block];

        let inputs = [input_signal.as_slice()];
        let mut outputs = [output_buf.as_mut_slice()];
        runtime
            .process(block, &inputs, &mut outputs)
            .expect("process");

        // Check if dry path produces output. May take one block to propagate.
        let first_block_max = outputs[0].iter().copied().fold(0.0_f64, f64::max);
        eprintln!("first block max output: {first_block_max}");

        // Run second block with same input to check propagation.
        let mut output_buf2 = vec![0.0_f64; block];
        let inputs2 = [input_signal.as_slice()];
        let mut outputs2 = [output_buf2.as_mut_slice()];
        runtime
            .process(block, &inputs2, &mut outputs2)
            .expect("process 2");
        let second_block_max = outputs2[0].iter().copied().fold(0.0_f64, f64::max);
        eprintln!("second block max output: {second_block_max}");

        assert!(
            first_block_max > 0.01 || second_block_max > 0.01,
            "dry path should produce output within first two blocks, got max={first_block_max}, {second_block_max}"
        );

        // After the delay time (50ms = 2205 samples at 44100Hz),
        // we need more blocks. Run more.
        let silence = vec![0.0_f64; block];
        let mut found_delayed = false;

        for block_num in 0..20 {
            let inputs = [silence.as_slice()];
            let mut out = vec![0.0_f64; block];
            let mut outputs = [out.as_mut_slice()];
            runtime
                .process(block, &inputs, &mut outputs)
                .expect("process");

            // After input stops, any non-zero output is from the delay.
            if outputs[0].iter().any(|&s| s.abs() > 0.01) {
                found_delayed = true;
                eprintln!(
                    "delayed signal appeared in block {} (sample ~{})",
                    block_num + 1,
                    (block_num + 1) * block
                );
                break;
            }
        }

        assert!(
            found_delayed,
            "delay effect should produce output after the dry signal stops"
        );
    }

    #[test]
    fn mount_returns_error_on_duplicate_key() {
        use crate::graph::MountError;

        // Two const nodes sharing the same key.
        let a = el::const_with_key("dup", 1.0);
        let b = el::const_with_key("dup", 2.0);
        let out = el::add((a, b));

        let graph = Graph::new().render(vec![out]);
        let result = graph.mount();

        match result {
            Err(MountError::DuplicateKey(key)) => {
                assert_eq!(key, "dup");
            }
            Ok(_) => panic!("expected DuplicateKey error, got Ok"),
        }
    }

    #[test]
    fn stride_delay_with_insert_mounts_and_processes() {
        use crate::Runtime;

        let sr = 44100.0;
        let block = 512;
        let runtime = Runtime::new()
            .sample_rate(sr)
            .buffer_size(block)
            .call()
            .expect("runtime creation");

        let delay_ms = el::const_(100.0);
        let fb = el::const_(0.5);
        let input = el::r#in(serde_json::json!({"channel": 0}), None);

        // Insert a simple passthrough (identity) in the feedback loop.
        let delayed = extra::stride_delay_with_insert(
            serde_json::json!({ "maxDelayMs": 500, "transitionMs": 10, "fbtap": "test_fb" }),
            delay_ms,
            fb,
            |fb_audio| fb_audio, // passthrough — same as normal feedback
            input,
        );

        let graph = Graph::new().render(vec![delayed]);
        let mounted = graph.mount().expect("mount");

        // Verify tapIn and tapOut nodes exist in the mounted graph.
        let has_tap_in = mounted.all_nodes().any(|(_, n)| n.kind() == "tapIn");
        let has_tap_out = mounted.all_nodes().any(|(_, n)| n.kind() == "tapOut");
        assert!(has_tap_in, "graph should contain tapIn node");
        assert!(has_tap_out, "graph should contain tapOut node");

        runtime
            .apply_instructions(mounted.batch())
            .expect("apply instructions");

        // Send impulse, run blocks, check for feedback repeats.
        let mut input_buf = vec![0.0_f64; block];
        input_buf[0] = 1.0;
        let mut output_buf = vec![0.0_f64; block];

        let inputs = [input_buf.as_slice()];
        let mut outputs = [output_buf.as_mut_slice()];
        runtime
            .process(block, &inputs, &mut outputs)
            .expect("process");

        let silence = vec![0.0_f64; block];
        let mut found_repeat = false;
        // With fb=0.5 and 100ms delay, the impulse should repeat
        // (decaying) multiple times.
        for _ in 0..20 {
            let inputs = [silence.as_slice()];
            let mut out = vec![0.0_f64; block];
            let mut outputs = [out.as_mut_slice()];
            runtime
                .process(block, &inputs, &mut outputs)
                .expect("process");
            if outputs[0].iter().any(|&s| s.abs() > 1e-10) {
                found_repeat = true;
                break;
            }
        }
        assert!(found_repeat, "insert delay should produce feedback repeats");
    }

    #[test]
    fn interpolate_n_barberpole_wrapping() {
        use crate::Runtime;

        let sr = 44100.0;
        let block = 64;
        let runtime = Runtime::new()
            .sample_rate(sr)
            .buffer_size(block)
            .call()
            .expect("runtime creation");

        // 3 constant signals on a ring: A=0.2, B=0.5, C=0.9
        // Ring positions: A=0, B=1, C=2 (N=3)

        // t=0.0 → fract=0, pos=0 → fully node A (0.2)
        let mix_at_0 = extra::interpolate_n(
            serde_json::json!({"barberpole": true}),
            el::const_(0.0),
            vec![el::const_(0.2), el::const_(0.5), el::const_(0.9)],
        );

        // t=1.0 → fract=0 (wraps!), pos=0 → fully node A (0.2) again
        let mix_at_1 = extra::interpolate_n(
            serde_json::json!({"barberpole": true}),
            el::const_(1.0),
            vec![el::const_(0.2), el::const_(0.5), el::const_(0.9)],
        );

        // t=1/3 → fract=1/3, pos=1 → fully node B (0.5)
        let mix_at_third = extra::interpolate_n(
            serde_json::json!({"barberpole": true}),
            el::const_(1.0 / 3.0),
            vec![el::const_(0.2), el::const_(0.5), el::const_(0.9)],
        );

        // t=2/3 → fract=2/3, pos=2 → fully node C (0.9)
        let mix_at_two_thirds = extra::interpolate_n(
            serde_json::json!({"barberpole": true}),
            el::const_(2.0 / 3.0),
            vec![el::const_(0.2), el::const_(0.5), el::const_(0.9)],
        );

        let graph = Graph::new().render(vec![mix_at_0, mix_at_1, mix_at_third, mix_at_two_thirds]);
        let mounted = graph.mount().expect("mount");
        runtime
            .apply_instructions(mounted.batch())
            .expect("apply instructions");

        // Deep graph tree needs warmup blocks to propagate constants.
        let inputs: [&[f64]; 0] = [];
        let (mut s0, mut s1, mut s2, mut s3) = (0.0, 0.0, 0.0, 0.0);

        for _ in 0..50 {
            let mut o0 = vec![0.0_f64; block];
            let mut o1 = vec![0.0_f64; block];
            let mut o2 = vec![0.0_f64; block];
            let mut o3 = vec![0.0_f64; block];
            let mut outputs = [
                o0.as_mut_slice(),
                o1.as_mut_slice(),
                o2.as_mut_slice(),
                o3.as_mut_slice(),
            ];
            runtime
                .process(block, &inputs, &mut outputs)
                .expect("process");
            s0 = outputs[0][block - 1];
            s1 = outputs[1][block - 1];
            s2 = outputs[2][block - 1];
            s3 = outputs[3][block - 1];
        }

        assert!(
            (s0 - 0.2).abs() < 0.02,
            "t=0 should output node A (~0.2), got {s0}"
        );
        assert!(
            (s1 - 0.2).abs() < 0.02,
            "t=1 should wrap to node A (~0.2), got {s1}"
        );
        assert!(
            (s2 - 0.5).abs() < 0.02,
            "t=1/3 should output node B (~0.5), got {s2}"
        );
        assert!(
            (s3 - 0.9).abs() < 0.02,
            "t=2/3 should output node C (~0.9), got {s3}"
        );
    }
}
