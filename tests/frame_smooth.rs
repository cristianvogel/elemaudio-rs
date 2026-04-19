//! End-to-end tests for the `frameSmooth` native node.

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
fn frame_smooth_passes_immediately_when_time_constant_is_zero() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_smooth(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.75,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("process");

    for (i, sample) in block.iter().enumerate() {
        assert_close(*sample, 0.75, &format!("sample {i}"));
    }
}

#[test]
fn frame_smooth_reaches_a_constant_target_over_two_frames() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);
    let frame_duration = frame_length as f64 / sample_rate;

    let graph = Graph::new().render(extra::frame_smooth(
        json!({ "framelength": frame_length }),
        frame_duration * 2.0,
        0.0,
        1.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut first = vec![0.0_f64; frame_length];
    let mut outputs = [first.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("first");
    for (i, sample) in first.iter().enumerate() {
        assert_close(*sample, 0.5, &format!("first sample {i}"));
    }

    let mut second = vec![0.0_f64; frame_length];
    let mut outputs = [second.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("second");
    for (i, sample) in second.iter().enumerate() {
        assert_close(*sample, 1.0, &format!("second sample {i}"));
    }

    let mut third = vec![0.0_f64; frame_length];
    let mut outputs = [third.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("third");
    for (i, sample) in third.iter().enumerate() {
        assert_close(*sample, 1.0, &format!("third sample {i}"));
    }
}

#[test]
fn frame_smooth_time_shaper_changes_per_track_speed() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);
    let frame_duration = frame_length as f64 / sample_rate;

    let shaper = extra::frame_phasor(
        json!({ "framelength": frame_length }),
        -1.0,
        0.0,
        0.0,
        2.0,
    );
    let graph = Graph::new().render(extra::frame_smooth(
        json!({ "framelength": frame_length }),
        frame_duration * 2.0,
        shaper,
        1.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut first = vec![0.0_f64; frame_length];
    let mut outputs = [first.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("first");

    assert!(first[0] < 0.1, "lowest track should remain much slower, got {}", first[0]);
    assert!(first[7] > 0.99, "highest track should converge almost immediately, got {}", first[7]);
}
