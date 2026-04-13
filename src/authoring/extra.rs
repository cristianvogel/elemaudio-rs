use super::el;
use crate::graph::Node;
use crate::{resolve, unpack, ElemNode};

/// Internal enum for box_sum window input (props or signal).
pub enum BoxSumWindowInput {
    /// Props object with static window and optional key
    Props(serde_json::Value),
    /// Dynamic signal node for sample-rate modulation
    Signal(ElemNode),
}

impl From<serde_json::Value> for BoxSumWindowInput {
    fn from(props: serde_json::Value) -> Self {
        BoxSumWindowInput::Props(props)
    }
}

impl From<Node> for BoxSumWindowInput {
    fn from(node: Node) -> Self {
        BoxSumWindowInput::Signal(ElemNode::Node(node))
    }
}

impl From<f64> for BoxSumWindowInput {
    fn from(value: f64) -> Self {
        BoxSumWindowInput::Signal(ElemNode::Number(value))
    }
}

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
        props,
        vec![amp_node, el::select(should_fold, folded, x)],
    )
}

/// VariSlope SVF — cascaded Butterworth SVF with Rossum-style continuous slope
/// morphing.
///
/// # Overview
///
/// This node exposes a continuously variable filter order (slope) that morphs
/// smoothly between 1 and 6 cascaded second-order Butterworth SVF stages
/// (12–72 dB/oct) at audio rate, inspired by Dave Rossum's analog cascade
/// designs.
///
/// Q is fixed internally at Butterworth (√2 ≈ 1.414, maximally flat magnitude)
/// and is not exposed. The slope is the sole tonal control: one knob that
/// determines how aggressively the filter rolls off.
///
/// All six internal stages run every sample so their integrator states remain
/// warm regardless of the current slope value. The output is a linear crossfade
/// between the two adjacent integer-order outputs that bracket the current slope,
/// so the filter order morphs without clicks, discontinuities, or dropout.
///
/// Per-stage gain correction (matched magnitude at cutoff) prevents the BLT
/// passband droop from compounding across stages.
///
/// # Contrast with `el.svf`
///
/// The vendor `el.svf` is a single-stage Simper SVF (12 dB/oct fixed order)
/// with an exposed Q parameter. `vari_slope_svf` removes Q and adds continuous
/// Butterworth slope morphing as its defining feature.
///
/// # Inputs
///
/// | Index | Signal      | Required | Default  | Notes                         |
/// |-------|-------------|----------|----------|-------------------------------|
/// | 0     | `cutoff_hz` | yes      | —        | Cutoff frequency in Hz        |
/// | 1     | `audio`     | yes      | —        | Audio input signal            |
/// | 2     | `slope`     | no       | `1.0`    | Continuous order \[1.0, 6.0\] |
///
/// # Properties
///
/// | Key          | Type   | Values                              |
/// |--------------|--------|-------------------------------------|
/// | `filterType` | string | `"lowpass"` / `"lp"` (default)      |
/// |              |        | `"highpass"` / `"hp"`               |
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// // Static 24 dB/oct lowpass at 800 Hz (slope = Some).
/// let node = extra::vari_slope_svf(
///     json!({ "filterType": "lowpass" }),
///     el::const_(json!({ "value": 800.0 })),  // cutoff
///     source,                                   // audio
///     Some(el::const_(json!({ "value": 2.0 }))),// slope = 24 dB/oct
/// );
///
/// // Default slope (12 dB/oct) — pass None.
/// let node = extra::vari_slope_svf(
///     json!({ "filterType": "lowpass" }),
///     el::const_(json!({ "value": 800.0 })),
///     source,
///     None::<Node>,
/// );
///
/// // Slope swept from 1.0 → 6.0 by an LFO for a dynamic order morph.
/// let slope_lfo = el::add(
///     el::const_(json!({ "value": 3.5 })),
///     el::mul(el::const_(json!({ "value": 2.5 })),
///             el::cycle(el::const_(json!({ "value": 0.25 })))),
/// );
/// let node = extra::vari_slope_svf(
///     json!({ "filterType": "lowpass" }),
///     cutoff, source, Some(slope_lfo),
/// );
/// ```
pub fn vari_slope_svf(
    props: serde_json::Value,
    cutoff: impl Into<ElemNode>,
    audio: impl Into<ElemNode>,
    slope: Option<impl Into<ElemNode>>,
) -> Node {
    let mut children = vec![resolve(cutoff), resolve(audio)];
    if let Some(s) = slope {
        children.push(resolve(s));
    }
    Node::new("variSlopeSvf", props, children)
}

