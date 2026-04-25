//! End-to-end tests for the `frameBiDiSmooth` native node.

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
    assert!(
        delta <= 1e-9,
        "{context}: expected {expected}, got {actual} (|delta|={delta})"
    );
}

#[test]
fn frame_bidi_smooth_uses_attack_time_for_rising_changes() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);
    let frame_duration = frame_length as f64 / sample_rate;

    let graph = Graph::new().render(extra::frame_bidi_smooth(
        json!({ "framelength": frame_length }),
        frame_duration * 2.0,
        frame_duration * 4.0,
        0.0,
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
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("first");
    for (i, sample) in first.iter().enumerate() {
        assert_close(*sample, 0.5, &format!("attack frame sample {i}"));
    }
}

#[test]
fn frame_bidi_smooth_uses_release_time_for_falling_changes() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let frame_duration = frame_length as f64 / sample_rate;

    let rise_runtime = build_runtime(sample_rate, buffer_size);
    let graph = Graph::new().render(extra::frame_bidi_smooth(
        json!({ "framelength": frame_length }),
        frame_duration,
        frame_duration * 4.0,
        0.0,
        0.0,
        0.0,
    ));
    let mounted = graph.mount().expect("mount");
    rise_runtime
        .apply_instructions(mounted.batch())
        .expect("apply");

    warm_past_root_fade(&rise_runtime, sample_rate, buffer_size);
    rise_runtime.reset();
    rise_runtime.set_current_time_samples(0);

    let mut first = vec![0.0_f64; frame_length];
    let mut outputs = [first.as_mut_slice()];
    rise_runtime
        .process(frame_length, &[], &mut outputs)
        .expect("first");
    for sample in &first {
        assert_close(*sample, 0.0, "first frame");
    }

    let fall_runtime = build_runtime(sample_rate, buffer_size);
    let graph = Graph::new().render(extra::frame_bidi_smooth(
        json!({ "framelength": frame_length }),
        frame_duration,
        frame_duration * 4.0,
        0.0,
        0.0,
        -1.0,
    ));
    let mounted = graph.mount().expect("mount 2");
    fall_runtime
        .apply_instructions(mounted.batch())
        .expect("apply 2");

    warm_past_root_fade(&fall_runtime, sample_rate, buffer_size);
    fall_runtime.reset();
    fall_runtime.set_current_time_samples(0);

    let mut second = vec![0.0_f64; frame_length];
    let mut outputs = [second.as_mut_slice()];
    fall_runtime
        .process(frame_length, &[], &mut outputs)
        .expect("second");
    for (i, sample) in second.iter().enumerate() {
        assert_close(
            *sample,
            -0.1464466094067262,
            &format!("release frame sample {i}"),
        );
    }
}
