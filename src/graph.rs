//! Minimal Rust-native graph DSL for Elementary-style node composition.

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

    /// Loads a sample from the virtual file system and triggers its playback
    /// on the rising edge of an incoming pulse train. Expects a props arg and
    /// then one child, `t`, the pulse train to trigger playback.
    ///
    /// This node is nearly identical to `el.sample`, except that `mc.sample`
    /// supports multi-channel buffers through the virtual file system and
    /// produces multi-channel output. The return value is an array containing
    /// the individual channel signals you want to address.
    pub fn sample(props: serde_json::Value, gate: impl Into<ElemNode>) -> Vec<Node> {
        unpack_mc("mc.sample", props, [gate.into()])
    }

    /// The multichannel variant of `sampleseq`.
    ///
    /// Loads a sequence-driven sample from the virtual file system and
    /// produces multi-channel output. Expects a props arg and then one child,
    /// `t`, the current time or trigger signal.
    pub fn sampleseq(props: serde_json::Value, time: impl Into<ElemNode>) -> Vec<Node> {
        unpack_mc("mc.sampleseq", props, [time.into()])
    }

    /// The multichannel variant of `sampleseq2`.
    ///
    /// Equivalent to `mc.sampleseq`, except that it adds pitch shifting and
    /// time stretching support for the source sample.
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

/// Extended helpers for native DSP nodes.
pub mod extra {
    use super::Node;
    use crate::{resolve, unpack, ElemNode};

    /// Frequency shifter helper.
    ///
    /// Returns two roots:
    /// - output 0: down-shifted
    /// - output 1: up-shifted
    ///
    /// Props:
    /// - `shiftHz`: frequency shift in Hz
    /// - `mix`: wet amount in the range `0.0..=1.0`
    /// - `reflect`: integer mode for negative shift handling
    pub fn freqshift(props: serde_json::Value, x: impl Into<ElemNode>) -> Vec<Node> {
        unpack(Node::new("freqshift", props, vec![resolve(x)]), 2)
    }
}

/// Functional helpers mirroring Elementary's `el.*` style.
///
/// Rust keeps the helper surface function-based.
///
/// The `el` module follows the upstream Elementary reference layout:
///
/// - Math: `sin`, `cos`, `add`, `mul`, `div`, `min`, `max`, and related helpers
/// - Core signals: `sr`, `time`, `counter`, `phasor`, `latch`, `train`
/// - Props-based helpers: `seq`, `sparseq`, `delay`, `svf`, `adsr`, `compress`
/// - Oscillators and filters: `cycle`, `saw`, `square`, `triangle`, `lowpass`, `peak`
///
/// Fold-style math accepts tuple inputs like `el::mul((a, b, c))` and
/// `el::div((a, b))`. Numeric literals and existing nodes both coerce through
/// the same `Into<ElemNode>` path.
///
/// For composition identity, prefer `key` on stable leaf nodes and refer to
/// the upstream guide: <https://www.elementary.audio/docs/guides/Understanding_Keys>.
pub mod el {
    use super::{Node, Value};
    use crate::core::{resolve, ElemNode};

    fn empty_props() -> Value {
        Value::Object(Default::default())
    }

    /// Helper accepted by the variadic math fold helpers.
    ///
    /// Arrays work for homogeneous inputs, while tuples are the ergonomic
    /// escape hatch for mixed `Node`/numeric arguments.
    pub trait IntoNodeList {
        fn into_nodes(self) -> Vec<ElemNode>;
    }

    impl<T> IntoNodeList for [T; 1]
    where
        T: Into<ElemNode>,
    {
        fn into_nodes(self) -> Vec<ElemNode> {
            self.into_iter().map(Into::into).collect()
        }
    }

    impl<T> IntoNodeList for [T; 2]
    where
        T: Into<ElemNode>,
    {
        fn into_nodes(self) -> Vec<ElemNode> {
            self.into_iter().map(Into::into).collect()
        }
    }

    impl<T> IntoNodeList for [T; 3]
    where
        T: Into<ElemNode>,
    {
        fn into_nodes(self) -> Vec<ElemNode> {
            self.into_iter().map(Into::into).collect()
        }
    }

