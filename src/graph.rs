//! Minimal Rust-native graph DSL for Elementary-style node composition.

use crate::{Instruction, InstructionBatch, NodeId};

/// A multichannel graph is a set of root nodes, one per output channel.
#[derive(Debug, Clone, Default)]
pub struct Graph {
    roots: Vec<Node>,
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

    /// Adds one root node and returns the graph.
    pub fn root(mut self, node: Node) -> Self {
        self.roots.push(node);
        self
    }

    /// Backward-compatible alias for `root`.
    pub fn with_root(self, node: Node) -> Self {
        self.root(node)
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
                child_output_channel: 0,
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

    #[cfg(test)]
    pub(crate) fn kind(&self) -> &str {
        &self.kind
    }

    #[cfg(test)]
    pub(crate) fn props(&self) -> &serde_json::Value {
        &self.props
    }

    #[cfg(test)]
    pub(crate) fn children(&self) -> &[Node] {
        &self.children
    }
}

/// Multichannel helpers mirroring Elementary's `el.mc.*` surface.
pub mod mc {
    use super::Node;
    use crate::{create_node, unpack, ElemNode};

    fn channels_and_props(mut props: serde_json::Value) -> (usize, serde_json::Value) {
        let channels = props
            .get("channels")
            .and_then(|value| value.as_u64())
            .expect("mc helpers require a positive `channels` prop")
            as usize;

        if let serde_json::Value::Object(map) = &mut props {
            map.remove("channels");
        }

        (channels, props)
    }

    fn unpack_mc(
        kind: &str,
        props: serde_json::Value,
        children: impl IntoIterator<Item = ElemNode>,
    ) -> Vec<Node> {
        let (channels, props) = channels_and_props(props);
        unpack(create_node(kind, props, children), channels)
    }

    /// Multichannel sample playback.
    pub fn sample(props: serde_json::Value, gate: impl Into<ElemNode>) -> Vec<Node> {
        unpack_mc("mc.sample", props, [gate.into()])
    }

    /// Multichannel sample sequence playback.
    pub fn sampleseq(props: serde_json::Value, time: impl Into<ElemNode>) -> Vec<Node> {
        unpack_mc("mc.sampleseq", props, [time.into()])
    }

    /// Multichannel sample sequence playback with stretch/shift.
    pub fn sampleseq2(props: serde_json::Value, time: impl Into<ElemNode>) -> Vec<Node> {
        unpack_mc("mc.sampleseq2", props, [time.into()])
    }

    /// Multichannel table lookup.
    pub fn table(props: serde_json::Value, t: impl Into<ElemNode>) -> Vec<Node> {
        unpack_mc("mc.table", props, [t.into()])
    }

    /// Multichannel capture node.
    pub fn capture(
        props: serde_json::Value,
        g: impl Into<ElemNode>,
        args: impl IntoIterator<Item = ElemNode>,
    ) -> Vec<Node> {
        let children = std::iter::once(g.into()).chain(args.into_iter());
        unpack_mc("mc.capture", props, children)
    }
}

/// Functional helpers mirroring Elementary's `el.*` style, plus a generic
/// constructor for custom node kinds.
pub mod el {
    use super::{Node, Value};
    use crate::core::{resolve, ElemNode};

    fn empty_props() -> Value {
        Value::Object(Default::default())
    }

    fn node0(kind: &str) -> Node {
        Node::new(kind, Value::Null, vec![])
    }

    fn node1(kind: &str, child: impl Into<ElemNode>) -> Node {
        Node::new(kind, Value::Null, vec![resolve(child)])
    }

    fn node2(kind: &str, left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        Node::new(kind, Value::Null, vec![resolve(left), resolve(right)])
    }

    fn node3(
        kind: &str,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
        c: impl Into<ElemNode>,
    ) -> Node {
        Node::new(kind, Value::Null, vec![resolve(a), resolve(b), resolve(c)])
    }

    fn node6(
        kind: &str,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
        c: impl Into<ElemNode>,
        d: impl Into<ElemNode>,
        e: impl Into<ElemNode>,
        f: impl Into<ElemNode>,
    ) -> Node {
        Node::new(
            kind,
            Value::Null,
            vec![
                resolve(a),
                resolve(b),
                resolve(c),
                resolve(d),
                resolve(e),
                resolve(f),
            ],
        )
    }

    fn node_props0(kind: &str, props: Value) -> Node {
        Node::new(kind, props, vec![])
    }

    fn node_props1(kind: &str, props: Value, child: impl Into<ElemNode>) -> Node {
        Node::new(kind, props, vec![resolve(child)])
    }

    fn node_props2(
        kind: &str,
        props: Value,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
    ) -> Node {
        Node::new(kind, props, vec![resolve(a), resolve(b)])
    }

    fn node_props3(
        kind: &str,
        props: Value,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
        c: impl Into<ElemNode>,
    ) -> Node {
        Node::new(kind, props, vec![resolve(a), resolve(b), resolve(c)])
    }

    fn node_props4(
        kind: &str,
        props: Value,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
        c: impl Into<ElemNode>,
        d: impl Into<ElemNode>,
    ) -> Node {
        Node::new(
            kind,
            props,
            vec![resolve(a), resolve(b), resolve(c), resolve(d)],
        )
    }

    fn node_props_variadic<T>(kind: &str, props: Value, args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new(kind, props, args.into_iter().map(resolve).collect())
    }

    /// Constant signal node.
    pub fn constant(props: Value) -> Node {
        Node::new("const", props, vec![])
    }

    /// Constant signal node with the Rust-friendly helper name.
    pub fn const_(value: f64) -> Node {
        constant(serde_json::json!({ "value": value }))
    }

