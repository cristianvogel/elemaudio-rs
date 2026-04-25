//! End-to-end tests for the `frameShaper` native node.

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
fn frame_shaper_starts_flat_at_zero_wave() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("process");

    for (i, sample) in block.iter().enumerate() {
        assert_close(*sample, 0.0, &format!("flat sample {i}"));
    }
}

#[test]
fn frame_shaper_wave_half_emits_full_triangle() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0.5,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("process");

    let expected = [-1.0, -0.5, 0.0, 0.5, 1.0, 0.5, 0.0, -0.5];
    for (i, sample) in block.iter().enumerate() {
        assert_close(*sample, expected[i], &format!("triangle sample {i}"));
    }
}

#[test]
fn frame_shaper_wave_one_emits_full_sine() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("process");

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
        assert_close(*sample, expected[i], &format!("sine sample {i}"));
    }
}

#[test]
fn frame_shaper_shift_latches_at_frame_boundaries() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let shift = elemaudio_rs::el::select(
        elemaudio_rs::el::ge(elemaudio_rs::el::time(), 2.0),
        2.0,
        0.0,
    );
    let graph = Graph::new().render(extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        shift,
        0.0,
        1.0,
        1.0,
        0.5,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let mut first = vec![0.0_f64; frame_length];
    let mut outputs = [first.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("first");
    let expected_first = [-1.0, -0.5, 0.0, 0.5, 1.0, 0.5, 0.0, -0.5];
    for (i, sample) in first.iter().enumerate() {
        assert_close(
            *sample,
            expected_first[i],
            &format!("first frame sample {i}"),
        );
    }

    let mut second = vec![0.0_f64; frame_length];
    let mut outputs = [second.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("second");
    let expected_second = [0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -0.5];
    for (i, sample) in second.iter().enumerate() {
        assert_close(
            *sample,
            expected_second[i],
            &format!("second frame sample {i}"),
        );
    }
}

#[test]
fn frame_shaper_zoom_below_one_expands_wave_around_center() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.0,
        0.5,
        1.0,
        0.5,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("process");

    let expected = [0.0, 0.25, 0.5, 0.75, 1.0, 0.75, 0.5, 0.25];
    for (i, sample) in block.iter().enumerate() {
        assert_close(*sample, expected[i], &format!("zoom<1 sample {i}"));
    }
}

#[test]
fn frame_shaper_zoom_above_one_contracts_wave_toward_center() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.0,
        2.0,
        1.0,
        0.5,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; frame_length];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(frame_length, &[], &mut outputs)
        .expect("process");

    let expected = [0.0, 0.0, -1.0, 0.0, 1.0, 0.0, -1.0, 0.0];
    for (i, sample) in block.iter().enumerate() {
        assert_close(*sample, expected[i], &format!("zoom>1 sample {i}"));
    }
}

#[test]
#[should_panic(expected = "frame_shaper requires an even positive framelength")]
fn frame_shaper_rejects_odd_frame_length_in_rust_authoring() {
    let _ = extra::frame_shaper(json!({ "framelength": 7 }), 0.0, 0.0, 0.0, 1.0, 1.0, 0.0);
}