    impl<T> IntoNodeList for [T; 4]
    where
        T: Into<ElemNode>,
    {
        fn into_nodes(self) -> Vec<ElemNode> {
            self.into_iter().map(Into::into).collect()
        }
    }

    macro_rules! impl_tuple_nodes {
        ($($ty:ident => $var:ident),+) => {
            impl<$($ty),+> IntoNodeList for ($($ty,)+)
            where
                $($ty: Into<ElemNode>,)+
            {
                fn into_nodes(self) -> Vec<ElemNode> {
                    let ($($var,)+) = self;
                    vec![$($var.into(),)+]
                }
            }
        };
    }

    impl_tuple_nodes!(A => a, B => b);
    impl_tuple_nodes!(A => a, B => b, C => c);
    impl_tuple_nodes!(A => a, B => b, C => c, D => d);
    impl_tuple_nodes!(A => a, B => b, C => c, D => d, E => e);
    impl_tuple_nodes!(A => a, B => b, C => c, D => d, E => e, F => f);
    impl_tuple_nodes!(A => a, B => b, C => c, D => d, E => e, F => f, G => g);
    impl_tuple_nodes!(A => a, B => b, C => c, D => d, E => e, F => f, G => g, H => h);

    fn fold_node(items: impl IntoNodeList, kind: &str) -> Node {
        Node::new(
            kind,
            Value::Null,
            items.into_nodes().into_iter().map(resolve).collect(),
        )
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

    /// Constant signal node with the Rust-friendly helper name
    /// (const is a protected keyword in rust)
    pub fn const_(value: f64) -> Node {
        constant(serde_json::json!({ "value": value }))
    }

    /// Constant signal node with an author-supplied key.
    pub fn const_with_key(key: &str, value: f64) -> Node {
        constant(serde_json::json!({ "key": key, "value": value }))
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

    /// Sample-rate signal. Expects no children.
    pub fn sr() -> Node {
        node0("sr")
    }
    /// Current time signal in seconds. Expects no children.
    pub fn time() -> Node {
        node0("time")
    }
    /// el.counter(g)
    ///
    /// Outputs a continuous count of elapsed samples. Expects one child, `g`,
    /// a pulse train alternating between `0` and `1`. When `g` is high, the
    /// counter will run. When `g` is low, the counter will reset and output `0`
    /// until `g` is high again.
    pub fn counter(g: impl Into<ElemNode>) -> Node {
        node1("counter", g)
    }
    /// el.accum(xn, reset)
    ///
    /// Outputs a continuous and running sum over the samples in the input signal
    /// `xn`. This value can grow very large, very quickly, so use with care.
    /// The second argument `reset` is a pulse train signal which resets the
    /// running sum to `0` on each rising edge.
    pub fn accum(xn: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node2("accum", xn, reset)
    }
    /// el.phasor(rate)
    ///
    /// Outputs a ramp from `0` to `1` at the given rate. Expects one child
    /// signal providing the ramp rate in `hz`.
    ///
    /// For the same signal with phase reset behavior, see `sphasor`.
    pub fn phasor(rate: impl Into<ElemNode>) -> Node {
        node1("phasor", rate)
    }
    /// Synchronous phase accumulator. Expects 2 children: rate and sync/reset.
    pub fn syncphasor(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("sphasor", left, right)
    }
    /// Alias for the upstream `sphasor` helper.
    pub fn sphasor(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        syncphasor(left, right)
    }
    /// el.latch(t, x)
    ///
    /// A sample and hold node. Samples a new value from `x` on a rising edge
    /// of a pulse train `t`, then holds and emits that value until the next
    /// rising edge of `t`.
    ///
    /// Expected children:
    /// 1. The control signal, `t`, a pulse train
    /// 2. The input signal to sample
    pub fn latch(t: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        node2("latch", t, x)
    }
    /// Peak-hold helper. `props` typically carries `hold` time metadata.
    /// Expects 2 children: input signal and hold/reset control.
    pub fn maxhold(props: Value, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        node_props2("maxhold", props, a, b)
    }
    /// One-shot helper. `props` typically carries an `arm` flag.
    /// Expects 1 child: the signal to pass once when armed.
    pub fn once(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("once", props, child)
    }
    /// el.rand(\[props\])
    ///
    /// Generates a stream of random numbers uniformly distributed on the
    /// range `[0, 1]`.
    ///
    /// Props:
    /// - `seed`: seeds the random number generator
    pub fn rand(props: Option<Value>) -> Node {
        Node::new("rand", props.unwrap_or_else(empty_props), vec![])
    }

    /// el.metro(props)
    ///
    /// Only available in the WASM-based renderers. You may extend the runtime
    /// in your own integration with a similar processor if you like, but it is
    /// not provided by default.
    ///
    /// Emits a pulse train signal much like `el.train`, alternating from `0`
    /// to `1` at a given rate. Importantly, the `el.metro` node is used for
    /// synchronized train signals, and will emit an event through the core
    /// renderer's interface on each rising edge of its output signal.
    ///
    /// Props:
    /// - `name`: identifies a metro node by name
    /// - `interval`: metronome period in milliseconds
    pub fn metro(props: Option<Value>) -> Node {
        Node::new("metro", props.unwrap_or_else(empty_props), vec![])
    }
    /// Named input tap. `props` should carry the tap name metadata.
    pub fn tap_in(props: Value) -> Node {
        node_props0("tapIn", props)
    }
    /// Named output tap. `props` should carry the tap name metadata.
    /// Expects 1 child: the signal to export.
    pub fn tap_out(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("tapOut", props, child)
    }
    /// Meter / monitor node. `props` should carry the meter name metadata.
    /// Expects 1 child: the signal to observe.
    pub fn meter(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("meter", props, child)
    }
    /// Snapshot node. `props` should carry snapshot metadata.
    /// Expects 2 children: the source signal and trigger/reset.
    pub fn snapshot(props: Value, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        node_props2("snapshot", props, a, b)
    }
    pub fn scope<T>(props: Value, args: impl IntoIterator<Item = T>) -> Node
    where
        T: Into<ElemNode>,
    {
        node_props_variadic("scope", props, args)
    }
    /// FFT analyzer node. `props` should carry analyzer metadata.
    /// Expects 1 child: the signal to analyze.
    pub fn fft(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("fft", props, child)
    }
    /// Capture node. `props` should carry capture metadata.
    /// Expects 2 children: the capture gate and the input signal.
    pub fn capture(props: Value, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        node_props2("capture", props, a, b)
    }
    /// Table lookup node. `props` should carry table metadata such as path.
    /// Expects 1 child: the lookup coordinate.
    pub fn table(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("table", props, child)
    }
    /// Convolution node. `props` should carry impulse-response metadata.
    /// Expects 1 child: the source signal.
    pub fn convolve(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("convolve", props, child)
    }
    /// Discrete sequence node. `props` should carry `seq` data and optional loop metadata.
    /// Expects 2 children: trigger and reset.
    pub fn seq(props: Value, trigger: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node_props2("seq", props, trigger, reset)
    }
    /// Discrete sequence node with the `seq2` variant semantics.
    /// `props` should carry `seq` data and optional loop metadata.
    /// Expects 2 children: trigger and reset.
    pub fn seq2(props: Value, trigger: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node_props2("seq2", props, trigger, reset)
    }
    /// Sample-accurate discrete sequence node.
    /// `props` should carry sparse `seq` entries and optional loop metadata.
    /// Expects 2 children: trigger and reset.
    pub fn sparseq(props: Value, trigger: impl Into<ElemNode>, reset: impl Into<ElemNode>) -> Node {
        node_props2("sparseq", props, trigger, reset)
    }
    /// Sparse sequence helper variant. `props` should carry sparse `seq` entries.
    /// Expects 1 child: the time or trigger signal.
    pub fn sparseq2(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sparseq2", props, child)
    }
    /// Sample sequence player. `props` should carry sample metadata such as path.
    /// Expects 1 child: the playback trigger or time signal.
    pub fn sampleseq(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sampleseq", props, child)
    }
    /// Sample sequence player variant. `props` should carry sample metadata such as path.
    /// Expects 1 child: the playback trigger or time signal.
    pub fn sampleseq2(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sampleseq2", props, child)
    }
    /// el.pole(p, x)
    ///
    /// Implements a simple one-pole filter, also sometimes called a leaky
    /// integrator. Expects two children: the first is the pole position `p`,
    /// the second is the signal `x` to filter.
    pub fn pole(p: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        node2("pole", p, x)
    }
    /// el.env(atkPole, relPole, x)
    ///
    /// A one-pole envelope follower with different attack and release times.
    /// This is similar to `el.pole(p, el.abs(x))` in implementation. Expects
    /// three children: attack pole, release pole, and the signal to monitor.
    pub fn env(
        atk_pole: impl Into<ElemNode>,
        rel_pole: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        node3("env", atk_pole, rel_pole, x)
    }
    /// Unit delay / z^-1 helper. Expects 1 child.
    pub fn z(child: impl Into<ElemNode>) -> Node {
        node1("z", child)
    }
    /// Multi-tap delay. `props` should carry delay buffer metadata such as `size`.
    /// Expects 3 children: read, write, and feedback/control.
    pub fn delay(
        props: Value,
        a: impl Into<ElemNode>,
        b: impl Into<ElemNode>,
        c: impl Into<ElemNode>,
    ) -> Node {
        node_props3("delay", props, a, b, c)
    }
    /// Sample-accurate delay. `props` should carry buffer metadata such as `size`.
    /// Expects 1 child: the signal to delay.
    pub fn sdelay(props: Value, child: impl Into<ElemNode>) -> Node {
        node_props1("sdelay", props, child)
    }
    /// Prewarp helper. Expects 1 child.
    pub fn prewarp(child: impl Into<ElemNode>) -> Node {
        node1("prewarp", child)
    }
    /// One-pole modulation helper. `props` should carry mode metadata.
    /// Expects 2 children: cutoff and input signal.
    pub fn mm1p(props: Value, fc: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        node_props2("mm1p", props, fc, x)
    }
    /// State-variable filter. `props` should carry mode metadata.
    /// Expects 3 children: cutoff, resonance/Q, and input signal.
    pub fn svf(
        props: Value,
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        node_props3("svf", props, fc, q, x)
    }
    /// State-variable shelving filter. `props` should carry mode metadata.
    /// Expects 4 children: cutoff, resonance/Q, gain, and input signal.
    pub fn svfshelf(
        props: Value,
        fc: impl Into<ElemNode>,
        q: impl Into<ElemNode>,
        gain: impl Into<ElemNode>,
        x: impl Into<ElemNode>,
    ) -> Node {
        node_props4("svfshelf", props, fc, q, gain, x)
    }
    /// Direct-form biquad helper. Expects 6 children: b0, b1, b2, a1, a2, x.
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

    /// Sine helper. Expects exactly 1 child.
    pub fn sin(x: impl Into<ElemNode>) -> Node {
        node1("sin", x)
    }

    /// Cosine helper. Expects exactly 1 child.
    pub fn cos(x: impl Into<ElemNode>) -> Node {
        node1("cos", x)
    }

    /// Tangent helper. Expects exactly 1 child.
    pub fn tan(x: impl Into<ElemNode>) -> Node {
        node1("tan", x)
    }

    /// Hyperbolic tangent helper. Expects exactly 1 child.
    pub fn tanh(x: impl Into<ElemNode>) -> Node {
        node1("tanh", x)
    }

    /// Inverse hyperbolic sine helper. Expects exactly 1 child.
    pub fn asinh(x: impl Into<ElemNode>) -> Node {
        node1("asinh", x)
    }

    /// Natural logarithm helper. Expects exactly 1 child.
    pub fn ln(x: impl Into<ElemNode>) -> Node {
        node1("ln", x)
    }

    /// Base-10 logarithm helper. Expects exactly 1 child.
    pub fn log(x: impl Into<ElemNode>) -> Node {
        node1("log", x)
    }

    /// Base-2 logarithm helper. Expects exactly 1 child.
    pub fn log2(x: impl Into<ElemNode>) -> Node {
        node1("log2", x)
    }

    /// Ceiling helper. Expects exactly 1 child.
    pub fn ceil(x: impl Into<ElemNode>) -> Node {
        node1("ceil", x)
    }

    /// Floor helper. Expects exactly 1 child.
    pub fn floor(x: impl Into<ElemNode>) -> Node {
        node1("floor", x)
    }

    /// Round helper. Expects exactly 1 child.
    pub fn round(x: impl Into<ElemNode>) -> Node {
        node1("round", x)
    }

    /// Square root helper. Expects exactly 1 child.
    pub fn sqrt(x: impl Into<ElemNode>) -> Node {
        node1("sqrt", x)
    }

    /// Exponential helper. Expects exactly 1 child.
    pub fn exp(x: impl Into<ElemNode>) -> Node {
        node1("exp", x)
    }

    /// Absolute value helper. Expects exactly 1 child.
    pub fn abs(x: impl Into<ElemNode>) -> Node {
        node1("abs", x)
    }

    /// Less-than helper. Expects exactly 2 children.
    pub fn le(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("le", left, right)
    }

    /// Less-than-or-equal helper. Expects exactly 2 children.
    pub fn leq(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("leq", left, right)
    }

    /// Greater-than helper. Expects exactly 2 children.
    pub fn ge(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("ge", left, right)
    }

    /// Greater-than-or-equal helper. Expects exactly 2 children.
    pub fn geq(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("geq", left, right)
    }

    /// Power helper. Expects exactly 2 children.
    pub fn pow(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("pow", left, right)
    }

    /// Equality helper. Expects exactly 2 children.
    pub fn eq(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("eq", left, right)
    }

    /// Logical `and` helper. Expects exactly 2 children.
    pub fn and(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("and", left, right)
    }

    /// Logical `or` helper. Expects exactly 2 children.
    pub fn or(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("or", left, right)
    }

    /// Addition helper. Expects one or more children.
    pub fn add(items: impl IntoNodeList) -> Node {
        fold_node(items, "add")
    }

    /// Subtraction helper. Expects one or more children.
    pub fn sub(items: impl IntoNodeList) -> Node {
        fold_node(items, "sub")
    }

    /// Multiplication helper. Expects one or more children.
    pub fn mul(items: impl IntoNodeList) -> Node {
        fold_node(items, "mul")
    }

    /// Division helper. Expects one or more children.
    pub fn div(items: impl IntoNodeList) -> Node {
        fold_node(items, "div")
    }

    /// Modulo helper. Expects exactly 2 children.
    pub fn r#mod(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("mod", left, right)
    }

    /// Minimum helper. Expects exactly 2 children.
    pub fn min(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("min", left, right)
    }

    /// Maximum helper. Expects exactly 2 children.
    pub fn max(left: impl Into<ElemNode>, right: impl Into<ElemNode>) -> Node {
        node2("max", left, right)
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

    /// Band-limited cycle oscillator helper. Expects 1 child: frequency or rate.
    pub fn cycle(rate: impl Into<ElemNode>) -> Node {
        sin(mul([const_(2.0 * std::f64::consts::PI), phasor(rate)]))
    }

    /// Pulse train helper. Expects 1 child: frequency or rate.
    pub fn train(rate: impl Into<ElemNode>) -> Node {
        le(phasor(rate), const_(0.5))
    }

    /// Saw oscillator helper. Expects 1 child: frequency or rate.
    pub fn saw(rate: impl Into<ElemNode>) -> Node {
        sub([mul([const_(2.0), phasor(rate)]), const_(1.0)])
    }

    /// Square oscillator helper. Expects 1 child: frequency or rate.
    pub fn square(rate: impl Into<ElemNode>) -> Node {
        sub([mul([const_(2.0), train(rate)]), const_(1.0)])
    }

    /// Triangle oscillator helper. Expects 1 child: frequency or rate.
    pub fn triangle(rate: impl Into<ElemNode>) -> Node {
        mul([const_(2.0), sub([const_(0.5), abs(saw(rate))])])
    }

    /// Band-limited polyBLEP saw oscillator. Expects 1 child: frequency or rate.
    pub fn blepsaw(rate: impl Into<ElemNode>) -> Node {
        node1("blepsaw", rate)
    }

    /// Band-limited polyBLEP square oscillator. Expects 1 child: frequency or rate.
    pub fn blepsquare(rate: impl Into<ElemNode>) -> Node {
        node1("blepsquare", rate)
    }

    /// Band-limited polyBLEP triangle oscillator. Expects 1 child: frequency or rate.
    pub fn bleptriangle(rate: impl Into<ElemNode>) -> Node {
        node1("bleptriangle", rate)
    }

    /// White noise helper. Optional `props` are forwarded unchanged.
    pub fn noise(props: Option<Value>) -> Node {
        sub([mul([const_(2.0), rand(props)]), const_(1.0)])
    }

    /// Pink noise helper. Optional `props` are forwarded unchanged.
    pub fn pinknoise(props: Option<Value>) -> Node {
        pink(noise(props))
    }

    /// Milliseconds to samples. Expects 1 child: a time value in milliseconds.
    pub fn ms2samps(t: impl Into<ElemNode>) -> Node {
        let t = resolve(t);
        mul([sr(), div([t, const_(1000.0)])])
    }

    /// Time constant to pole. Expects 1 child: a time constant in seconds.
    pub fn tau2pole(t: impl Into<ElemNode>) -> Node {
        let t = resolve(t);
        exp(div([const_(-1.0), mul([t, sr()])]))
    }

    /// Decibels to gain. Expects 1 child: a decibel value.
    pub fn db2gain(db: impl Into<ElemNode>) -> Node {
        let db = resolve(db);
        pow(const_(10.0), mul([db, const_(1.0 / 20.0)]))
    }

    /// Gain to decibels. Expects 1 child: a linear gain value.
    pub fn gain2db(gain: impl Into<ElemNode>) -> Node {
        let gain = resolve(gain);
        select(
            ge(gain.clone(), const_(0.0)),
            max(const_(-120.0), mul([const_(20.0), log(gain)])),
            const_(-120.0),
        )
    }

    /// Linear select helper. Expects 3 children: gate, a, and b.
    pub fn select(g: impl Into<ElemNode>, a: impl Into<ElemNode>, b: impl Into<ElemNode>) -> Node {
        let g = resolve(g);
        let a = resolve(a);
        let b = resolve(b);
        add([mul([g.clone(), a]), mul([sub([const_(1.0), g]), b])])
    }

    /// Hann window helper. Expects 1 child: the phase or normalized position.
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

    /// One-pole smoothing. Expects 2 children: pole coefficient and input signal.
    pub fn smooth(p: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        let p = resolve(p);
        let x = resolve(x);
        pole(p.clone(), mul([sub([const_(1.0), p]), x]))
    }

    /// 20ms smoothing helper. Expects 1 child: the input signal.
    pub fn sm(x: impl Into<ElemNode>) -> Node {
        smooth(tau2pole(const_(0.02)), x)
    }

    /// Simple one-zero filter. Expects 3 children: b0, b1, and input signal.
    pub fn zero(b0: impl Into<ElemNode>, b1: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        let b0 = resolve(b0);
        let b1 = resolve(b1);
        let x = resolve(x);
        sub([mul([b0, x.clone()]), mul([b1, z(x)])])
    }

    /// DC blocking filter. Expects 1 child: the input signal.
    pub fn dcblock(x: impl Into<ElemNode>) -> Node {
        let x = resolve(x);
        pole(const_(0.995), zero(const_(1.0), const_(1.0), x))
    }

    /// Direct form 1 helper. Expects 4 children: b0, b1, a1, and input signal.
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

    /// Lowpass filter. `props` should carry mode metadata.
    /// Expects 3 children: cutoff, resonance/Q, and input signal.
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

    /// Highpass filter. `props` should carry mode metadata.
    /// Expects 3 children: cutoff, resonance/Q, and input signal.
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

    /// Bandpass filter. `props` should carry mode metadata.
    /// Expects 3 children: cutoff, resonance/Q, and input signal.
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

    /// Notch filter. `props` should carry mode metadata.
    /// Expects 3 children: cutoff, resonance/Q, and input signal.
    pub fn notch(fc: impl Into<ElemNode>, q: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
        let fc = resolve(fc);
        let q = resolve(q);
        let x = resolve(x);
        svf(serde_json::json!({ "mode": "notch" }), fc, q, x)
    }

    /// Allpass filter. `props` should carry mode metadata.
    /// Expects 3 children: cutoff, resonance/Q, and input signal.
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

    /// Peak EQ filter. `props` should carry mode metadata.
    /// Expects 4 children: cutoff, resonance/Q, gain in dB, and input signal.
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

    /// Low shelf filter. `props` should carry mode metadata.
    /// Expects 4 children: cutoff, resonance/Q, gain in dB, and input signal.
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

    /// High shelf filter. `props` should carry mode metadata.
    /// Expects 4 children: cutoff, resonance/Q, gain in dB, and input signal.
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

    /// Pinking filter. Expects 1 child: the source signal.
    pub fn pink(x: impl Into<ElemNode>) -> Node {
        let x = resolve(x);
        let clip = |lower: Node, upper: Node, x: Node| min(upper, max(lower, x));

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

    /// el.adsr(a, d, s, r, g)
    ///
    /// An exponential ADSR envelope generator, triggered by the gate signal
    /// `g`. When the gate is high (`1`), this generates the ADS phase. When
    /// the gate is low, the R phase.
    ///
    /// Expected children:
    /// - Attack time in seconds (number or signal)
    /// - Decay time in seconds (number or signal)
    /// - Sustain amplitude between `0` and `1` (number or signal)
    /// - Release time in seconds (number or signal)
    /// - Gate signal; a pulse train alternating between `0` and `1`
    pub fn adsr(
        a: impl Into<ElemNode>,
        d: impl Into<ElemNode>,
        s: impl Into<ElemNode>,
        r: impl Into<ElemNode>,
        g: impl Into<ElemNode>,
    ) -> Node {
        let attack_sec = resolve(a);
        let decay_sec = resolve(d);
        let sustain = resolve(s);
        let release_sec = resolve(r);
        let gate = resolve(g);
        let atk_samps = mul([attack_sec.clone(), sr()]);
        let atk_gate = le(counter(gate.clone()), atk_samps);
        let target_value = select(
            gate.clone(),
            select(atk_gate.clone(), const_(1.0), sustain.clone()),
            const_(0.0),
        );
        let t60 = max(
            const_(0.0001),
            select(
                gate.clone(),
                select(atk_gate, attack_sec, decay_sec),
                release_sec,
            ),
        );
        let p = tau2pole(div([t60, const_(6.91)]));

        smooth(p, target_value)
    }

    /// Compressor.
    /// Expects 6 children: attack in ms, release in ms, threshold, ratio, sidechain, and input.
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
        let adjusted_ratio = sub([const_(1.0), div([const_(1.0), ratio])]);
        let gain = mul([adjusted_ratio, sub([threshold, env_decibels])]);
        let clean_gain = min(const_(0.0), gain);
        let compressed_gain = db2gain(clean_gain);

        mul([xn, compressed_gain])
    }

    /// Soft-knee compressor.
    /// Expects 7 children: attack in ms, release in ms, threshold, ratio, knee width, sidechain, and input.
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
        let lower_knee_bound = sub([threshold.clone(), div([knee_width.clone(), const_(2.0)])]);
        let upper_knee_bound = add([threshold.clone(), div([knee_width.clone(), const_(2.0)])]);
        let is_in_soft_knee_range = and(
            geq(env_decibels.clone(), lower_knee_bound.clone()),
            leq(env_decibels.clone(), upper_knee_bound.clone()),
        );
        let adjusted_ratio = sub([const_(1.0), div([const_(1.0), ratio])]);
        let gain = select(
            is_in_soft_knee_range,
            mul([
                div([adjusted_ratio.clone(), const_(2.0)]),
                mul([
                    div([
                        sub([env_decibels.clone(), lower_knee_bound.clone()]),
                        knee_width.clone(),
                    ]),
                    sub([lower_knee_bound.clone(), env_decibels.clone()]),
                ]),
            ]),
            mul([adjusted_ratio, sub([threshold, env_decibels])]),
        );
        let clean_gain = min(const_(0.0), gain);
        let compressed_gain = db2gain(clean_gain);

        mul([xn, compressed_gain])
    }

    /// Loads a sample from the virtual file system and triggers its playback
    /// on the rising edge of an incoming pulse train. Expects a props arg and
    /// then two children: first the pulse train to trigger playback, and
    /// second a signal which continuously directs the sample's playback rate.
    pub fn sample(props: Value, trigger: impl Into<ElemNode>, rate: impl Into<ElemNode>) -> Node {
        Node::new("sample", props, vec![resolve(trigger), resolve(rate)])
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
    use super::{el, mc, Graph};

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