    /// Constant signal node with an optional key.
    pub fn const_with_key(key: Option<&str>, value: f64) -> Node {
        match key {
            Some(key) => constant(serde_json::json!({ "key": key, "value": value })),
            None => constant(serde_json::json!({ "value": value })),
        }
    }

    /// Alias for the upstream `const` helper.
    pub fn r#const(props: Value) -> Node {
        constant(props)
    }

    /// Creates a custom node kind with explicit props and children.
    pub fn custom<T>(
        kind: impl Into<String>,
        props: Value,
        children: impl IntoIterator<Item = T>,
    ) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new(kind, props, children.into_iter().map(resolve).collect())
    }

    pub fn sr() -> Node {
        node0("sr")
    }
    pub fn time() -> Node {
        node0("time")
    }
    pub fn counter(child: impl Into<ElemNode>) -> Node {
        node1("counter", child)
    }
    pub fn accum(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("accum", left, right)
    }
    pub fn phasor(child: impl Into<ElemNode>) -> Node {
        node1("phasor", child)
    }
    pub fn syncphasor(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("sphasor", left, right)
    }
    /// Alias for the upstream `sphasor` helper.
    pub fn sphasor(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        syncphasor(left, right)
    }
    pub fn latch(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("latch", left, right)
    }
    pub fn maxhold(props: Value, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        node_props2("maxhold", props, a, b)
    }
    pub fn once(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("once", props, child)
    }
    pub fn rand(props: Option<Value>) -> Node {
        Node::new("rand", props.unwrap_or_else(empty_props), vec![])
    }

    pub fn metro(props: Option<Value>) -> Node {
        Node::new("metro", props.unwrap_or_else(empty_props), vec![])
    }
    pub fn tap_in(props: Value) -> Node {
        node_props0("tapIn", props)
    }
    pub fn tap_out(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("tapOut", props, child)
    }
    pub fn meter(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("meter", props, child)
    }
    pub fn snapshot(props: Value, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        node_props2("snapshot", props, a, b)
    }
    pub fn scope<T>(props: Value, args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        node_props_variadic("scope", props, args)
    }
    pub fn fft(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("fft", props, child)
    }
    pub fn capture(props: Value, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        node_props2("capture", props, a, b)
    }
    pub fn table(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("table", props, child)
    }
    pub fn convolve(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("convolve", props, child)
    }
    pub fn seq(props: Value, trigger: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node_props2("seq", props, trigger, reset)
    }
    pub fn seq2(props: Value, trigger: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node_props2("seq2", props, trigger, reset)
    }
    pub fn sparseq(props: Value, trigger: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node_props2("sparseq", props, trigger, reset)
    }
    pub fn sparseq2(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sparseq2", props, child)
    }
    pub fn sampleseq(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sampleseq", props, child)
    }
    pub fn sampleseq2(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sampleseq2", props, child)
    }
    pub fn pole(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("pole", left, right)
    }
    pub fn env(a: impl Into<ElemNode>, b: impl Into<ElemNode>, c: impl Into<ElemNode>) -> Node {
        node3("env", a, b, c)
    }
    pub fn z(child: impl Into<ElemNode>) -> Node {
        node1("z", child)
    }
    pub fn delay(
        props: Value,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
        c: impl Into<ElemNode>,
    ) -> Node {
        node_props3("delay", props, a, b, c)
    }
    pub fn sdelay(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sdelay", props, child)
    }
    pub fn prewarp(child: impl Into<ElemNode>) -> Node {
        node1("prewarp", child)
    }
    pub fn mm1p(props: Value, fc: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        node_props2("mm1p", props, fc, x)
    }
    pub fn svf(
        props: Value,
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        node_props3("svf", props, fc, q, x)
    }
    pub fn svfshelf(
        props: Value,
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        gain: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        node_props4("svfshelf", props, fc, q, gain, x)
    }
    pub fn biquad(
        b0: impl Into<ElemNode>,
        b1: impl Into<ElemNode>,
        b2: impl Into<ElemNode>,
        a1: impl Into<ElemNode>,
        a2: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        node6("biquad", b0, b1, b2, a1, a2, x)
    }

    /// Sine oscillator.
    pub fn sin(x: impl Into<ElemNode>) -> Node {
        node1("sin", x)
    }

    /// Cosine helper.
    pub fn cos(x: impl Into<ElemNode>) -> Node {
        node1("cos", x)
    }

    /// Tangent helper.
    pub fn tan(x: impl Into<ElemNode>) -> Node {
        node1("tan", x)
    }

    /// Hyperbolic tangent helper.
    pub fn tanh(x: impl Into<ElemNode>) -> Node {
        node1("tanh", x)
    }

    /// Inverse hyperbolic sine helper.
    pub fn asinh(x: impl Into<ElemNode>) -> Node {
        node1("asinh", x)
    }

    /// Natural log helper.
    pub fn ln(x: impl Into<ElemNode>) -> Node {
        node1("ln", x)
    }

    /// Log helper.
    pub fn log(x: impl Into<ElemNode>) -> Node {
        node1("log", x)
    }

    /// Base-2 log helper.
    pub fn log2(x: impl Into<ElemNode>) -> Node {
        node1("log2", x)
    }

    /// Ceiling helper.
    pub fn ceil(x: impl Into<ElemNode>) -> Node {
        node1("ceil", x)
    }

    /// Floor helper.
    pub fn floor(x: impl Into<ElemNode>) -> Node {
        node1("floor", x)
    }

    /// Round helper.
    pub fn round(x: impl Into<ElemNode>) -> Node {
        node1("round", x)
    }

    /// Square root helper.
    pub fn sqrt(x: impl Into<ElemNode>) -> Node {
        node1("sqrt", x)
    }

    /// Exponential helper.
    pub fn exp(x: impl Into<ElemNode>) -> Node {
        node1("exp", x)
    }

    /// Absolute value helper.
    pub fn abs(x: impl Into<ElemNode>) -> Node {
        node1("abs", x)
    }

    /// Less-than helper.
    pub fn le(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("le", left, right)
    }

    /// Less-than-or-equal helper.
    pub fn leq(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("leq", left, right)
    }

    /// Greater-than helper.
    pub fn ge(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("ge", left, right)
    }

    /// Greater-than-or-equal helper.
    pub fn geq(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("geq", left, right)
    }

    /// Power helper.
    pub fn pow(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("pow", left, right)
    }

    /// Equality helper.
    pub fn eq(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("eq", left, right)
    }

    /// Logical and helper.
    pub fn and(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("and", left, right)
    }

    /// Logical or helper.
    pub fn or(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("or", left, right)
    }

    /// Addition helper.
    pub fn add<T>(args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new("add", Value::Null, args.into_iter().map(resolve).collect())
    }

    /// Subtraction helper.
    pub fn sub<T>(args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new("sub", Value::Null, args.into_iter().map(resolve).collect())
    }

    /// Multiplication helper.
    pub fn mul<T>(args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new("mul", Value::Null, args.into_iter().map(resolve).collect())
    }

    /// Division helper.
    pub fn div(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        Node::new("div", Value::Null, vec![resolve(left), resolve(right)])
    }

    /// Modulo helper.
    pub fn r#mod<T>(args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new("mod", Value::Null, args.into_iter().map(resolve).collect())
    }

    /// Minimum helper.
    pub fn min<T>(args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new("min", Value::Null, args.into_iter().map(resolve).collect())
    }

    /// Maximum helper.
    pub fn max<T>(args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        Node::new("max", Value::Null, args.into_iter().map(resolve).collect())
    }

    /// Alias for the upstream `in` helper.
    pub fn identity(props: Value, x: Option<Node>) -> Node {
        match x {
            Some(x) => Node::new("in", props, vec![x]),
            None => Node::new("in", props, vec![]),
        }
    }

    /// Rust-friendly alias for `in`.
    pub fn r#in(props: Value, x: Option<Node>) -> Node {
        identity(props, x)
    }

    /// Band-limited cycle oscillator helper.
    pub fn cycle(rate: impl Into<ElemNode>) -> Node {
        sin(mul([const_(2.0 * std::f64::consts::PI), phasor(rate)]))
    }

    /// Pulse train helper.
    pub fn train(rate: impl Into<ElemNode>) -> Node {
        le(phasor(rate), const_(0.5))
    }

    /// Saw oscillator helper.
    pub fn saw(rate: impl Into<ElemNode>) -> Node {
        sub([mul([const_(2.0), phasor(rate)]), const_(1.0)])
    }

    /// Square oscillator helper.
    pub fn square(rate: impl Into<ElemNode>) -> Node {
        sub([mul([const_(2.0), train(rate)]), const_(1.0)])
    }

    /// Triangle oscillator helper.
    pub fn triangle(rate: impl Into<ElemNode>) -> Node {
        mul([const_(2.0), sub([const_(0.5), abs(saw(rate))])])
    }

    /// Band-limited polyBLEP saw oscillator.
    pub fn blepsaw(rate: impl Into<ElemNode>) -> Node {
        node1("blepsaw", rate)
    }

    /// Band-limited polyBLEP square oscillator.
    pub fn blepsquare(rate: impl Into<ElemNode>) -> Node {
        node1("blepsquare", rate)
    }

    /// Band-limited polyBLEP triangle oscillator.
    pub fn bleptriangle(rate: impl Into<ElemNode>) -> Node {
        node1("bleptriangle", rate)
    }

    /// White noise helper.
    pub fn noise(props: Option<Value>) -> Node {
        sub([mul([const_(2.0), rand(props)]), const_(1.0)])
    }

    /// Pink noise helper.
    pub fn pinknoise(props: Option<Value>) -> Node {
        pink(noise(props))
    }

    /// Milliseconds to samples.
    pub fn ms2samps(t: impl Into<ElemNode>) -> Node {
        let t = resolve(t);
        mul([sr(), div(t, const_(1000.0))])
    }

    /// Time constant to pole.
    pub fn tau2pole(t: impl Into<ElemNode>) -> Node {
        let t = resolve(t);
        exp(div(const_(-1.0), mul([t, sr()])))
    }

    /// Decibels to gain.
    pub fn db2gain(db: impl Into<ElemNode>) -> Node {
        let db = resolve(db);
        pow(const_(10.0), mul([db, const_(1.0 / 20.0)]))
    }

    /// Gain to decibels.
    pub fn gain2db(gain: impl Into<ElemNode>) -> Node {
        let gain = resolve(gain);
        select(
            ge(gain.clone(), const_(0.0)),
            max([const_(-120.0), mul([const_(20.0), log(gain)])]),
            const_(-120.0),
        )
    }

    /// Linear select helper.
    pub fn select(g: impl Into<ElemNode>, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        let g = resolve(g);
        let a = resolve(a);
        let b = resolve(b);
        add([mul([g.clone(), a]), mul([sub([const_(1.0), g]), b])])
    }

    /// Hann window helper.
    pub fn hann(t: impl Into<ElemNode>) -> Node {
        let t = resolve(t);
        mul([
            const_(0.5),
            sub([
                const_(1.0),
                cos(mul([const_(2.0 * std::f64::consts::PI), t])),
            ]),
        ])
    }

    /// One-pole smoothing.
    pub fn smooth(p: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        let p = resolve(p);
        let x = resolve(x);
        pole(p.clone(), mul([sub([const_(1.0), p]), x]))
    }

    /// 20ms smoothing helper.
    pub fn sm(x: impl Into<ElemNode>) -> Node {
        smooth(tau2pole(const_(0.02)), x)
    }

    /// Simple one-zero filter.
    pub fn zero(b0: impl Into<ElemNode>, b1: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        let b0 = resolve(b0);
        let b1 = resolve(b1);
        let x = resolve(x);
        sub([mul([b0, x.clone()]), mul([b1, z(x)])])
    }

    /// DC blocking filter.
    pub fn dcblock(x: impl Into<ElemNode>) -> Node {
        let x = resolve(x);
        pole(const_(0.995), zero(const_(1.0), const_(1.0), x))
    }

    /// Direct form 1 helper.
    pub fn df11(
        b0: impl Into<ElemNode>,
        b1: impl Into<ElemNode>,
        a1: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let b0 = resolve(b0);
        let b1 = resolve(b1);
        let a1 = resolve(a1);
        let x = resolve(x);
        pole(a1, zero(b0, b1, x))
    }

    /// Lowpass filter.
    pub fn lowpass(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let x = resolve(x);
        svf(serde_json::json!({ "mode": "lowpass" }), fc, q, x)
    }

    /// Highpass filter.
    pub fn highpass(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let x = resolve(x);
        svf(serde_json::json!({ "mode": "highpass" }), fc, q, x)
    }

    /// Bandpass filter.
    pub fn bandpass(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let x = resolve(x);
        svf(serde_json::json!({ "mode": "bandpass" }), fc, q, x)
    }

    /// Notch filter.
    pub fn notch(fc: impl Into<ElemNode>, q: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let x = resolve(x);
        svf(serde_json::json!({ "mode": "notch" }), fc, q, x)
    }

    /// Allpass filter.
    pub fn allpass(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let x = resolve(x);
        svf(serde_json::json!({ "mode": "allpass" }), fc, q, x)
    }

    /// Peak EQ filter.
    pub fn peak(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        gain_decibels: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let gain_decibels = resolve(gain_decibels);
        let x = resolve(x);
        svfshelf(
            serde_json::json!({ "mode": "peak" }),
            fc,
            q,
            gain_decibels,
            x,
        )
    }

    /// Low shelf filter.
    pub fn lowshelf(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        gain_decibels: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let gain_decibels = resolve(gain_decibels);
        let x = resolve(x);
        svfshelf(
            serde_json::json!({ "mode": "lowshelf" }),
            fc,
            q,
            gain_decibels,
            x,
        )
    }

    /// High shelf filter.
    pub fn highshelf(
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        gain_decibels: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let gain_decibels = resolve(gain_decibels);
        let x = resolve(x);
        svfshelf(
            serde_json::json!({ "mode": "highshelf" }),
            fc,
            q,
            gain_decibels,
            x,
        )
    }

    /// Pinking filter.
    pub fn pink(x: impl Into<ElemNode>) -> Node {
        let x = resolve(x);
        let clip = |lower: Node, upper: Node, x: Node| min([upper, max([lower, x])]);

        clip(
            const_(-1.0),
            const_(1.0),
            mul([
                db2gain(const_(-30.0)),
                add([
                    pole(const_(0.99765), mul([x.clone(), const_(0.099046)])),
                    pole(const_(0.963), mul([x.clone(), const_(0.2965164)])),
                    pole(const_(0.57), mul([x.clone(), const_(1.0526913)])),
                    mul([const_(0.1848), x]),
                ]),
            ]),
        )
    }

    /// Exponential ADSR envelope.
    pub fn adsr(
        attack_sec: impl Into<ElemNode>,
        decay_sec: impl Into<ElemNode>,
        sustain: impl Into<ElemNode>,
        release_sec: impl Into<ElemNode>,
        gate: impl Into<ElemNode>,
    ) -> Node {
        let attack_sec = resolve(attack_sec);
        let decay_sec = resolve(decay_sec);
        let sustain = resolve(sustain);
        let release_sec = resolve(release_sec);
        let gate = resolve(gate);
        let atk_samps = mul([attack_sec.clone(), sr()]);
        let atk_gate = le(counter(gate.clone()), atk_samps);
        let target_value = select(
            gate.clone(),
            select(atk_gate.clone(), const_(1.0), sustain.clone()),
            const_(0.0),
        );
        let t60 = max([
            const_(0.0001),
            select(
                gate.clone(),
                select(atk_gate, attack_sec, decay_sec),
                release_sec,
            ),
        ]);
        let p = tau2pole(div(t60, const_(6.91)));

        smooth(p, target_value)
    }

    /// Compressor.
    pub fn compress(
        attack_ms: Node,
        release_ms: Node,
        threshold: Node,
        ratio: Node,
        sidechain: Node,
        xn: Node,
    ) -> Node {
        let env = env(
            tau2pole(mul([const_(0.001), attack_ms])),
            tau2pole(mul([const_(0.001), release_ms])),
            sidechain,
        );

        let env_decibels = gain2db(env);
        let adjusted_ratio = sub([const_(1.0), div(const_(1.0), ratio)]);
        let gain = mul([adjusted_ratio, sub([threshold, env_decibels])]);
        let clean_gain = min([const_(0.0), gain]);
        let compressed_gain = db2gain(clean_gain);

        mul([xn, compressed_gain])
    }

    /// Soft-knee compressor.
    pub fn skcompress(
        attack_ms: Node,
        release_ms: Node,
        threshold: Node,
        ratio: Node,
        knee_width: Node,
        sidechain: Node,
        xn: Node,
    ) -> Node {
        let env = env(
            tau2pole(mul([const_(0.001), attack_ms])),
            tau2pole(mul([const_(0.001), release_ms])),
            sidechain,
        );

        let env_decibels = gain2db(env);
        let lower_knee_bound = sub([threshold.clone(), div(knee_width.clone(), const_(2.0))]);
        let upper_knee_bound = add([threshold.clone(), div(knee_width.clone(), const_(2.0))]);
        let is_in_soft_knee_range = and(
            geq(env_decibels.clone(), lower_knee_bound.clone()),
            leq(env_decibels.clone(), upper_knee_bound.clone()),
        );
        let adjusted_ratio = sub([const_(1.0), div(const_(1.0), ratio)]);
        let gain = select(
            is_in_soft_knee_range,
            mul([
                div(adjusted_ratio.clone(), const_(2.0)),
                mul([
                    div(
                        sub([env_decibels.clone(), lower_knee_bound.clone()]),
                        knee_width.clone(),
                    ),
                    sub([lower_knee_bound.clone(), env_decibels.clone()]),
                ]),
            ]),
            mul([adjusted_ratio, sub([threshold, env_decibels])]),
        );
        let clean_gain = min([const_(0.0), gain]);
        let compressed_gain = db2gain(clean_gain);

        mul([xn, compressed_gain])
    }

    /// Sample playback node.
    pub fn sample(props: Value, trigger: impl Into<ElemNode>, rate: impl Into<ElemNode>) -> Node {
        Node::new("sample", props, vec![resolve(trigger), resolve(rate)])
    }
}

