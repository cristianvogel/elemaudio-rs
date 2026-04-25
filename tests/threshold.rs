//! End-to-end tests for the `threshold` native node.

use elemaudio_rs::{ElemNode, Graph, Runtime, el, extra};
use serde_json::json;

fn warm_past_root_fade(runtime: &Runtime, sample_rate: f64, buffer_size: usize) {
    let warm_samples = ((sample_rate * 0.040).ceil() as usize).max(buffer_size);
    let mut remaining = warm_samples;
    while remaining > 0 {
        let this_block = remaining.min(buffer_size);
        let mut buf = vec![0.0_f64; this_block];
        let mut outputs = [buf.as_mut_slice()];
        runtime
            .process(this_block, &[], &mut outputs)
            .expect("warm process");
        remaining -= this_block;
    }
}

#[test]
fn threshold_emits_single_pulse_on_rising_crossing() {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(64)
        .call()
        .expect("runtime");

    let threshold_node = el::const_with_key("threshold", 0.5);
    let reset_node = el::const_with_key("reset", 0.0);
    let x_node = el::const_with_key("x", 0.0);

    let graph = Graph::new().render(extra::threshold(
        json!({ "latch": false }),
        threshold_node,
        ElemNode::from(reset_node),
        ElemNode::from(x_node),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, 48_000.0, 64);

    runtime
        .apply_instructions(&mounted.set_const_value("x", 1.0).unwrap())
        .expect("raise x");

    let mut out = vec![0.0_f64; 64];
    let mut outputs = [out.as_mut_slice()];
    runtime.process(64, &[], &mut outputs).expect("process");

    assert_eq!(out[0], 1.0);
    assert!(out[1..].iter().all(|&s| s == 0.0));
}

#[test]
fn threshold_latch_holds_until_reset_rises() {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(64)
        .call()
        .expect("runtime");

    let threshold_node = el::const_with_key("threshold", 0.5);
    let reset_node = el::const_with_key("reset", 0.0);
    let x_node = el::const_with_key("x", 0.0);

    let graph = Graph::new().render(extra::threshold(
        json!({ "latch": true }),
        threshold_node,
        ElemNode::from(reset_node),
        ElemNode::from(x_node),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, 48_000.0, 64);

    runtime
        .apply_instructions(&mounted.set_const_value("x", 1.0).unwrap())
        .expect("raise x");

    let mut held = vec![0.0_f64; 64];
    {
        let mut outputs = [held.as_mut_slice()];
        runtime
            .process(64, &[], &mut outputs)
            .expect("process held");
    }
    assert!(held.iter().all(|&s| s == 1.0));

    runtime
        .apply_instructions(&mounted.set_const_value("reset", 1.0).unwrap())
        .expect("raise reset");

    let mut reset_block = vec![0.0_f64; 64];
    {
        let mut outputs = [reset_block.as_mut_slice()];
        runtime
            .process(64, &[], &mut outputs)
            .expect("process reset");
    }
    assert!(reset_block.iter().all(|&s| s == 0.0));
}
