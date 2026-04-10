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
/// Computes a recursive soft-saturation using fold-back distortion. The shape
/// depends on the threshold and gain parameters.
///
/// For best performance with the fast-path update system, supply a `key` prefix.
/// This allows threshold and amplitude to be updated **without rebuilding the graph**.
///
/// Props:
/// - `key`: optional prefix for stable node identity; enables direct updates via
///   `mounted.node_with_key("{key}_thresh")` and `mounted.node_with_key("{key}_amp")`
/// - `thresh`: fold threshold, must be positive
/// - `amp`: output gain, defaults to `1 / thresh`
///
/// # Example: Keyed foldback with parameter updates
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra};
/// use serde_json::json;
///
/// // Create a graph with a keyed foldback
/// let graph = Graph::new().render(
///     extra::foldback(
///         json!({
///             "key": "shaper",
///             "thresh": 0.5,
///             "amp": 2.0,
///         }),
///         el::cycle(el::const_(440.0)),
///     )
/// );
///
/// // Mount the graph and get handles for direct updates
/// let mounted = graph.mount();
/// let batch = mounted.into_batch();
/// runtime.execute(&batch);
///
/// // Later, update threshold WITHOUT rebuilding the entire graph
/// if let Some(thresh_node) = mounted.node_with_key("shaper_thresh") {
///     let update = thresh_node.set_const_value(0.7);
///     runtime.execute(&update);
/// }
///
/// // Similarly for amplitude
/// if let Some(amp_node) = mounted.node_with_key("shaper_amp") {
///     let update = amp_node.set_const_value(1.5);
///     runtime.execute(&update);
/// }
/// ```
pub fn foldback(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    let mut props = props;

    // Extract and validate threshold
    let thresh = props
        .get("thresh")
        .and_then(|value| value.as_f64())
        .expect("foldback helper props must include a positive `thresh` value");

    if !(thresh.is_finite() && thresh > 0.0) {
        panic!("foldback helper props must include a positive `thresh` value");
    }

    // Extract amplitude, defaulting to 1 / thresh
    let amp = props
        .get("amp")
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite())
        .unwrap_or(1.0 / thresh);

    // Extract optional key prefix for fast-path updates
    let key_prefix = props
        .get("key")
        .and_then(|value| value.as_str())
        .map(|k| k.to_string());

    // Remove control props before constructing the graph
    if let serde_json::Value::Object(map) = &mut props {
        map.remove("thresh");
        map.remove("amp");
        map.remove("key");
    }

    let x = resolve(x);

    // Create const nodes with keys if a prefix was supplied
    let thresh_node = match &key_prefix {
        Some(prefix) => el::const_with_key(&format!("{}_thresh", prefix), thresh),
        None => el::const_(thresh),
    };

    let amp_node = match &key_prefix {
        Some(prefix) => el::const_with_key(&format!("{}_amp", prefix), amp),
        None => el::const_(amp),
    };

    // Build the foldback computation graph
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
/// Computes a box-filter sum over a configurable window length.
///
/// For best performance with the fast-path update system, supply a `key` prefix
/// and a `window` parameter. This allows the window length to be updated without
/// rebuilding the graph.
///
/// Props:
/// - `key`: optional prefix for stable node identity (enables fast window updates)
/// - `window`: window length in samples (required)
///
/// # Example: Keyed box sum with dynamic window
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra};
/// use serde_json::json;
///
/// let graph = Graph::new().render(
///     extra::box_sum(
///         json!({ "key": "boxfilter", "window": 256.0 }),
///         el::cycle(el::const_(440.0)),
///     )
/// );
///
/// let mounted = graph.mount();
/// let batch = mounted.into_batch();
/// runtime.execute(&batch);
///
/// // Later, update window size without rebuilding the graph
/// if let Some(window_node) = mounted.node_with_key("boxfilter_window") {
///     let update = window_node.set_const_value(512.0);
///     runtime.execute(&update);
/// }
/// ```
pub fn box_sum(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    let mut props = props;

    // Extract and validate window length
    let window = props
        .get("window")
        .and_then(|value| value.as_f64())
        .expect("box_sum helper props must include a positive numeric `window` value");

    if !(window.is_finite() && window > 0.0) {
        panic!("box_sum helper props must include a positive numeric `window` value");
    }

    // Extract optional key prefix for fast-path updates
    let key_prefix = props
        .get("key")
        .and_then(|value| value.as_str())
        .map(|k| k.to_string());

    // Remove control props before constructing the graph
    if let serde_json::Value::Object(map) = &mut props {
        map.remove("window");
        map.remove("key");
    }

    // Create window node with key if a prefix was supplied
    let window_node = match &key_prefix {
        Some(prefix) => el::const_with_key(&format!("{}_window", prefix), window),
        None => el::const_(window),
    };

    Node::new("boxsum", props, vec![window_node, resolve(x)])
}

