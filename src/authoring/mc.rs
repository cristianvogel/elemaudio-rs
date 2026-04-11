use crate::graph::Node;
use crate::{create_node, unpack, ElemNode};

fn channels_and_props(mut props: serde_json::Value) -> (usize, serde_json::Value) {
    let channels = props
        .get("channels")
        .and_then(|value| value.as_u64())
        .expect("mc helpers require a positive `channels` prop") as usize;

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
    let children = std::iter::once(g.into()).chain(args);
    unpack_mc("mc.capture", props, children)
}
