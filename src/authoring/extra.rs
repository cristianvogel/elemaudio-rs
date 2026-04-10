use super::el;
use crate::graph::Node;
use crate::{resolve, unpack, ElemNode};

fn channels_and_props(mut props: serde_json::Value) -> (usize, serde_json::Value) {
    let channels = props
        .get("channels")
        .and_then(|value| value.as_u64())
        .expect("extra helper props must include a positive integer `channels`")
        as usize;

    if let serde_json::Value::Object(map) = &mut props {
        map.remove("channels");
    }

    (channels, props)
}

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

/// Crunch distortion helper.
///
/// Returns one root per output channel.
///
/// Props:
/// - `channels`: number of channels to unpack
/// - `drive`: pre-distortion input gain
/// - `fuzz`: amplitude-independent distortion amount
/// - `toneHz`: tone control frequency
/// - `cutHz`: pre-distortion high-pass frequency
/// - `outGain`: output gain
/// - `autoGain`: enable auto gain compensation
pub fn crunch(props: serde_json::Value, x: impl Into<ElemNode>) -> Vec<Node> {
    let (channels, props) = channels_and_props(props);
    unpack(Node::new("crunch", props, vec![resolve(x)]), channels)
}

/// Recursive foldback shaper helper.
///
/// Props:
/// - `thresh`: fold threshold, must be positive
/// - `amp`: output gain, defaults to `1 / thresh`
/// - `key`: optional stable identity key
pub fn foldback(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    let mut props = props;
    let thresh = props
        .get("thresh")
        .and_then(|value| value.as_f64())
        .expect("foldback helper props must include a positive `thresh` value");

    if !(thresh.is_finite() && thresh > 0.0) {
        panic!("foldback helper props must include a positive `thresh` value");
    }

    let amp = props
        .get("amp")
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite())
        .unwrap_or(1.0 / thresh);

    if let serde_json::Value::Object(map) = &mut props {
        map.remove("thresh");
        map.remove("amp");
    }

    let x = resolve(x);
    let thresh_node = el::const_(thresh);
    let amp_node = el::const_(amp);
    let folded = el::sub([
        el::abs(el::sub([
            el::abs(el::r#mod(
                el::sub([x.clone(), thresh_node.clone()]),
                el::mul([el::const_(4.0), thresh_node.clone()]),
            )),
            el::mul([el::const_(2.0), thresh_node.clone()]),
        ])),
        thresh_node.clone(),
    ]);
    let should_fold = el::ge(el::abs(x.clone()), thresh_node);

    Node::new(
        "mul",
        serde_json::Value::Null,
        vec![amp_node, el::select(should_fold, folded, x)],
    )
}

/// Raw variable-width box sum helper.
///
/// Expects 2 children: window length in samples, then the signal to sum.
pub fn box_sum(window_samples: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
    Node::new(
        "boxsum",
        serde_json::Value::Null,
        vec![resolve(window_samples), resolve(x)],
    )
}

/// Raw variable-width box average helper.
///
/// Expects 2 children: window length in samples, then the signal to average.
pub fn box_average(window_samples: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
    Node::new(
        "boxaverage",
        serde_json::Value::Null,
        vec![resolve(window_samples), resolve(x)],
    )
}

/// Native lookahead limiter helper.
///
/// Expects 1 child for mono input or 2 children for stereo input.
pub fn limiter(
    props: serde_json::Value,
    args: impl IntoIterator<Item = impl Into<ElemNode>>,
) -> Vec<Node> {
    let args: Vec<ElemNode> = args.into_iter().map(Into::into).collect();
    let node = Node::new("limiter", props, args.into_iter().map(resolve).collect());
    vec![node]
}

/// Stride-interpolated delay helper.
///
/// Expects 2 children: delay window and source signal.
pub fn stride_delay(
    props: serde_json::Value,
    window: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    Node::new("stridedelay", props, vec![resolve(window), resolve(x)])
}