/// Raw variable-width box average helper.
///
/// Computes a box-filter average over a configurable window length.
///
/// For best performance with the fast-path update system, supply a `key` prefix
/// and a `window` parameter. This allows the window length to be updated without
/// rebuilding the graph.
///
/// Props:
/// - `key`: optional prefix for stable node identity (enables fast window updates)
/// - `window`: window length in samples (required)
///
/// # Example: Keyed box average with dynamic window
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra};
/// use serde_json::json;
///
/// let graph = Graph::new().render(
///     extra::box_average(
///         json!({ "key": "boxavg", "window": 256.0 }),
///         el::cycle(el::const_(440.0)),
///     )
/// );
///
/// let mounted = graph.mount();
/// let batch = mounted.into_batch();
/// runtime.execute(&batch);
///
/// // Later, update window size without rebuilding the graph
/// if let Some(window_node) = mounted.node_with_key("boxavg_window") {
///     let update = window_node.set_const_value(512.0);
///     runtime.execute(&update);
/// }
/// ```
pub fn box_average(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    let mut props = props;

    // Extract and validate window length
    let window = props
        .get("window")
        .and_then(|value| value.as_f64())
        .expect("box_average helper props must include a positive numeric `window` value");

    if !(window.is_finite() && window > 0.0) {
        panic!("box_average helper props must include a positive numeric `window` value");
    }

    // Extract optional key prefix for fast-path updates
    let key_prefix = props
        .get("key")
        .and_then(|value| value.as_str())
        .map(|k| k.to_string());

    // Remove control props before constructing the graph
    if let serde_json::Value::Object(map) = &mut props {
        map.remove("window");
        map.remove("key");
    }

    // Create window node with key if a prefix was supplied
    let window_node = match &key_prefix {
        Some(prefix) => el::const_with_key(&format!("{}_window", prefix), window),
        None => el::const_(window),
    };

    Node::new("boxaverage", props, vec![window_node, resolve(x)])
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
/// Applies a stride-interpolated delay with configurable window length.
///
/// For best performance with the fast-path update system, supply a `key` prefix
/// and a `window` parameter. This allows the delay time to be updated without
/// rebuilding the graph.
///
/// Props:
/// - `key`: optional prefix for stable node identity (enables fast delay updates)
/// - `window`: delay buffer size in samples (required)
///
/// # Example: Keyed stride delay with dynamic timing
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra};
/// use serde_json::json;
///
/// let graph = Graph::new().render(
///     extra::stride_delay(
///         json!({ "key": "delay", "window": 44100.0 }),  // 1 second at 44.1kHz
///         el::cycle(el::const_(440.0)),
///     )
/// );
///
/// let mounted = graph.mount();
/// let batch = mounted.into_batch();
/// runtime.execute(&batch);
///
/// // Later, update delay time without rebuilding the graph
/// if let Some(delay_node) = mounted.node_with_key("delay_window") {
///     let update = delay_node.set_const_value(22050.0);  // Now 0.5 seconds
///     runtime.execute(&update);
/// }
/// ```
pub fn stride_delay(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    let mut props = props;

    // Extract and validate window length
    let window = props
        .get("window")
        .and_then(|value| value.as_f64())
        .expect("stride_delay helper props must include a positive numeric `window` value");

    if !(window.is_finite() && window > 0.0) {
        panic!("stride_delay helper props must include a positive numeric `window` value");
    }

    // Extract optional key prefix for fast-path updates
    let key_prefix = props
        .get("key")
        .and_then(|value| value.as_str())
        .map(|k| k.to_string());

    // Remove control props before constructing the graph
    if let serde_json::Value::Object(map) = &mut props {
        map.remove("window");
        map.remove("key");
    }

    // Create window node with key if a prefix was supplied
    let window_node = match &key_prefix {
        Some(prefix) => el::const_with_key(&format!("{}_window", prefix), window),
        None => el::const_(window),
    };

    Node::new("stridedelay", props, vec![window_node, resolve(x)])
}