/// STFT-based channel vocoder.
///
/// Port of Geraint Luff's JSFX Vocoder. Imposes the spectral envelope of the
/// modulator signal onto the carrier signal using per-bin energy envelope
/// following and overlap-add reconstruction.
///
/// # Inputs
///
/// | Index | Signal        | Required | Notes                  |
/// |-------|---------------|----------|------------------------|
/// | 0     | carrier L     | yes      | Left carrier channel   |
/// | 1     | carrier R     | yes      | Right carrier channel  |
/// | 2     | modulator L   | yes      | Left modulator channel |
/// | 3     | modulator R   | yes      | Right modulator channel|
///
/// # Outputs
///
/// Returns 2 outputs: vocoded left and right channels.
///
/// # Properties
///
/// | Key           | Type   | Range   | Default | Notes                      |
/// |---------------|--------|---------|---------|----------------------------|
/// | `windowMs`    | number | 1–100   | 10      | FFT window length in ms    |
/// | `smoothingMs` | number | 0–2000  | 5       | Energy smoothing in ms (high values = spectral sustain) |
/// | `maxGainDb`   | number | 0–100   | 40      | Per-band gain ceiling (dB) |
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// let vocoded = extra::vocoder(
///     json!({ "windowMs": 10, "smoothingMs": 5, "maxGainDb": 40 }),
///     carrier_l, carrier_r,
///     modulator_l, modulator_r,
/// );
/// // vocoded is a Vec of 2 nodes: [out_l, out_r]
/// ```
pub fn vocoder(
    props: serde_json::Value,
    carrier_l: impl Into<ElemNode>,
    carrier_r: impl Into<ElemNode>,
    modulator_l: impl Into<ElemNode>,
    modulator_r: impl Into<ElemNode>,
) -> Vec<Node> {
    let children = vec![
        resolve(carrier_l),
        resolve(carrier_r),
        resolve(modulator_l),
        resolve(modulator_r),
    ];
    unpack(Node::new("vocoder", props, children), 2)
}

/// Raw variable-width box sum helper.
///
/// Computes a box-filter sum over a configurable window length.
///
/// Supports two usage patterns:
///
/// 1. **Static window with keying** (for fast-path parameter updates):
///    Pass props with `window` and `key`. The window can be updated via
///    `mounted.node_with_key("{key}_window")` without rebuilding the graph.
///
/// 2. **Dynamic window signal** (for sample-rate modulation):
///    Pass a signal node as the window parameter for runtime sample-rate control.
///    No keying is available in this mode.
///
/// # Example: Keyed static window with fast-path updates
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
///
/// # Example: Dynamic signal window for sample-rate modulation
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra, WindowParam};
/// use serde_json::json;
///
/// // Window size modulated by an LFO at sample rate
/// let window_lfo = el::mul((
///     el::add([el::const_(256.0), el::const_(128.0)]),
///     el::cycle(el::const_(0.5)),  // 0.5 Hz LFO
/// ));
///
/// let graph = Graph::new().render(
///     extra::box_sum(
///         WindowParam::Dynamic(window_lfo),
///         el::cycle(el::const_(440.0)),
///     )
/// );
///
/// let mounted = graph.mount();
/// runtime.execute(&mounted.into_batch());
/// ```
pub fn box_sum(window: impl Into<BoxSumWindowInput>, x: impl Into<ElemNode>) -> Node {
    match window.into() {
        BoxSumWindowInput::Props(props) => box_sum_from_props(props, x),
        BoxSumWindowInput::Signal(window_signal) => Node::new(
            "boxsum",
            serde_json::Value::Null,
            vec![resolve(window_signal), resolve(x)],
        ),
    }
}

