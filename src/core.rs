use crate::graph::Node;

/// Node-or-number input accepted by core utilities.
#[derive(Debug, Clone)]
pub enum ElemNode {
    Node(Node),
    Number(f64),
}

impl From<Node> for ElemNode {
    fn from(node: Node) -> Self {
        Self::Node(node)
    }
}

impl From<f64> for ElemNode {
    fn from(value: f64) -> Self {
        Self::Number(value)
    }
}

/// Creates a node from a kind, props, and child inputs.
pub fn create_node(
    kind: impl Into<String>,
    props: serde_json::Value,
    children: impl IntoIterator<Item = ElemNode>,
) -> Node {
    Node::new(kind, props, children.into_iter().map(resolve).collect())
}

/// Returns whether the value is already a node.
pub fn is_node(value: &ElemNode) -> bool {
    matches!(value, ElemNode::Node(_))
}

/// Resolves a value into a node.
pub fn resolve(value: impl Into<ElemNode>) -> Node {
    match value.into() {
        ElemNode::Node(node) => node,
        ElemNode::Number(value) => {
            Node::new("const", serde_json::json!({ "value": value }), vec![])
        }
    }
}

/// Expands a node into one node per output channel.
///
/// The Rust graph model does not track the upstream `outputChannel` field,
/// so this returns cloned nodes for the requested fan-out.
pub fn unpack(node: Node, num_channels: usize) -> Vec<Node> {
    vec![node; num_channels]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_turns_numbers_into_const_nodes() {
        let node = resolve(220.0);

        assert_eq!(node.kind(), "const");
        assert_eq!(node.props()["value"], 220.0);
        assert!(node.children().is_empty());
    }

    #[test]
    fn resolve_leaves_nodes_unchanged() {
        let node = Node::new("sin", serde_json::Value::Null, vec![]);

        match resolve(node.clone()) {
            resolved if resolved.kind() == node.kind() => {}
            _ => panic!("expected resolve to keep the node as-is"),
        }
    }

    #[test]
    fn is_node_detects_node_values() {
        assert!(is_node(&ElemNode::Node(Node::new(
            "sr",
            serde_json::Value::Null,
            vec![],
        ))));
        assert!(!is_node(&ElemNode::Number(1.0)));
    }

    #[test]
    fn create_node_resolves_children() {
        let node = create_node(
            "add",
            serde_json::Value::Null,
            [ElemNode::from(1.0), ElemNode::from(2.0)],
        );

        assert_eq!(node.kind(), "add");
        assert_eq!(node.children().len(), 2);
        assert_eq!(node.children()[0].kind(), "const");
        assert_eq!(node.children()[0].props()["value"], 1.0);
        assert_eq!(node.children()[1].props()["value"], 2.0);
    }

    #[test]
    fn unpack_clones_the_node_for_each_channel() {
        let node = Node::new("meter", serde_json::json!({ "name": "out" }), vec![]);

        let unpacked = unpack(node.clone(), 3);

        assert_eq!(unpacked.len(), 3);
        for child in unpacked {
            assert_eq!(child.kind(), node.kind());
            assert_eq!(child.props(), node.props());
        }
    }
}