type Value = serde_json::Value;

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
            child_output_channel: 0,
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
    use super::el;
    use super::mc;
    use super::*;
    use crate::ElemNode;

    fn assert_node(node: &Node, kind: &str, props: serde_json::Value, child_count: usize) {
        assert_eq!(node.kind(), kind);
        assert_eq!(node.props(), &props);
        assert_eq!(node.children().len(), child_count);
    }

    fn assert_nodes(nodes: &[Node], kind: &str, props: serde_json::Value, child_count: usize) {
        assert!(!nodes.is_empty());
        for node in nodes {
            assert_node(node, kind, props.clone(), child_count);
        }
    }

    fn node(value: f64) -> Node {
        el::const_(value)
    }

    #[test]
    fn covers_el_helper_surface() {
        let core_math_signal = [
            ("sr", el::sr(), "sr", serde_json::Value::Null, 0),
            ("time", el::time(), "time", serde_json::Value::Null, 0),
            (
                "counter",
                el::counter(node(1.0)),
                "counter",
                serde_json::Value::Null,
                1,
            ),
            (
                "accum",
                el::accum(node(1.0), node(0.0)),
                "accum",
                serde_json::Value::Null,
                2,
            ),
            (
                "phasor",
                el::phasor(node(440.0)),
                "phasor",
                serde_json::Value::Null,
                1,
            ),
            (
                "syncphasor",
                el::syncphasor(node(1.0), node(0.0)),
                "sphasor",
                serde_json::Value::Null,
                2,
            ),
            (
                "latch",
                el::latch(node(1.0), node(0.0)),
                "latch",
                serde_json::Value::Null,
                2,
            ),
            ("sin", el::sin(node(0.0)), "sin", serde_json::Value::Null, 1),
            ("cos", el::cos(node(0.0)), "cos", serde_json::Value::Null, 1),
            ("tan", el::tan(node(0.0)), "tan", serde_json::Value::Null, 1),
            (
                "tanh",
                el::tanh(node(0.0)),
                "tanh",
                serde_json::Value::Null,
                1,
            ),
            (
                "asinh",
                el::asinh(node(0.0)),
                "asinh",
                serde_json::Value::Null,
                1,
            ),
            ("ln", el::ln(node(1.0)), "ln", serde_json::Value::Null, 1),
            ("log", el::log(node(1.0)), "log", serde_json::Value::Null, 1),
            (
                "log2",
                el::log2(node(1.0)),
                "log2",
                serde_json::Value::Null,
                1,
            ),
            (
                "ceil",
                el::ceil(node(1.0)),
                "ceil",
                serde_json::Value::Null,
                1,
            ),
            (
                "floor",
                el::floor(node(1.0)),
                "floor",
                serde_json::Value::Null,
                1,
            ),
            (
                "round",
                el::round(node(1.0)),
                "round",
                serde_json::Value::Null,
                1,
            ),
            (
                "sqrt",
                el::sqrt(node(1.0)),
                "sqrt",
                serde_json::Value::Null,
                1,
            ),
            ("exp", el::exp(node(1.0)), "exp", serde_json::Value::Null, 1),
            (
                "abs",
                el::abs(node(-1.0)),
                "abs",
                serde_json::Value::Null,
                1,
            ),
            (
                "le",
                el::le(node(1.0), node(2.0)),
                "le",
                serde_json::Value::Null,
                2,
            ),
            (
                "leq",
                el::leq(node(1.0), node(2.0)),
                "leq",
                serde_json::Value::Null,
                2,
            ),
            (
                "ge",
                el::ge(node(1.0), node(2.0)),
                "ge",
                serde_json::Value::Null,
                2,
            ),
            (
                "geq",
                el::geq(node(1.0), node(2.0)),
                "geq",
                serde_json::Value::Null,
                2,
            ),
            (
                "pow",
                el::pow(node(1.0), node(2.0)),
                "pow",
                serde_json::Value::Null,
                2,
            ),
            (
                "eq",
                el::eq(node(1.0), node(2.0)),
                "eq",
                serde_json::Value::Null,
                2,
            ),
            (
                "and",
                el::and(node(1.0), node(0.0)),
                "and",
                serde_json::Value::Null,
                2,
            ),
            (
                "or",
                el::or(node(1.0), node(0.0)),
                "or",
                serde_json::Value::Null,
                2,
            ),
            (
                "add",
                el::add([node(1.0), node(2.0)]),
                "add",
                serde_json::Value::Null,
                2,
            ),
            (
                "sub",
                el::sub([node(1.0), node(2.0)]),
                "sub",
                serde_json::Value::Null,
                2,
            ),
            (
                "mul",
                el::mul([node(1.0), node(2.0)]),
                "mul",
                serde_json::Value::Null,
                2,
            ),
            (
                "div",
                el::div(node(1.0), node(2.0)),
                "div",
                serde_json::Value::Null,
                2,
            ),
            (
                "mod",
                el::r#mod([node(1.0), node(2.0)]),
                "mod",
                serde_json::Value::Null,
                2,
            ),
            (
                "min",
                el::min([node(1.0), node(2.0)]),
                "min",
                serde_json::Value::Null,
                2,
            ),
            (
                "max",
                el::max([node(1.0), node(2.0)]),
                "max",
                serde_json::Value::Null,
                2,
            ),
            (
                "ms2samps",
                el::ms2samps(node(20.0)),
                "mul",
                serde_json::Value::Null,
                2,
            ),
            (
                "tau2pole",
                el::tau2pole(node(0.02)),
                "exp",
                serde_json::Value::Null,
                1,
            ),
            (
                "db2gain",
                el::db2gain(node(-6.0)),
                "pow",
                serde_json::Value::Null,
                2,
            ),
            (
                "gain2db",
                el::gain2db(node(1.0)),
                "add",
                serde_json::Value::Null,
                2,
            ),
            (
                "select",
                el::select(node(1.0), node(2.0), node(3.0)),
                "add",
                serde_json::Value::Null,
                2,
            ),
            (
                "hann",
                el::hann(node(0.5)),
                "mul",
                serde_json::Value::Null,
                2,
            ),
            (
                "cycle",
                el::cycle(node(440.0)),
                "sin",
                serde_json::Value::Null,
                1,
            ),
            (
                "train",
                el::train(node(440.0)),
                "le",
                serde_json::Value::Null,
                2,
            ),
            (
                "saw",
                el::saw(node(440.0)),
                "sub",
                serde_json::Value::Null,
                2,
            ),
            (
                "square",
                el::square(node(440.0)),
                "sub",
                serde_json::Value::Null,
                2,
            ),
            (
                "triangle",
                el::triangle(node(440.0)),
                "mul",
                serde_json::Value::Null,
                2,
            ),
            (
                "blepsaw",
                el::blepsaw(node(440.0)),
                "blepsaw",
                serde_json::Value::Null,
                1,
            ),
            (
                "blepsquare",
                el::blepsquare(node(440.0)),
                "blepsquare",
                serde_json::Value::Null,
                1,
            ),
            (
                "bleptriangle",
                el::bleptriangle(node(440.0)),
                "bleptriangle",
                serde_json::Value::Null,
                1,
            ),
            ("noise", el::noise(None), "sub", serde_json::Value::Null, 2),
            (
                "pinknoise",
                el::pinknoise(None),
                "min",
                serde_json::Value::Null,
                2,
            ),
            (
                "smooth",
                el::smooth(node(0.5), node(1.0)),
                "pole",
                serde_json::Value::Null,
                2,
            ),
            ("sm", el::sm(node(1.0)), "pole", serde_json::Value::Null, 2),
            (
                "zero",
                el::zero(node(1.0), node(0.5), node(0.25)),
                "sub",
                serde_json::Value::Null,
                2,
            ),
            (
                "dcblock",
                el::dcblock(node(1.0)),
                "pole",
                serde_json::Value::Null,
                2,
            ),
            (
                "df11",
                el::df11(node(1.0), node(0.5), node(0.25), node(0.125)),
                "pole",
                serde_json::Value::Null,
                2,
            ),
            (
                "lowpass",
                el::lowpass(node(220.0), node(0.707), node(1.0)),
                "svf",
                serde_json::json!({"mode":"lowpass"}),
                3,
            ),
            (
                "highpass",
                el::highpass(node(220.0), node(0.707), node(1.0)),
                "svf",
                serde_json::json!({"mode":"highpass"}),
                3,
            ),
            (
                "bandpass",
                el::bandpass(node(220.0), node(0.707), node(1.0)),
                "svf",
                serde_json::json!({"mode":"bandpass"}),
                3,
            ),
            (
                "notch",
                el::notch(node(220.0), node(0.707), node(1.0)),
                "svf",
                serde_json::json!({"mode":"notch"}),
                3,
            ),
            (
                "allpass",
                el::allpass(node(220.0), node(0.707), node(1.0)),
                "svf",
                serde_json::json!({"mode":"allpass"}),
                3,
            ),
            (
                "peak",
                el::peak(node(220.0), node(0.707), node(3.0), node(1.0)),
                "svfshelf",
                serde_json::json!({"mode":"peak"}),
                4,
            ),
            (
                "lowshelf",
                el::lowshelf(node(220.0), node(0.707), node(3.0), node(1.0)),
                "svfshelf",
                serde_json::json!({"mode":"lowshelf"}),
                4,
            ),
            (
                "highshelf",
                el::highshelf(node(220.0), node(0.707), node(3.0), node(1.0)),
                "svfshelf",
                serde_json::json!({"mode":"highshelf"}),
                4,
            ),
            (
                "pink",
                el::pink(node(1.0)),
                "min",
                serde_json::Value::Null,
                2,
            ),
            (
                "adsr",
                el::adsr(node(0.1), node(0.1), node(0.5), node(0.2), node(1.0)),
                "pole",
                serde_json::Value::Null,
                2,
            ),
            (
                "compress",
                el::compress(
                    node(10.0),
                    node(50.0),
                    node(-12.0),
                    node(2.0),
                    node(1.0),
                    node(1.0),
                ),
                "mul",
                serde_json::Value::Null,
                2,
            ),
            (
                "skcompress",
                el::skcompress(
                    node(10.0),
                    node(50.0),
                    node(-12.0),
                    node(2.0),
                    node(6.0),
                    node(1.0),
                    node(1.0),
                ),
                "mul",
                serde_json::Value::Null,
                2,
            ),
            (
                "sample",
                el::sample(serde_json::json!({"path": "a.wav"}), node(1.0), node(1.0)),
                "sample",
                serde_json::json!({"path": "a.wav"}),
                2,
            ),
        ];

        for (_, node, kind, props, child_count) in core_math_signal {
            assert_node(&node, kind, props, child_count);
        }
    }

    #[test]
    fn numeric_literals_coerce_through_helpers() {
        let div = el::div(4.0, 2.0);
        let phasor = el::phasor(220.0);
        let cycle = el::cycle(110.0);

        assert_node(&div, "div", serde_json::Value::Null, 2);
        assert_node(&phasor, "phasor", serde_json::Value::Null, 1);
        assert_node(&cycle, "sin", serde_json::Value::Null, 1);
    }

    #[test]
    fn covers_props_and_custom_helpers() {
        let cases = [
            (
                "constant",
                el::constant(serde_json::json!({"value": 1.0})),
                "const",
                serde_json::json!({"value": 1.0}),
                0,
            ),
            (
                "const_",
                el::const_(1.0),
                "const",
                serde_json::json!({"value": 1.0}),
                0,
            ),
            (
                "const_with_key",
                el::const_with_key(Some("a"), 1.0),
                "const",
                serde_json::json!({"key":"a","value":1.0}),
                0,
            ),
            (
                "const alias",
                el::r#const(serde_json::json!({"value": 2.0})),
                "const",
                serde_json::json!({"value": 2.0}),
                0,
            ),
            (
                "custom",
                el::custom("my.node", serde_json::json!({"x": 1}), [node(1.0)]),
                "my.node",
                serde_json::json!({"x": 1}),
                1,
            ),
            (
                "maxhold",
                el::maxhold(serde_json::json!({"hold": 10.0}), node(1.0), node(0.0)),
                "maxhold",
                serde_json::json!({"hold": 10.0}),
                2,
            ),
            (
                "once",
                el::once(serde_json::json!({"arm": true}), node(1.0)),
                "once",
                serde_json::json!({"arm": true}),
                1,
            ),
            (
                "rand",
                el::rand(None),
                "rand",
                serde_json::Value::Object(Default::default()),
                0,
            ),
            (
                "metro",
                el::metro(Some(serde_json::json!({"interval": 250}))),
                "metro",
                serde_json::json!({"interval": 250}),
                0,
            ),
            (
                "tap_in",
                el::tap_in(serde_json::json!({"name": "foo"})),
                "tapIn",
                serde_json::json!({"name": "foo"}),
                0,
            ),
            (
                "tap_out",
                el::tap_out(serde_json::json!({"name": "foo"}), node(1.0)),
                "tapOut",
                serde_json::json!({"name": "foo"}),
                1,
            ),
            (
                "meter",
                el::meter(serde_json::json!({"name": "out"}), node(1.0)),
                "meter",
                serde_json::json!({"name": "out"}),
                1,
            ),
            (
                "snapshot",
                el::snapshot(serde_json::json!({"name": "snap"}), node(1.0), node(0.0)),
                "snapshot",
                serde_json::json!({"name": "snap"}),
                2,
            ),
            (
                "scope",
                el::scope(
                    serde_json::json!({"name": "scope", "channels": 2}),
                    [node(1.0), node(2.0)],
                ),
                "scope",
                serde_json::json!({"name": "scope", "channels": 2}),
                2,
            ),
            (
                "fft",
                el::fft(serde_json::json!({"name": "fft", "size": 1024}), node(1.0)),
                "fft",
                serde_json::json!({"name": "fft", "size": 1024}),
                1,
            ),
            (
                "capture",
                el::capture(serde_json::json!({"name": "cap"}), node(1.0), node(2.0)),
                "capture",
                serde_json::json!({"name": "cap"}),
                2,
            ),
            (
                "table",
                el::table(serde_json::json!({"path": "a.wav"}), node(1.0)),
                "table",
                serde_json::json!({"path": "a.wav"}),
                1,
            ),
            (
                "convolve",
                el::convolve(serde_json::json!({"path": "ir.wav"}), node(1.0)),
                "convolve",
                serde_json::json!({"path": "ir.wav"}),
                1,
            ),
            (
                "seq",
                el::seq(serde_json::json!({"seq": [1.0, 2.0]}), node(1.0), node(0.0)),
                "seq",
                serde_json::json!({"seq": [1.0, 2.0]}),
                2,
            ),
            (
                "seq2",
                el::seq2(serde_json::json!({"seq": [1.0, 2.0]}), node(1.0), node(0.0)),
                "seq2",
                serde_json::json!({"seq": [1.0, 2.0]}),
                2,
            ),
            (
                "sparseq",
                el::sparseq(
                    serde_json::json!({"seq": [{"value":1.0,"tickTime":0.0}]}),
                    node(1.0),
                    node(0.0),
                ),
                "sparseq",
                serde_json::json!({"seq": [{"value":1.0,"tickTime":0.0}]}),
                2,
            ),
            (
                "sparseq2",
                el::sparseq2(
                    serde_json::json!({"seq": [{"value":1.0,"time":0.0}]}),
                    node(1.0),
                ),
                "sparseq2",
                serde_json::json!({"seq": [{"value":1.0,"time":0.0}]}),
                1,
            ),
            (
                "sampleseq",
                el::sampleseq(serde_json::json!({"path": "a.wav"}), node(1.0)),
                "sampleseq",
                serde_json::json!({"path": "a.wav"}),
                1,
            ),
            (
                "sampleseq2",
                el::sampleseq2(serde_json::json!({"path": "a.wav"}), node(1.0)),
                "sampleseq2",
                serde_json::json!({"path": "a.wav"}),
                1,
            ),
            (
                "delay",
                el::delay(
                    serde_json::json!({"size": 128}),
                    node(1.0),
                    node(0.0),
                    node(1.0),
                ),
                "delay",
                serde_json::json!({"size": 128}),
                3,
            ),
            (
                "sdelay",
                el::sdelay(serde_json::json!({"size": 128}), node(1.0)),
                "sdelay",
                serde_json::json!({"size": 128}),
                1,
            ),
            (
                "mm1p",
                el::mm1p(
                    serde_json::json!({"mode": "lowpass"}),
                    node(220.0),
                    node(1.0),
                ),
                "mm1p",
                serde_json::json!({"mode": "lowpass"}),
                2,
            ),
            (
                "svf",
                el::svf(
                    serde_json::json!({"mode": "lowpass"}),
                    node(220.0),
                    node(0.7),
                    node(1.0),
                ),
                "svf",
                serde_json::json!({"mode": "lowpass"}),
                3,
            ),
            (
                "svfshelf",
                el::svfshelf(
                    serde_json::json!({"mode": "peak"}),
                    node(220.0),
                    node(0.7),
                    node(3.0),
                    node(1.0),
                ),
                "svfshelf",
                serde_json::json!({"mode": "peak"}),
                4,
            ),
            (
                "biquad",
                el::biquad(
                    node(1.0),
                    node(2.0),
                    node(3.0),
                    node(4.0),
                    node(5.0),
                    node(6.0),
                ),
                "biquad",
                serde_json::Value::Null,
                6,
            ),
            (
                "identity",
                el::identity(serde_json::json!({"channel": 0}), Some(node(1.0))),
                "in",
                serde_json::json!({"channel": 0}),
                1,
            ),
            (
                "in alias",
                el::r#in(serde_json::json!({"channel": 1}), None),
                "in",
                serde_json::json!({"channel": 1}),
                0,
            ),
            (
                "pole",
                el::pole(node(0.5), node(1.0)),
                "pole",
                serde_json::Value::Null,
                2,
            ),
            ("z", el::z(node(1.0)), "z", serde_json::Value::Null, 1),
            (
                "prewarp",
                el::prewarp(node(440.0)),
                "prewarp",
                serde_json::Value::Null,
                1,
            ),
        ];

        for (_, node, kind, props, child_count) in cases {
            assert_node(&node, kind, props, child_count);
        }
    }

    #[test]
    fn covers_mc_helpers() {
        let sample_nodes = mc::sample(
            serde_json::json!({"path": "a.wav", "channels": 2}),
            ElemNode::from(node(1.0)),
        );
        assert_eq!(sample_nodes.len(), 2);
        assert_nodes(
            &sample_nodes,
            "mc.sample",
            serde_json::json!({"path": "a.wav"}),
            1,
        );

        let seq_nodes = mc::sampleseq(
            serde_json::json!({"path": "a.wav", "channels": 3}),
            ElemNode::from(node(1.0)),
        );
        assert_eq!(seq_nodes.len(), 3);
        assert_nodes(
            &seq_nodes,
            "mc.sampleseq",
            serde_json::json!({"path": "a.wav"}),
            1,
        );

        let seq2_nodes = mc::sampleseq2(
            serde_json::json!({"path": "a.wav", "channels": 2}),
            ElemNode::from(node(1.0)),
        );
        assert_eq!(seq2_nodes.len(), 2);
        assert_nodes(
            &seq2_nodes,
            "mc.sampleseq2",
            serde_json::json!({"path": "a.wav"}),
            1,
        );

        let table_nodes = mc::table(
            serde_json::json!({"path": "a.wav", "channels": 4}),
            ElemNode::from(node(1.0)),
        );
        assert_eq!(table_nodes.len(), 4);
        assert_nodes(
            &table_nodes,
            "mc.table",
            serde_json::json!({"path": "a.wav"}),
            1,
        );

        let capture_nodes = mc::capture(
            serde_json::json!({"name": "cap", "channels": 2}),
            ElemNode::from(node(1.0)),
            [ElemNode::from(2.0), ElemNode::from(3.0)],
        );
        assert_eq!(capture_nodes.len(), 2);
        assert_nodes(
            &capture_nodes,
            "mc.capture",
            serde_json::json!({"name": "cap"}),
            3,
        );
    }

    #[test]
    fn lowers_multichannel_graph_to_batch() {
        let graph = Graph::new()
            .root(el::cycle(el::sm(el::const_(220.0))))
            .root(el::cycle(el::sm(el::const_(220.0 * 1.618))));

        let batch = graph.lower();
        assert!(batch.to_json_string().contains("sin"));
        assert!(batch.to_json_string().contains("phasor"));
        assert!(batch.to_json_string().contains("pole"));
        assert!(batch.to_json_string().contains("root"));
    }
}