/// Internal helper to construct box_sum from props with keying support.
fn box_sum_from_props(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
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
/// Supports two usage patterns:
///
/// 1. **Static window with keying** (for fast-path parameter updates):
///    Pass props with `window` and `key`. The window can be updated via
///    `mounted.node_with_key("{key}_window")` without rebuilding the graph.
///
/// 2. **Dynamic window signal** (for sample-rate modulation):
///    Pass a signal node as the window parameter for runtime sample-rate control.
///    No keying is available in this mode.
///
/// # Example: Keyed static window with fast-path updates
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
///
/// # Example: Dynamic signal window for sample-rate modulation
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra};
///
/// // Window size modulated by an LFO at sample rate
/// let window_lfo = el::mul((
///     el::add([el::const_(256.0), el::const_(128.0)]),
///     el::cycle(el::const_(0.5)),  // 0.5 Hz LFO
/// ));
///
/// let graph = Graph::new().render(
///     extra::box_average(
///         window_lfo,
///         el::white(),
///     )
/// );
///
/// let mounted = graph.mount();
/// runtime.execute(&mounted.into_batch());
/// ```
pub fn box_average(window: impl Into<BoxAverageWindowInput>, x: impl Into<ElemNode>) -> Node {
    match window.into() {
        BoxAverageWindowInput::Props(props) => box_average_from_props(props, x),
        BoxAverageWindowInput::Signal(window_signal) => Node::new(
            "boxaverage",
            serde_json::Value::Null,
            vec![resolve(window_signal), resolve(x)],
        ),
    }
}

/// Internal enum for box_average window input (props or signal).
pub enum BoxAverageWindowInput {
    /// Props object with static window and optional key
    Props(serde_json::Value),
    /// Dynamic signal node for sample-rate modulation
    Signal(ElemNode),
}

impl From<serde_json::Value> for BoxAverageWindowInput {
    fn from(props: serde_json::Value) -> Self {
        BoxAverageWindowInput::Props(props)
    }
}

impl From<Node> for BoxAverageWindowInput {
    fn from(node: Node) -> Self {
        BoxAverageWindowInput::Signal(ElemNode::Node(node))
    }
}

impl From<f64> for BoxAverageWindowInput {
    fn from(value: f64) -> Self {
        BoxAverageWindowInput::Signal(ElemNode::Number(value))
    }
}

