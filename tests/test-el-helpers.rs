use elemaudio_rs::{el, extra, mc, ElemNode, Graph, Node};

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
        ("exp", el::exp(node(1.0)), "exp", serde_json::Value::Null, 1),
        ("log", el::log(node(1.0)), "log", serde_json::Value::Null, 1),
        (
            "log2",
            el::log2(node(1.0)),
            "log2",
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
            "ge",
            el::ge(node(1.0), node(2.0)),
            "ge",
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
            el::add((node(1.0), node(2.0))),
            "add",
            serde_json::Value::Null,
            2,
        ),
        (
            "sub",
            el::sub((node(1.0), node(2.0))),
            "sub",
            serde_json::Value::Null,
            2,
        ),
        (
            "mul",
            el::mul((node(1.0), node(2.0))),
            "mul",
            serde_json::Value::Null,
            2,
        ),
        (
            "div",
            el::div((node(1.0), node(2.0))),
            "div",
            serde_json::Value::Null,
            2,
        ),
        (
            "mod",
            el::r#mod(node(1.0), node(2.0)),
            "mod",
            serde_json::Value::Null,
            2,
        ),
        (
            "min",
            el::min(node(1.0), node(2.0)),
            "min",
            serde_json::Value::Null,
            2,
        ),
        (
            "max",
            el::max(node(1.0), node(2.0)),
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
    let div = el::div((4.0, 2.0));
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
            el::const_with_key("a", 1.0),
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
fn covers_extra_helpers() {
    let freqshift_nodes = extra::freqshift(
        serde_json::json!({"shiftHz": 250.0, "mix": 0.75, "reflect": 2}),
        ElemNode::from(node(1.0)),
    );

    assert_eq!(freqshift_nodes.len(), 2);
    assert_nodes(
        &freqshift_nodes,
        "freqshift",
        serde_json::json!({"shiftHz": 250.0, "mix": 0.75, "reflect": 2}),
        1,
    );

    let crunch_nodes = extra::crunch(
        serde_json::json!({
            "channels": 2,
            "drive": 4.0,
            "fuzz": 0.25,
            "toneHz": 2000.0,
            "cutHz": 50.0,
            "outGain": 1.0,
            "autoGain": true
        }),
        ElemNode::from(node(1.0)),
    );

    assert_eq!(crunch_nodes.len(), 2);
    assert_nodes(
        &crunch_nodes,
        "crunch",
        serde_json::json!({
            "drive": 4.0,
            "fuzz": 0.25,
            "toneHz": 2000.0,
            "cutHz": 50.0,
            "outGain": 1.0,
            "autoGain": true
        }),
        1,
    );

    let foldback_node = extra::foldback(
        serde_json::json!({"thresh": 1.0, "amp": 0.5}),
        ElemNode::from(node(1.0)),
    );
    // After extracting thresh and amp, remaining props is an empty object.
    assert_node(&foldback_node, "mul", serde_json::json!({}), 2);

    // ramp00: explicit blocking prop preserved; two signal children in order
    // (dur first, trigger last per AGENTS.md "input nodes last" rule).
    let ramp00_explicit = extra::ramp00(
        serde_json::json!({"blocking": false}),
        ElemNode::from(node(480.0)),
        ElemNode::from(node(0.0)),
    );
    assert_node(
        &ramp00_explicit,
        "ramp00",
        serde_json::json!({"blocking": false}),
        2,
    );

    // ramp00: empty props default-fill blocking=true.
    let ramp00_default = extra::ramp00(
        serde_json::json!({}),
        ElemNode::from(node(480.0)),
        ElemNode::from(node(0.0)),
    );
    assert_node(
        &ramp00_default,
        "ramp00",
        serde_json::json!({"blocking": true}),
        2,
    );

    let threshold_default = extra::threshold(
        serde_json::json!({"key": "thresh"}),
        ElemNode::from(node(0.5)),
        ElemNode::from(node(0.0)),
        ElemNode::from(node(1.0)),
    );
    assert_node(
        &threshold_default,
        "threshold",
        serde_json::json!({"key": "thresh", "hysteresis": 0.0, "latch": false}),
        3,
    );

    let threshold_hysteretic = extra::threshold(
        serde_json::json!({"hysteresis": 0.25, "latch": true}),
        ElemNode::from(node(0.5)),
        ElemNode::from(node(0.0)),
        ElemNode::from(node(1.0)),
    );
    assert_node(
        &threshold_hysteretic,
        "threshold",
        serde_json::json!({"hysteresis": 0.25, "latch": true}),
        3,
    );

    let extra_sample_nodes = extra::sample(
        serde_json::json!({"path": "drums/kick.wav"}),
        ElemNode::from(node(0.0)),
        ElemNode::from(node(1.0)),
        ElemNode::from(node(1.0)),
        ElemNode::from(node(1.0)),
    );
    assert_eq!(extra_sample_nodes.len(), 2);
    assert_nodes(
        &extra_sample_nodes,
        "extra.sample",
        serde_json::json!({"path": "drums/kick.wav"}),
        4,
    );

    // sampleCount: zero children, props pass through verbatim.
    let sample_count_node = extra::sample_count(serde_json::json!({"path": "drums/kick.wav"}));
    assert_node(
        &sample_count_node,
        "sampleCount",
        serde_json::json!({"path": "drums/kick.wav"}),
        0,
    );

    // sampleCount: authoring key is preserved alongside path.
    let sample_count_keyed =
        extra::sample_count(serde_json::json!({"path": "drums/snare.wav", "key": "snare-len"}));
    assert_node(
        &sample_count_keyed,
        "sampleCount",
        serde_json::json!({"path": "drums/snare.wav", "key": "snare-len"}),
        0,
    );

    // dust: seed prop preserved; two signal children (density, trails).
    let dust_node = extra::dust(
        serde_json::json!({"seed": 1234, "bipolar": false, "jitter": 0.25}),
        ElemNode::from(node(200.0)),
        ElemNode::from(node(0.05)),
    );
    assert_node(
        &dust_node,
        "dust",
        serde_json::json!({"seed": 1234, "bipolar": false, "jitter": 0.25}),
        2,
    );
}

#[test]
fn lowers_multichannel_graph_to_batch() {
    let graph = Graph::new()
        .render(el::cycle(el::sm(el::const_(220.0))))
        .render(el::cycle(el::sm(el::const_(220.0 * 1.618))));

    let batch = graph.lower();
    assert!(batch.to_json_string().contains("sin"));
    assert!(batch.to_json_string().contains("phasor"));
    assert!(batch.to_json_string().contains("pole"));
    assert!(batch.to_json_string().contains("root"));
}
