use elemaudio_rs::{Graph, Node, el};
use serde_json::json;

pub fn freq_sequence(prefix: &str, tempo_hz: f64) -> Node {
    let seed = json!({"seed": 123.0});
    let train_key = format!("{prefix}_train");

    el::add((
        el::mul((
            el::latch(
                el::train(el::const_with_key(&train_key, tempo_hz)),
                el::rand(Some(seed)),
            ),
            el::const_(400.0),
        )),
        el::const_(100.0),
    ))
}

pub fn demo_graph() -> Graph {
    let tempo_hz = 1.0;
    let left_seq: Node = freq_sequence("left", tempo_hz);
    let right_seq: Node = freq_sequence("right", tempo_hz / 2.0);
    let left_train_short = el::le(
        el::phasor(el::const_with_key("left_train_short", tempo_hz)),
        0.1,
    );
    let right_train_short = el::le(
        el::phasor(el::const_with_key("right_train_short", tempo_hz)),
        0.1,
    );

    let left_graph = el::mul((
        el::env(el::tau2pole(0.01), el::tau2pole(0.05), left_train_short),
        el::cycle(left_seq),
    ));

    let right_graph = el::mul((
        el::env(el::tau2pole(0.01), el::tau2pole(0.05), right_train_short),
        el::cycle(el::div((right_seq, 0.5))),
    ));

    Graph::new().render([left_graph, right_graph])
}

#[test]
fn builds_demo_graph() {
    let batch = demo_graph().lower();
    assert!(batch.to_json_string().contains("add"));
    assert!(batch.to_json_string().contains("env"));
}
