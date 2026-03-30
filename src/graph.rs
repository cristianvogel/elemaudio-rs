//! Minimal Rust-native graph DSL for Elementary-style node composition.

use crate::{Instruction, InstructionBatch, NodeId};

/// A multichannel graph is a set of root nodes, one per output channel.
#[derive(Debug, Clone, Default)]
pub struct Graph {
    roots: Vec<Node>,
}

impl Graph {
    /// Creates an empty graph.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds one root node and returns the graph.
    pub fn with_root(mut self, node: Node) -> Self {
        self.roots.push(node);
        self
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
        let mut batch = InstructionBatch::new();
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
            lower_node(root, child_id, &mut next_id, &mut batch);

            batch.push(Instruction::AppendChild {
                parent_id: root_id,
                child_id,
                child_output_channel: 0,
            });
            lowered_roots.push(root_id);
        }

        batch.push(Instruction::ActivateRoots {
            roots: lowered_roots,
        });
        batch.push(Instruction::CommitUpdates);

        batch
    }
}

/// A graph node.
#[derive(Debug, Clone)]
pub struct Node {
    kind: String,
    props: serde_json::Value,
    children: Vec<Node>,
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
        }
    }
}

/// Functional helpers mirroring Elementary's `el.*` style.
pub mod el {
    use super::{Node, Value};

    /// Constant signal node.
    pub fn const_(value: f64) -> Node {
        const_with_key(None, value)
    }

    /// Constant signal node with an optional key.
    pub fn const_with_key(key: Option<&str>, value: f64) -> Node {
        match key {
            Some(key) => Node::new(
                "const",
                serde_json::json!({ "key": key, "value": value }),
                vec![],
            ),
            None => Node::new("const", serde_json::json!({ "value": value }), vec![]),
        }
    }

    /// Sine oscillator.
    pub fn sin(x: Node) -> Node {
        Node::new("sin", Value::Null, vec![x])
    }

    /// Band-limited cycle oscillator helper.
    pub fn cycle(rate: Node) -> Node {
        Node::new("cycle", Value::Null, vec![rate])
    }

    /// Phasor helper.
    pub fn phasor(rate: Node) -> Node {
        Node::new("phasor", Value::Null, vec![rate])
    }

    /// Less-than helper.
    pub fn le(left: Node, right: Node) -> Node {
        Node::new("le", Value::Null, vec![left, right])
    }

    /// Pulse train helper.
    pub fn train(rate: Node) -> Node {
        le(phasor(rate), const_(0.5))
    }

    /// Sample playback node.
    pub fn sample(props: serde_json::Value, trigger: Node, rate: Node) -> Node {
        Node::new("sample", props, vec![trigger, rate])
    }

    /// One-pole smoother helper.
    pub fn sm(x: Node) -> Node {
        Node::new("sm", Value::Null, vec![x])
    }
}

type Value = serde_json::Value;

fn lower_node(node: &Node, node_id: NodeId, next_id: &mut NodeId, batch: &mut InstructionBatch) {
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

    for child in &node.children {
        let child_id = *next_id;
        *next_id += 1;

        lower_node(child, child_id, next_id, batch);
        batch.push(Instruction::AppendChild {
            parent_id: node_id,
            child_id,
            child_output_channel: 0,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::el;
    use super::*;

    #[test]
    fn lowers_multichannel_graph_to_batch() {
        let graph = Graph::new()
            .with_root(el::cycle(el::sm(el::const_(220.0))))
            .with_root(el::cycle(el::sm(el::const_(220.0 * 1.618))));

        let batch = graph.lower();
        assert!(batch.to_json_string().contains("cycle"));
        assert!(batch.to_json_string().contains("root"));
    }
}
