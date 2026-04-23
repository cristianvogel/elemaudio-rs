use super::el;
use crate::graph::Node;
use crate::{ElemNode, resolve, unpack};

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
        .unwrap_or_else(|| {
            log::error!(
                "extra helper: props missing required positive integer 'channels', defaulting to 1"
            );
            1
        }) as usize;

    if let serde_json::Value::Object(map) = &mut props {
        map.remove("channels");
    }

    (channels, props)
}

/// Frequency shifter helper.
///
/// Returns two roots in fixed order: lower sideband, then upper sideband.
///
/// Props:
/// - `reflect`: integer mode for negative shift handling
/// - `fbSource`: `"lower"` or `"upper"` to select the feedback band
///
/// Child order:
/// - `shift_hz`: audio-rate shift amount in Hz
/// - `feedback`: audio-rate feedback amount (clamped per-sample to `[0, 0.999]`)
/// - `x`: audio input
pub fn freqshift(
    props: serde_json::Value,
    shift_hz: impl Into<ElemNode>,
    feedback: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Vec<Node> {
    unpack(
        Node::new(
            "freqshift",
            props,
            vec![resolve(shift_hz), resolve(feedback), resolve(x)],
        ),
        2,
    )
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
    let thresh = match props.get("thresh").and_then(|v| v.as_f64()) {
        Some(t) if t.is_finite() && t > 0.0 => t,
        _ => {
            log::error!(
                "foldback: props missing required positive 'thresh' value, returning passthrough"
            );
            return resolve(x);
        }
    };

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
    let window = match props.get("window").and_then(|v| v.as_f64()) {
        Some(w) if w.is_finite() && w > 0.0 => w,
        _ => {
            log::error!(
                "box_sum: props missing required positive 'window' value, returning silence"
            );
            return el::const_(0.0);
        }
    };

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
    let window = match props.get("window").and_then(|v| v.as_f64()) {
        Some(w) if w.is_finite() && w > 0.0 => w,
        _ => {
            log::error!(
                "box_average: props missing required positive 'window' value, returning silence"
            );
            return el::const_(0.0);
        }
    };

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

/// Stride delay with a feedback insert loop (mono).
///
/// The `insert` closure receives the **feedback audio signal** — the
/// actual delayed audio coming back through the tap — and returns a
/// processed version (e.g., filtered, pitch-shifted). The `fb` argument
/// is the **feedback amount** (a gain coefficient) applied to the insert
/// return before summing back into the delay input.
///
/// Requires `"fbtap"` in props — a unique name for the tapIn/tapOut pair.
///
/// # Props
///
/// Same as [`stride_delay`] plus:
///
/// | Key       | Type   | Required | Notes                              |
/// |-----------|--------|----------|------------------------------------|
/// | `fbtap`   | string | yes      | Unique tap name for feedback loop  |
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// // Delay with a lowpass filter darkening each repeat
/// let delayed = extra::stride_delay_with_insert(
///     json!({ "maxDelayMs": 1500, "transitionMs": 60, "fbtap": "fb_loop" }),
///     el::const_with_key("delay", 250.0),    // delay time
///     el::const_with_key("fb_amt", 0.5),     // feedback amount
///     |fb_audio| {
///         // fb_audio is the delayed signal coming back through the loop.
///         // Filter it so each repeat gets darker.
///         el::lowpass(el::const_(2000.0), el::const_(0.707), fb_audio)
///     },
///     el::r#in(json!({"channel": 0}), None), // audio input
/// );
/// ```
///
/// # Signal flow
///
/// ```text
///                    ┌─── insert(fb_audio) ◄── tapIn(fbtap)
///                    ▼
/// fb_amount * insert_return ──┐
///                              ▼
/// audio_input ────────── add ──► stridedelay(internal fb=0)
///                                       │
///                               tapOut(fbtap) ──► output
/// ```
///
/// Note: the feedback path has 1-block latency (tapIn/tapOut).
pub fn stride_delay_with_insert(
    props: serde_json::Value,
    delay_ms: impl Into<ElemNode>,
    fb: impl Into<ElemNode>,
    insert: impl FnOnce(Node) -> Node,
    x: impl Into<ElemNode>,
) -> Node {
    let mut props = props;

    // Extract fbtap name from props. Fall back to stride_delay without insert.
    let Some(fbtap) = props
        .get("fbtap")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    else {
        log::error!(
            "stride_delay_with_insert: missing 'fbtap' prop, falling back to stride_delay without insert"
        );
        return stride_delay(props, delay_ms, fb, x);
    };

    // Remove fbtap before passing to the native node.
    if let serde_json::Value::Object(ref mut map) = props {
        map.remove("fbtap");
    }

    let resolved_props = stride_delay_resolve_defaults(props);
    let input = resolve(x);
    let fb_signal = resolve(fb);

    // Tap the feedback audio from the previous block.
    let fb_audio = el::tap_in(serde_json::json!({"name": fbtap}));

    // User processes the feedback audio.
    let processed = insert(fb_audio);

    // Apply feedback amount to processed return, sum with input.
    let feedback_mix = el::mul((fb_signal, processed));
    let summed_input = el::add((input, feedback_mix));

    // Run delay with internal fb=0 (external loop handles feedback).
    let delayed = Node::new(
        "stridedelay",
        resolved_props,
        vec![resolve(delay_ms), resolve(0.0), summed_input],
    );

    // Tap the output for next block's feedback.
    el::tap_out(serde_json::json!({"name": fbtap}), delayed)
}

/// Stereo stride delay with feedback insert loops.
///
/// Builds two independent mono insert delays (L/R) with per-channel
/// tap names derived from `props.fbtap`: `"{fbtap}:L"` and `"{fbtap}:R"`.
///
/// The `insert` closure is called twice — once per channel — with the
/// feedback audio and a channel tag (`"L"` or `"R"`) so the user can
/// create per-channel keyed nodes inside the insert chain.
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// let [left, right] = extra::stereo_stride_delay_with_insert(
///     json!({ "maxDelayMs": 1500, "transitionMs": 60, "fbtap": "fb" }),
///     el::const_with_key("delay", 250.0),
///     el::const_with_key("fb_amt", 0.5),
///     |fb_audio, tag| {
///         el::lowpass(
///             el::const_with_key(&format!("insert_fc:{tag}"), 2000.0),
///             el::const_(0.707),
///             fb_audio,
///         )
///     },
///     el::r#in(json!({"channel": 0}), None),
///     el::r#in(json!({"channel": 1}), None),
/// );
/// ```
pub fn stereo_stride_delay_with_insert(
    props: serde_json::Value,
    delay_ms: impl Into<ElemNode>,
    fb: impl Into<ElemNode>,
    insert: impl Fn(Node, &str) -> Node,
    left: impl Into<ElemNode>,
    right: impl Into<ElemNode>,
) -> [Node; 2] {
    let mut props_obj = match props {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };

    let Some(fbtap) = props_obj
        .get("fbtap")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    else {
        log::error!(
            "stereo_stride_delay_with_insert: missing 'fbtap' prop, falling back to stereo stride_delay without insert"
        );
        let props_val = serde_json::Value::Object(props_obj);
        let resolved = stride_delay_resolve_defaults(props_val);
        let dl = resolve(delay_ms);
        let fb_n = resolve(fb);
        return [
            Node::new(
                "stridedelay",
                resolved.clone(),
                vec![dl.clone(), fb_n.clone(), resolve(left)],
            ),
            Node::new("stridedelay", resolved, vec![dl, fb_n, resolve(right)]),
        ];
    };
    props_obj.remove("fbtap");

    let resolved_props = stride_delay_resolve_defaults(serde_json::Value::Object(props_obj));
    let delay_node = resolve(delay_ms);
    let fb_node = resolve(fb);

    let build_channel = |input: Node, tag: &str| -> Node {
        let tap_name = format!("{fbtap}:{tag}");

        let fb_audio = el::tap_in(serde_json::json!({"name": &tap_name}));
        let processed = insert(fb_audio, tag);

        let feedback_mix = el::mul((fb_node.clone(), processed));
        let summed_input = el::add((input, feedback_mix));

        let delayed = Node::new(
            "stridedelay",
            resolved_props.clone(),
            vec![delay_node.clone(), resolve(0.0), summed_input],
        );

        el::tap_out(serde_json::json!({"name": &tap_name}), delayed)
    };

    [
        build_channel(resolve(left), "L"),
        build_channel(resolve(right), "R"),
    ]
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

// ---- interpolateN (energy-preserving N-way crossfade) -----------------

/// Energy-preserving N-way crossfading mixer.
///
/// Crossfades between a vector of N mono signal nodes using a normalised
/// interpolator index. All nodes are equally spaced along the
/// interpolator path.
///
/// ## Props
///
/// | Key         | Type | Default | Notes                                      |
/// |-------------|------|---------|--------------------------------------------|
/// | `barberpole`| bool | false   | Wrap the interpolator circularly (ring)    |
///
/// **Without barberpole** (default): interpolator is clamped to [0, 1].
/// `0` = first node, `1` = last node. Linear path.
///
/// **With barberpole**: nodes are on a circular ring. `0` and `1` both
/// map to the first node. The last node crossfades back into the first.
/// Values outside [0, 1] wrap seamlessly.
///
/// The crossfade uses the Signalsmith cheap energy-preserving curve:
/// `smoothstep(x) = 3x² − 2x³` passed through `sqrt` for equal-power
/// behaviour. See <https://signalsmith-audio.co.uk/writing/2021/cheap-energy-crossfade/>
///
/// # Arguments
///
/// - `props` — optional `{ "barberpole": true }`
/// - `interpolator` — position signal
/// - `nodes` — vector of mono signal nodes to crossfade between
///
/// Returns silence if fewer than 2 nodes are provided.
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// // Linear (clamped) crossfade between 3 oscillators
/// let mix = extra::interpolate_n(
///     json!({}),
///     el::const_with_key("xfade", 0.5),
///     vec![osc_a, osc_b, osc_c],
/// );
///
/// // Barberpole: wraps around, bipolar LFO is fine
/// let morph = extra::interpolate_n(
///     json!({ "barberpole": true }),
///     el::cycle(el::const_(0.1)),
///     vec![osc_a, osc_b, osc_c],
/// );
/// ```
pub fn interpolate_n(
    props: serde_json::Value,
    interpolator: impl Into<ElemNode>,
    nodes: Vec<impl Into<ElemNode>>,
) -> Node {
    let n = nodes.len();
    if n < 2 {
        log::error!("interpolate_n: requires at least 2 nodes, got {n}");
        return match nodes.into_iter().next() {
            Some(node) => resolve(node),
            None => el::const_(0.0),
        };
    }

    let barberpole = props
        .get("barberpole")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let resolved: Vec<Node> = nodes.into_iter().map(resolve).collect();
    let interp = resolve(interpolator);

    if barberpole {
        interpolate_n_barberpole(interp, resolved, n)
    } else {
        interpolate_n_clamped(interp, resolved, n)
    }
}

/// Clamped linear interpolation: [0, 1] maps to [first, last].
fn interpolate_n_clamped(interp: Node, resolved: Vec<Node>, n: usize) -> Node {
    // Clamp to [0, 1]
    let clamped = el::min(1.0, el::max(0.0, interp));

    // pos = clamped * (N - 1), maps [0,1] to [0, N-1]
    let pos = el::mul((clamped, (n - 1) as f64));

    let weighted: Vec<Node> = resolved
        .into_iter()
        .enumerate()
        .map(|(i, node)| {
            let dist = el::abs(el::sub((pos.clone(), i as f64)));
            let proximity = el::max(0.0, el::sub((1.0, dist)));
            let ss = el::mul((
                el::mul((proximity.clone(), proximity.clone())),
                el::sub((3.0, el::mul((2.0, proximity)))),
            ));
            let gain = el::sqrt(ss);
            el::mul((node, gain))
        })
        .collect();

    weighted
        .into_iter()
        .reduce(|acc, x| el::add((acc, x)))
        .unwrap_or_else(|| el::const_(0.0))
}

/// Barberpole wrapping: nodes on a circular ring, [0, 1) wraps.
fn interpolate_n_barberpole(interp: Node, resolved: Vec<Node>, n: usize) -> Node {
    // fract(x) = x - floor(x) — wraps any value to [0, 1)
    let fract = el::sub((interp.clone(), el::floor(interp)));

    // pos = fract * N, maps [0, 1) to [0, N)
    let n_f = n as f64;
    let pos = el::mul((fract, n_f));

    let weighted: Vec<Node> = resolved
        .into_iter()
        .enumerate()
        .map(|(i, node)| {
            let linear_dist = el::abs(el::sub((pos.clone(), i as f64)));
            // Circular distance: min(linear, N - linear)
            let circular_dist = el::min(linear_dist.clone(), el::sub((n_f, linear_dist)));
            let proximity = el::max(0.0, el::sub((1.0, circular_dist)));
            let ss = el::mul((
                el::mul((proximity.clone(), proximity.clone())),
                el::sub((3.0, el::mul((2.0, proximity)))),
            ));
            let gain = el::sqrt(ss);
            el::mul((node, gain))
        })
        .collect();

    weighted
        .into_iter()
        .reduce(|acc, x| el::add((acc, x)))
        .unwrap_or_else(|| el::const_(0.0))
}

/// Sample-accurate one-shot 0→1 ramp.
///
/// On a rising edge of `x` (trigger crossing 0.5 upward), the signal increments
/// linearly from 0 to 1 over `dur` samples, then drops instantly back to 0 on
/// the next sample — hence the `00` suffix: the output starts at 0 and ends at
/// 0. Ideal as a sample-accurate envelope gate, a percussive modulator trigger,
/// or a duration-controlled one-shot LFO.
///
/// # Arguments (AGENTS.md order: props first, trigger/input last)
/// - `props` — see below
/// - `dur`  — ramp duration in **samples** (signal; may vary per-sample)
/// - `x`    — trigger signal; a rising edge through 0.5 starts the ramp
///
/// # Props
/// - `key`     : optional authoring key for stable identity
/// - `blocking`: `bool`, default `true`. When `true`, triggers are ignored
///   while the ramp is running (i.e. until the output returns to exactly 0).
///   When `false`, any rising edge restarts the ramp from 0.
///
/// # dur semantics
/// - `dur` is read every sample and the per-sample increment is `1 / dur`.
/// - If `dur` changes mid-ramp, the current value is preserved and only the
///   slope updates (smooth continuation at the new rate).
/// - If `dur <= 0` at the moment of a would-be trigger, the trigger is ignored.
/// - If `dur <= 0` while the ramp is running, the ramp aborts and the output
///   snaps to 0.
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// // 4800-sample (100 ms @ 48kHz) ramp, retriggered by a 2 Hz train,
/// // with retrigger blocking while the ramp is running.
/// let ramp = extra::ramp00(
///     json!({ "blocking": true }),
///     el::const_(4800.0),
///     el::train(el::const_(2.0)),
/// );
/// ```
pub fn ramp00(props: serde_json::Value, dur: impl Into<ElemNode>, x: impl Into<ElemNode>) -> Node {
    let resolved_props = ramp00_resolve_defaults(props);
    Node::new("ramp00", resolved_props, vec![resolve(dur), resolve(x)])
}

/// Apply defaults for `ramp00` props.
fn ramp00_resolve_defaults(props: serde_json::Value) -> serde_json::Value {
    let mut map = match props {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };

    map.entry("blocking")
        .or_insert_with(|| serde_json::Value::from(true));

    serde_json::Value::Object(map)
}

/// Sample-accurate threshold gate with optional hold/reset behavior.
///
/// Child order follows the requested contract: `[threshold, reset, x]`.
///
/// - `threshold` is read at sample rate.
/// - `reset` is only used when `latch = true`.
/// - `x` is the observed signal.
///
/// Props:
/// - `key`: optional authoring key for stable identity
/// - `hysteresis`: hysteresis width around the threshold, default `0`
/// - `latch`: when `true`, output holds at `1` until `reset` rises;
///   when `false`, `reset` is ignored and the node emits threshold-gate pulses
///
/// Vendor comparators already cover basic thresholding. This node is the
/// threshold-gate variant: it rearms when `x <= threshold - hysteresis/2`, then
/// fires when `x > threshold + hysteresis/2`.
pub fn threshold(
    props: serde_json::Value,
    threshold: impl Into<ElemNode>,
    reset: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    let resolved_props = threshold_resolve_defaults(props);
    Node::new(
        "threshold",
        resolved_props,
        vec![resolve(threshold), resolve(reset), resolve(x)],
    )
}

fn threshold_resolve_defaults(props: serde_json::Value) -> serde_json::Value {
    let mut map = match props {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };

    map.entry("hysteresis")
        .or_insert_with(|| serde_json::Value::from(0.0));
    map.entry("latch")
        .or_insert_with(|| serde_json::Value::from(false));
    serde_json::Value::Object(map)
}

/// Always-multichannel sample playback helper.
///
/// Child order: `[start, end, rate, gain_db, trigger]`.
///
/// The native node always returns two output roots. Mono sources are copied to
/// both channels. Playback always loops inside the normalized `[start, end]`
/// region. `gain_db` is an audio-rate stereo gain control shared by both
/// outputs and converted to linear gain in the native node.
///
/// Typical `gain_db` range is `0` down to silence, with optional positive
/// headroom such as `+6 dB` when desired by the caller.
pub fn sample(
    props: serde_json::Value,
    start: impl Into<ElemNode>,
    end: impl Into<ElemNode>,
    rate: impl Into<ElemNode>,
    gain_db: impl Into<ElemNode>,
    trigger: impl Into<ElemNode>,
) -> Vec<Node> {
    unpack(
        Node::new(
            "extra.sample",
            props,
            vec![
                resolve(start),
                resolve(end),
                resolve(rate),
                resolve(gain_db),
                resolve(trigger),
            ],
        ),
        2,
    )
}

/// Emit the length of a VFS-resident audio resource as a constant signal,
/// optionally scaled into a natural domain (`samp`, `ms`, or `hz`).
///
/// Shape mirrors [`el::sr`](crate::el::sr) and [`el::time`](crate::el::time):
/// zero children, one output, a constant value per sample. The native node
/// computes the scaled value once on the message thread (at `setProperty`
/// time) and streams it out through a `std::fill_n` — the audio loop does
/// no division, no unit parsing, and no allocation.
///
/// # Props
///
/// | Key    | Type     | Required | Default  | Notes                                                                             |
/// |--------|----------|----------|----------|-----------------------------------------------------------------------------------|
/// | `path` | `String` | yes      | —        | VFS key of a previously-added resource                                            |
/// | `unit` | `String` | no       | `"samp"` | Output domain: `"samp"` (raw sample count), `"ms"`, or `"hz"` (1/duration)        |
/// | `key`  | `String` | no       | —        | Optional authoring key for stable identity                                        |
///
/// ## Unit semantics
///
/// Let `len` be the asset's per-channel frame count and `sr` the current
/// runtime sample rate:
///
/// | `unit`   | Output value              | Example (1s @ 48 kHz)      |
/// |----------|---------------------------|-----------------------------|
/// | `"samp"` | `len`                     | 48000                       |
/// | `"ms"`   | `1000 × len / sr`         | 1000.0                      |
/// | `"hz"`   | `sr / len`                | 1.0                         |
///
/// The `"hz"` mode is the fundamental *period* frequency — the reciprocal
/// of the asset's duration in seconds. For a 2-second asset this is
/// `0.5 Hz`. Useful as a `phasor` rate to clock the asset exactly once per
/// cycle.
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{extra, Graph, Runtime};
/// use serde_json::json;
///
/// let runtime = Runtime::new()
///     .sample_rate(48_000.0)
///     .buffer_size(64)
///     .call()
///     .unwrap();
///
/// let samples: Vec<f32> = vec![0.0; 48_000];
/// runtime.add_shared_resource_f32("my-asset", &samples).unwrap();
/// let len_hz = extra::sample_count(json!({ "path": "my-asset", "unit": "hz" }));
/// ```
pub fn sample_count(props: serde_json::Value) -> Node {
    Node::new("sampleCount", props, vec![])
}

/// Fixed-period frame clock anchored to absolute sample time.
///
/// Emits a one-sample pulse at absolute sample indices
/// `0, period, 2*period, ...` regardless of backend block size.
///
/// `period` is measured in samples and must be positive.
pub fn frameclock(period: usize) -> Node {
    Node::new(
        "frameclock",
        serde_json::json!({ "period": period }),
        vec![],
    )
}

/// Frame-synchronised integer delay line whose delay unit is whole frames.
///
/// Props:
/// - `framelength`: positive integer frame size in samples
/// - `maxframes`: maximum supported delay in frames
/// - `key`: optional authoring key
///
/// Inputs:
/// - `delay_frames`: integer delay time in frames, sampled only at frame boundaries
/// - `x`: input signal to delay
pub fn frame_delay(
    props: serde_json::Value,
    delay_frames: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_delay");
    Node::new("frameDelay", props, vec![resolve(delay_frames), resolve(x)])
}

/// Frame-synchronised derivative against the previous frame at the same sample offset.
///
/// Emits `x[n] - x[n - framelength]` with a fixed latency of one frame.
///
/// Props:
/// - `framelength`: positive integer frame size in samples
/// - `key`: optional authoring key
pub fn frame_derivative(props: serde_json::Value, x: impl Into<ElemNode>) -> Node {
    assert_even_framelength(&props, "frame_derivative");
    Node::new("frameDerivative", props, vec![resolve(x)])
}

/// Frame-synchronised scope that emits one exact frame of samples per event.
///
/// Props:
/// - `framelength`: positive integer frame size in samples
/// - `name`: event source identifier
/// - `key`: optional authoring key
///
/// Inputs:
/// - one or more signals to capture in lockstep across each frame
pub fn frame_scope<T>(props: serde_json::Value, args: impl IntoIterator<Item = T>) -> Node
where
    T: Into<ElemNode>,
{
    assert_even_framelength(&props, "frame_scope");
    Node::new("frameScope", props, args.into_iter().map(resolve).collect())
}

/// Absolute-sample-aligned frame phasor with frame-latched shaping controls.
///
/// Props:
/// - `framelength`: positive integer frame size in samples
/// - `key`: optional authoring key
///
/// Inputs (all latched on frame boundaries):
/// - `offset`: vertical DC offset added after curvature/scale; hard-clipped bipolar result
/// - `shift`: horizontal phase rotation in integer samples, wrapped into the frame
/// - `curvature`: bipolar phase warp amount
/// - `scale`: bipolar vertical amplitude scale applied to the curved phase;
///   negative values mirror the phasor vertically; final output hard-clipped to [-1, 1]
pub fn frame_phasor(
    props: serde_json::Value,
    offset: impl Into<ElemNode>,
    shift: impl Into<ElemNode>,
    curvature: impl Into<ElemNode>,
    scale: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_phasor");
    Node::new(
        "framePhasor",
        props,
        vec![
            resolve(offset),
            resolve(shift),
            resolve(curvature),
            resolve(scale),
        ],
    )
}

/// Absolute-sample-aligned frame shaper oscillator with frame-latched controls.
///
/// Starts flat at `wave = 0`, morphs to a full bipolar triangle at
/// `|wave| = 0.5`, then morphs onward to a full bipolar sine at
/// `|wave| = 1`. Negative `wave` values invert the oscillator core vertically.
///
/// Props:
/// - `framelength`: positive even integer frame size in samples
/// - `key`: optional authoring key
///
/// Inputs (all latched on frame boundaries):
/// - `offset`: vertical DC offset added after shaping
/// - `shift`: horizontal phase rotation in integer samples, wrapped into the frame
/// - `tilt`: center-skew amount that asymmetrically remaps the frame phase
/// - `zoom`: horizontal zoom around the center track; `< 1` zooms inward, `> 1` contracts inward
/// - `scale`: bipolar vertical amplitude scale applied after the waveform is chosen
/// - `wave`: shape morph and vertical polarity control for the oscillator core
pub fn frame_shaper(
    props: serde_json::Value,
    offset: impl Into<ElemNode>,
    shift: impl Into<ElemNode>,
    tilt: impl Into<ElemNode>,
    zoom: impl Into<ElemNode>,
    scale: impl Into<ElemNode>,
    wave: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_shaper");

    Node::new(
        "frameShaper",
        props,
        vec![
            resolve(offset),
            resolve(shift),
            resolve(tilt),
            resolve(zoom),
            resolve(scale),
            resolve(wave),
        ],
    )
}

/// Frame PolySignal / Frame MultiLFO primitive.
///
/// Reads a source wavetable by normalized phase for each track in the frame and
/// de-correlates the tracks over time using a base low-rate `bpm` plus two
/// per-track control signals:
/// - `shape_phases`: scales an internal full ramp [-1, 1] into per-track lookup phase offsets
/// - `shape_frequencies`: scales an internal full ramp [-1, 1] into per-track rate multiplier bias
///
/// If `path` is omitted, the source defaults to an internal sine wave.
///
/// Current reset behavior:
/// - `reset` input still accepts a rising-edge signal and performs a hard native reset
/// - `resetcounter` prop, when changed between renders, also requests a hard native reset
/// - the hard reset clears drift phases and the latched `bpm` / spread state
pub fn frame_poly_signal(
    props: serde_json::Value,
    shape_phases: impl Into<ElemNode>,
    shape_frequencies: impl Into<ElemNode>,
    reset: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_poly_signal");
    Node::new(
        "framePolySignal",
        props,
        vec![resolve(shape_phases), resolve(shape_frequencies), resolve(reset)],
    )
}

/// Frame-synchronised select helper.
///
/// Latches the boolean interpretation of `condition` on each absolute frame
/// boundary and holds that branch choice for the full frame while passing the
/// selected sample-rate branch through unchanged.
pub fn frame_select(
    props: serde_json::Value,
    condition: impl Into<ElemNode>,
    when_true: impl Into<ElemNode>,
    when_false: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_select");
    Node::new(
        "frameSelect",
        props,
        vec![resolve(condition), resolve(when_true), resolve(when_false)],
    )
}

/// WireFrames-style frame-domain smoothing processor with per-track SR modulation.
///
/// The base `time_constant` is shaped per track using the same order-4 law as
/// `frame_random_walks`: shaper `0` keeps the default time, `1` makes it 16x
/// faster, and `-1` makes it 16x slower.
///
/// Props:
/// - `framelength`: positive even integer frame size in samples
/// - `key`: optional authoring key
pub fn frame_smooth(
    props: serde_json::Value,
    time_constant: impl Into<ElemNode>,
    time_constant_frame_shaper: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_smooth");
    Node::new(
        "frameSmooth",
        props,
        vec![
            resolve(time_constant),
            resolve(time_constant_frame_shaper),
            resolve(x),
        ],
    )
}

/// WireFrames-style bidirectional frame-domain smoother with separate attack
/// and release times plus per-track frame shapers for both directions.
pub fn frame_bidi_smooth(
    props: serde_json::Value,
    attack_time: impl Into<ElemNode>,
    release_time: impl Into<ElemNode>,
    attack_frame_shaper: impl Into<ElemNode>,
    release_frame_shaper: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_bidi_smooth");
    Node::new(
        "frameBiDiSmooth",
        props,
        vec![
            resolve(attack_time),
            resolve(release_time),
            resolve(attack_frame_shaper),
            resolve(release_frame_shaper),
            resolve(x),
        ],
    )
}

/// WireFrames-style RAM writer for a live mono frame stream.
///
/// Captures one full frame from `x` and writes the completed frame into a
/// runtime-owned RAM buffer addressed by `path`. The write commits on the next
/// frame boundary, so downstream readers observe coherent whole-frame updates.
///
/// Props:
/// - `framelength`: positive even integer frame size in samples
/// - `path`: RAM slot identifier shared with readers like `el::table`
/// - `key`: optional authoring key
pub fn frame_write_ram(
    props: serde_json::Value,
    x: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_write_ram");
    Node::new("frameWriteRAM", props, vec![resolve(x)])
}

/// Wrapping addition inside a runtime range `[min, max)`.
pub fn wrap_add(
    min: impl Into<ElemNode>,
    max: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
    y: impl Into<ElemNode>,
) -> Node {
    Node::new(
        "wrapAdd",
        serde_json::Value::Null,
        vec![resolve(min), resolve(max), resolve(x), resolve(y)],
    )
}

/// Mirror-reflected addition inside a runtime range `[min, max]`.
pub fn mirror_add(
    min: impl Into<ElemNode>,
    max: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
    y: impl Into<ElemNode>,
) -> Node {
    Node::new(
        "mirrorAdd",
        serde_json::Value::Null,
        vec![resolve(min), resolve(max), resolve(x), resolve(y)],
    )
}

fn assert_even_framelength(props: &serde_json::Value, helper: &str) {
    if let Some(frame_length) = props.get("framelength").and_then(serde_json::Value::as_i64) {
        assert!(
            frame_length > 0 && frame_length % 2 == 0,
            "{helper} requires an even positive framelength"
        );
    }
}

/// Frame-synchronised packed random walks with per-track step/time shaping.
///
/// Props:
/// - `framelength`: positive integer frame size in samples
/// - `seed`: optional deterministic seed, with `0` treated as `1`
/// - `absolute`: optional positive-only output mode
/// - `interpolation`: optional cosine interpolation mode, defaults to `true`
/// - `startingfrom`: optional reset value for all tracks before initial deviation
/// - `initialdeviation`: optional maximum reset deviation from `startingfrom`
/// - `key`: optional authoring key
///
/// Inputs:
/// - `step_size`: maximum random deviation per step
/// - `time_constant`: nominal step duration in seconds
/// - `step_size_frame_shaper`: per-track order-4 scaler for `step_size`
/// - `time_constant_frame_shaper`: per-track inverse order-4 scaler for `time_constant`
pub fn frame_random_walks(
    props: serde_json::Value,
    step_size: impl Into<ElemNode>,
    time_constant: impl Into<ElemNode>,
    step_size_frame_shaper: impl Into<ElemNode>,
    time_constant_frame_shaper: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_random_walks");
    Node::new(
        "frameRandomWalks",
        props,
        vec![
            resolve(step_size),
            resolve(time_constant),
            resolve(step_size_frame_shaper),
            resolve(time_constant_frame_shaper),
        ],
    )
}

/// Frame-synchronous single-value getter with queued event output.
///
/// Props:
/// - `framelength`: positive integer frame size in samples
/// - `name`: event source identifier
/// - `key`: optional authoring key
///
/// Inputs:
/// - `index`: frame-rate-synchronised sample index, latched on frame boundaries
/// - `x`: source signal to read and pass through unchanged
pub fn frame_value(
    props: serde_json::Value,
    index: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    assert_even_framelength(&props, "frame_value");
    Node::new("frameValue", props, vec![resolve(index), resolve(x)])
}

/// Sparse random impulses with optional decaying release.
///
/// Inspired by SuperCollider's `Dust` with a twist: each impulse
/// can have a trailing exponential decay instead of being a single-sample
/// spike. Releases overlap and sum (polyphonic voice pool of 64).
///
/// # Arguments (AGENTS.md order: props first, inputs last)
/// - `props` — optional `seed`, `jitter`, and/or `key`
/// - `density` — impulses per second (Poisson rate, signal)
/// - `release` — T60 decay time in seconds per impulse (signal, audio-rate)
///
/// # Props
/// | Key       | Type | Default | Notes                                         |
/// |-----------|------|---------|-----------------------------------------------|
/// | `seed`    | num  | random  | Deterministic RNG seed (0 treated as 1)       |
/// | `jitter`  | num  | `0.0`   | Per-impulse amplitude randomness 0..1         |
/// | `key`     | str  | —       | Optional authoring key                        |
///
/// # Behaviour
/// - Each sample runs a Bernoulli trial with probability `density / sr`.
/// - On trigger, a new voice spawns with amplitude 1.
/// - `jitter` scales the impulse amplitude randomly per trigger.
/// - Voices decay exponentially at T60 = `release` seconds and sum at the output.
/// - If all 64 voice slots are busy, new triggers are dropped.
/// - `release <= 0` → single-sample impulse (voice expires immediately after firing).
/// - `density <= 0` → no new triggers, existing releases keep decaying.
///
/// # Overlap handling
/// New events use gap-filling spawn. When a trigger fires while the summed
/// envelope is at level `d`, the new voice is born at amplitude `(1 - d)` so
/// the envelope jumps back to exactly 1.0 rather than stacking on top.
/// A vendor-style `dcblock` poststage then recenters the output around 0.
/// Sonically this reads as a probabilistically-retriggered exponential
/// envelope whose decay tail shortens as density rises, without drifting DC.
///
/// For the `release <= 0` impulse mode, voices expire on the next sample so
/// there is no overlap to manage.
///
/// # Example
///
/// ```ignore
/// use elemaudio_rs::{el, extra};
/// use serde_json::json;
///
/// let noise = extra::rain(
///     json!({ "seed": 1, "jitter": 0.25 }),
///     el::const_(200.0),
///     el::const_(0.05),
/// );
/// ```
pub fn rain(
    props: serde_json::Value,
    density: impl Into<ElemNode>,
    release: impl Into<ElemNode>,
) -> Node {
    Node::new("rain", props, vec![resolve(density), resolve(release)])
}

/// Multi-slot preset RAM writer (MVP).
///
/// Treats one preset as a fixed-length numeric frame and writes it into a
/// chosen slot of a runtime-owned preset RAM bank addressed by `path`. The
/// writer latches `slot` at every frame boundary and commits the captured
/// frame on the next frame boundary, similar to `frame_write_ram`.
///
/// Props:
/// - `path`: shared bank identifier; readers and writers with the same path
///   share the same `slots * framelength` mono RAM buffer
/// - `framelength`: positive integer frame size in samples (one frame = one preset)
/// - `slots`: positive integer number of presets stored in the bank
/// - `metadata` (optional): static descriptor object for lane schema, ranges,
///   tapers, slot names, etc. Not consulted by the audio thread.
/// - `key`: optional authoring key
///
/// Inputs:
/// - `slot`: preset slot index, clamped to `[0, slots - 1]`
/// - `x`: frame-domain signal captured as one full frame per slot
pub fn preset_write(
    props: serde_json::Value,
    slot: impl Into<ElemNode>,
    x: impl Into<ElemNode>,
) -> Node {
    Node::new("presetWrite", props, vec![resolve(slot), resolve(x)])
}

/// Multi-slot preset RAM reader (MVP).
///
/// Reads one preset slot as a mono lookup table with linear interpolation by a
/// normalized `phase` in `[0, 1]`. `slot` is clamped to `[0, slots - 1]` and is
/// sampled per-sample — the reader is intended for parameter morphing and
/// scene selection, not audio loop playback.
pub fn preset_read(
    props: serde_json::Value,
    slot: impl Into<ElemNode>,
    phase: impl Into<ElemNode>,
) -> Node {
    Node::new("presetRead", props, vec![resolve(slot), resolve(phase)])
}

/// Multi-slot preset RAM morph (MVP).
///
/// Reads two preset slots with the same normalized phase and linearly
/// crossfades between them by `mix` (clamped to `[0, 1]`). `mix = 0` picks
/// `slot_a`, `mix = 1` picks `slot_b`, so this single node also covers hard
/// slot selection without a separate select helper.
pub fn preset_morph(
    props: serde_json::Value,
    slot_a: impl Into<ElemNode>,
    slot_b: impl Into<ElemNode>,
    mix: impl Into<ElemNode>,
    phase: impl Into<ElemNode>,
) -> Node {
    Node::new(
        "presetMorph",
        props,
        vec![resolve(slot_a), resolve(slot_b), resolve(mix), resolve(phase)],
    )
}
