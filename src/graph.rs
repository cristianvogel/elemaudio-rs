//! Minimal Rust-native graph DSL for Elementary-style node composition.
//!
//! This module provides the core graph types (`Graph`, `Node`, `MountedGraph`,
//! etc.). For node composition helpers, see the `authoring` module.

use crate::{Instruction, InstructionBatch, NodeId};

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
    pub fn mount(&self) -> MountedGraph {
        let mut batch = InstructionBatch::new();
        let mut mounted = MountedGraph::default();
        let mut next_id: NodeId = 1;

        let mut lowered_roots = Vec::with_capacity(self.roots.len());

        for (channel, root) in self.roots.iter().enumerate() {
            let root_id = next_id;
            next_id += 1;

            batch.push(Instruction::CreateNode {
                node_id: root_id,
                node_type: "root".to_string(),
            });
            batch.push(Instruction::SetProperty {
                node_id: root_id,
                property: "channel".to_string(),
                value: serde_json::json!(channel),
            });

            let child_id = next_id;
            next_id += 1;
            let path = vec![channel];
            let mounted_root = lower_node(
                root,
                child_id,
                &path,
                &mut next_id,
                &mut batch,
                &mut mounted.nodes,
                &mut mounted.keyed_nodes,
            );

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
        mounted
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
    pub fn lower(&self) -> InstructionBatch {
        self.mount().into_batch()
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
) -> MountedNode {
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
        );
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
            panic!("duplicate mounted node key: {key}");
        }
        keyed_nodes.push((key, mounted_node.clone()));
    }
    mounted_node
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
    use crate::authoring::{el, mc};

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
}
