//! End-to-end tests for the `framePhasor` native node.

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

fn mount_frame_phasor(runtime: &Runtime, frame_length: usize) {
    let graph = Graph::new().render(extra::frame_phasor(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        1.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
}

#[test]
fn frame_phasor_emits_exact_normalized_ramp_across_uneven_blocks() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 4_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    mount_frame_phasor(&runtime, frame_length);
    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let block_sizes = [3_usize, 2, 5, 1, 4];
    let mut absolute = 0_usize;

    for &block_size in &block_sizes {
        let mut block = vec![0.0_f64; block_size];
        let mut outputs = [block.as_mut_slice()];
        runtime
            .process(block_size, &[], &mut outputs)
            .expect("process");

        for (i, &sample) in block.iter().enumerate() {
            let t = absolute + i;
            let expected = (t % frame_length) as f64 / frame_length as f64;
            assert_close(sample, expected, &format!("absolute sample {t}"));
        }

        absolute += block_size;
    }
}

#[test]
fn frame_phasor_respects_explicit_absolute_time_seek() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    mount_frame_phasor(&runtime, frame_length);
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    runtime.set_current_time_samples(13);

    let mut block = vec![0.0_f64; buffer_size];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(buffer_size, &[], &mut outputs)
        .expect("process");

    for (i, &sample) in block.iter().enumerate() {
        let t = 13 + i;
        let expected = (t % frame_length) as f64 / frame_length as f64;
        assert_close(sample, expected, &format!("absolute sample {t}"));
    }
}

#[test]
fn frame_phasor_restarts_from_zero_after_reset_and_time_reset() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    mount_frame_phasor(&runtime, frame_length);
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut pre_reset = vec![0.0_f64; buffer_size];
    let mut outputs = [pre_reset.as_mut_slice()];
    runtime
        .process(buffer_size, &[], &mut outputs)
        .expect("pre-reset process");

    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut post_reset = vec![0.0_f64; buffer_size];
    let mut outputs = [post_reset.as_mut_slice()];
    runtime
        .process(buffer_size, &[], &mut outputs)
        .expect("post-reset process");

    for (i, &sample) in post_reset.iter().enumerate() {
        let expected = (i % frame_length) as f64 / frame_length as f64;
        assert_close(sample, expected, &format!("post-reset sample {i}"));
    }
}

#[test]
fn frame_phasor_latches_shift_only_at_frame_boundaries() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let absolute_samples = el::time();
    let shift = el::select(el::ge(absolute_samples, 2.0), 0.5, 0.0);
    let graph = Graph::new().render(extra::frame_phasor(
        json!({ "framelength": frame_length }),
        shift,
        0.0,
        1.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; 16];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(16, &[], &mut outputs).expect("process");

    for (i, &sample) in block.iter().enumerate().take(frame_length) {
        let expected = i as f64 / frame_length as f64;
        assert_close(sample, expected, &format!("first frame sample {i}"));
    }

    for (i, &sample) in block.iter().enumerate().skip(frame_length) {
        let frame_pos = i - frame_length;
        let expected = ((frame_pos as f64 / frame_length as f64) + 0.5).fract();
        assert_close(sample, expected, &format!("second frame sample {i}"));
    }
}

#[test]
fn native_time_emits_absolute_sample_indices() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(el::time());
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(13);

    let mut block = vec![0.0_f64; 8];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(8, &[], &mut outputs).expect("process");

    for (i, &sample) in block.iter().enumerate() {
        assert_close(sample, (13 + i) as f64, &format!("time sample {i}"));
    }
}
