//! End-to-end tests for the `framePolySignal` native node.

use elemaudio_rs::{Graph, Runtime, extra};
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
    assert!(delta <= 1e-9, "{context}: expected {expected}, got {actual} (|delta|={delta})");
}

#[test]
fn frame_poly_signal_uses_internal_sine_when_path_is_missing() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_poly_signal(
        json!({ "framelength": frame_length, "bpm": 0.0 }),
        0.0,
        0.0,
        0.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("process");

    let expected = [
        -1.0,
        -0.7071067811865476,
        0.0,
        0.7071067811865475,
        1.0,
        0.7071067811865476,
        0.0,
        -0.7071067811865475,
    ];
    for (i, sample) in block.iter().enumerate() {
        assert_close(*sample, expected[i], &format!("sine fallback sample {i}"));
    }
}

#[test]
fn frame_poly_signal_phase_spread_offsets_lookup_positions() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_poly_signal(
        json!({ "framelength": frame_length, "bpm": 0.0 }),
        0.25,
        0.0,
        0.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("process");

    let baseline = [-1.0, -0.7071067811865476, 0.0, 0.7071067811865475, 1.0, 0.7071067811865476, 0.0, -0.7071067811865475];
    assert!(
        block.iter().zip(baseline).any(|(sample, base)| (*sample - base).abs() > 1e-6),
        "phase spread should decorrelate tracks against the baseline sine frame"
    );
    assert!(block[0].abs() < 1e-6, "phase spread sample 0 should be centered by the negative end of the internal ramp, got {}", block[0]);
    assert!(block[4] > 0.0 && block[4] < 1.0, "phase spread sample 4 should be decorrelated but still positive, got {}", block[4]);
}
