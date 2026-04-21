//! End-to-end tests for the `frameDerivative` native node.

use elemaudio_rs::{Graph, Runtime, el, extra};
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

fn build_runtime(sample_rate: f64, buffer_size: usize) -> Runtime {
    Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime")
}

fn assert_close(actual: f64, expected: f64, context: &str) {
    let delta = (actual - expected).abs();
    assert!(
        delta <= 1e-9,
        "{context}: expected {expected}, got {actual} (|delta|={delta})"
    );
}

#[test]
fn frame_derivative_uses_previous_frame_at_matching_offset() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_derivative(
        json!({ "framelength": 4 }),
        el::time(),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; 12];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(12, &[], &mut outputs).expect("process");

    let expected = [0.0, 1.0, 2.0, 3.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0];
    for (i, (&sample, &want)) in block.iter().zip(expected.iter()).enumerate() {
        assert_close(sample, want, &format!("sample {i}"));
    }
}
