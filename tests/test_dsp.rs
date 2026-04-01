use elemaudio_rs::{Graph, Node};
use serde_json::json;

pub fn freq_sequence() -> Node {
    elemaudio_rs::el!(sparseq(
        json!({
            "seq": [
                { "value": 110.0, "tickTime": 0.0 },
                { "value": 165.0, "tickTime": 1.0 },
                { "value": 220.0, "tickTime": 2.0 },
                { "value": 330.0, "tickTime": 4.0 },
                { "value": 440.0, "tickTime": 6.0 },
                { "value": 660.0, "tickTime": 8.0 }
            ],
            "loop": [0, 12]
        }),
        train(const_(2.0)),
        const_(0.0),
    ))
}

pub fn demo_graph() -> Graph {
    let seq = freq_sequence();

    Graph::new().root(elemaudio_rs::el!(mul(
        hann(phasor(div(seq.clone(), 16.0))),
        env(
            tau2pole(const_(0.01)),
            tau2pole(const_(0.1)),
            train(const_(6.0))
        ),
        cycle(seq),
    )))
}

#[test]
fn builds_demo_graph() {
    let batch = demo_graph().lower();
    assert!(batch.to_json_string().contains("sparseq"));
    assert!(batch.to_json_string().contains("env"));
}
