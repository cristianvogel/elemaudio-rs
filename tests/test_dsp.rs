use elemaudio_rs::{el, Graph, Node};
use serde_json::json;

pub fn freq_sequence(tempo_hz: f64) -> Node {
    let seed = json!({"seed": 123.0});

    el::add([
        el::mul([
            el::latch(
                el::train(el::const_with_key("train", tempo_hz)),
                el::rand(Some(seed)),
            ),
            el::const_(400.0),
        ]),
        el::const_(100.0),
    ])
}

pub fn demo_graph() -> Graph {
    let tempo_hz = 1.0;
    let seq: Node = freq_sequence(tempo_hz);
    let train_short = el::le(el::phasor(el::const_with_key("train_short", tempo_hz)), 0.1);

    Graph::new().root(el::mul([
        el::env(el::tau2pole(0.01), el::tau2pole(0.05), train_short),
        el::cycle(seq),
    ]))
}

#[test]
fn builds_demo_graph() {
    let batch = demo_graph().lower();
    assert!(batch.to_json_string().contains("add"));
    assert!(batch.to_json_string().contains("env"));
}