/// Internal helper to construct box_average from props with keying support.
fn box_average_from_props(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
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

/// Native lookahead limiter helper (mono).
///
/// # Props
///
/// | Key               | Type   | Default              | Notes                   |
/// |-------------------|--------|----------------------|-------------------------|
/// | `key`             | string | —                    | Optional node identity  |
/// | `maxDelayMs`      | number | 100                  | Lookahead buffer length |
/// | `inputGain`       | number | 1                    | Pre-limiter gain        |
/// | `outputLimit`     | number | 10^(-3/20) ≈ 0.708  | Maximum output level    |
/// | `attackMs`        | number | 20                   | Attack time             |
/// | `holdMs`          | number | 0                    | Hold time after peaks   |
/// | `releaseMs`       | number | 0                    | Extra release time      |
/// | `smoothingStages` | number | 1                    | Smoothing filter stages |
/// | `linkChannels`    | number | 0.5                  | Channel gain linking    |
pub fn limiter(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    let resolved_props = limiter_resolve_defaults(props);
    Node::new("limiter", resolved_props, vec![resolve(x)])
}

/// Native lookahead limiter helper (stereo).
///
/// Same props as [`limiter`]; takes two audio inputs and returns
/// two output nodes via `unpack`.
pub fn stereo_limiter(
    props: serde_json::Value,
    left: impl Into<ElemNode>,
    right: impl Into<ElemNode>,
) -> Vec<Node> {
    let resolved_props = limiter_resolve_defaults(props);
    unpack(
        Node::new(
            "limiter",
            resolved_props,
            vec![resolve(left), resolve(right)],
        ),
        2,
    )
}

/// Apply defaults for limiter props to match the TS surface.
fn limiter_resolve_defaults(props: serde_json::Value) -> serde_json::Value {
    let mut map = match props {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };

    map.entry("maxDelayMs")
        .or_insert_with(|| serde_json::Value::from(100.0));
    map.entry("inputGain")
        .or_insert_with(|| serde_json::Value::from(1.0));
    // -3 dBFS = 10^(-3/20)
    map.entry("outputLimit")
        .or_insert_with(|| serde_json::Value::from(10.0_f64.powf(-3.0 / 20.0)));
    map.entry("attackMs")
        .or_insert_with(|| serde_json::Value::from(20.0));
    map.entry("holdMs")
        .or_insert_with(|| serde_json::Value::from(0.0));
    map.entry("releaseMs")
        .or_insert_with(|| serde_json::Value::from(0.0));
    map.entry("smoothingStages")
        .or_insert_with(|| serde_json::Value::from(1));
    map.entry("linkChannels")
        .or_insert_with(|| serde_json::Value::from(0.5));

    serde_json::Value::Object(map)
}

/// Stride-interpolated delay helper (mono).
///
/// `delay_ms` and `fb` are signal children read at sample rate by the
/// native node. Use `el::const_with_key(...)` for fast-path parameter
/// updates, or any signal expression for modulation.
///
/// # Props (structural, not modulation targets)
///
/// | Key            | Type   | Default    | Notes                          |
/// |----------------|--------|------------|--------------------------------|
/// | `key`          | string | —          | Optional stable node identity  |
/// | `maxDelayMs`   | number | 1000       | Maximum delay buffer length    |
/// | `transitionMs` | number | 100        | Crossfade length in ms         |
/// | `bigLeapMode`  | string | "linear"   | "linear" or "step"             |
///
/// # Children layout
///
/// `[delay_ms, fb, audio_input]`
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{Graph, el, extra};
/// use serde_json::json;
///
/// let delayed = extra::stride_delay(
///     json!({ "maxDelayMs": 1500, "transitionMs": 60 }),
///     el::const_with_key("delay", 250.0),   // delay_ms signal
///     el::const_with_key("fb", 0.3),         // fb signal
///     el::r#in(json!({"channel": 0}), None), // audio input
/// );
/// ```
pub fn stride_delay(
    props: serde_json::Value,
    delay_ms: impl Into<ElemNode>,
    fb: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    let resolved_props = stride_delay_resolve_defaults(props);
    Node::new(
        "stridedelay",
        resolved_props,
        vec![resolve(delay_ms), resolve(fb), resolve(x)],
    )
}

/// Stride-interpolated delay helper (stereo).
///
/// Same props as [`stride_delay`]; takes two audio inputs and returns
/// two output nodes via `unpack`.
pub fn stereo_stride_delay(
    props: serde_json::Value,
    delay_ms: impl Into<ElemNode>,
    fb: impl Into<ElemNode>,
    left: impl Into<ElemNode>,
    right: impl Into<ElemNode>,
) -> Vec<Node> {
    let resolved_props = stride_delay_resolve_defaults(props);
    unpack(
        Node::new(
            "stridedelay",
            resolved_props,
            vec![
                resolve(delay_ms),
                resolve(fb),
                resolve(left),
                resolve(right),
            ],
        ),
        2,
    )
}

/// Apply defaults for stride_delay props.
fn stride_delay_resolve_defaults(props: serde_json::Value) -> serde_json::Value {
    let mut map = match props {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };

    map.entry("maxDelayMs")
        .or_insert_with(|| serde_json::Value::from(1000.0));
    map.entry("transitionMs")
        .or_insert_with(|| serde_json::Value::from(100.0));
    map.entry("bigLeapMode")
        .or_insert_with(|| serde_json::Value::from("linear"));

    serde_json::Value::Object(map)
}
