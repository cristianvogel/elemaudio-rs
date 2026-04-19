//! End-to-end tests for the `frameRandomWalks` native node.

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

fn render_walks(runtime: &Runtime, props: serde_json::Value) {
    let graph = Graph::new().render(extra::frame_random_walks(props, 0.25, 0.05, 0.0, 0.0));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
}

fn collect_blocks(runtime: &Runtime, block_sizes: &[usize]) -> Vec<f64> {
    let mut collected = Vec::new();
    for &block_size in block_sizes {
        let mut block = vec![0.0_f64; block_size];
        let mut outputs = [block.as_mut_slice()];
        runtime
            .process(block_size, &[], &mut outputs)
            .expect("process");
        collected.extend(block);
    }
    collected
}

#[test]
fn frame_random_walks_is_deterministic_for_a_fixed_seed_across_chunkings() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let props = json!({
        "framelength": 8,
        "seed": 1234,
        "startingfrom": 0.1,
        "initialdeviation": 0.2,
    });

    let runtime_a = build_runtime(sample_rate, buffer_size);
    render_walks(&runtime_a, props.clone());
    warm_past_root_fade(&runtime_a, sample_rate, buffer_size);
    runtime_a.reset();
    runtime_a.set_current_time_samples(0);
    let a = collect_blocks(&runtime_a, &[7, 5, 19, 3, 14]);

    let runtime_b = build_runtime(sample_rate, buffer_size);
    render_walks(&runtime_b, props);
    warm_past_root_fade(&runtime_b, sample_rate, buffer_size);
    runtime_b.reset();
    runtime_b.set_current_time_samples(0);
    let b = collect_blocks(&runtime_b, &[48]);

    assert_eq!(a.len(), b.len());
    for (i, (lhs, rhs)) in a.iter().zip(&b).enumerate() {
        let delta = (lhs - rhs).abs();
        assert!(
            delta <= 1e-12,
            "sample {i}: expected equal deterministic output, got {lhs} vs {rhs}"
        );
    }
}

#[test]
fn frame_random_walks_stays_constant_when_step_size_is_zero() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_random_walks(
        json!({
            "framelength": 4,
            "seed": 9,
            "startingfrom": 0.25,
            "initialdeviation": 0.0,
        }),
        0.0,
        0.2,
        0.0,
        0.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let samples = collect_blocks(&runtime, &[16]);
    for (i, sample) in samples.iter().enumerate() {
        let delta = (sample - 0.25).abs();
        assert!(delta <= 1e-12, "sample {i}: expected 0.25, got {sample}");
    }
}

#[test]
fn frame_random_walks_absolute_mode_never_outputs_negative_values() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    render_walks(
        &runtime,
        json!({
            "framelength": 8,
            "seed": 42,
            "absolute": true,
            "startingfrom": -0.5,
            "initialdeviation": 0.25,
            "interpolation": false,
        }),
    );
    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let samples = collect_blocks(&runtime, &[32]);
    assert!(samples.iter().all(|sample| *sample >= 0.0));
}

#[test]
fn frame_random_walks_mirror_reflects_at_bipolar_limits() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_random_walks(
        json!({
            "framelength": 8,
            "seed": 99,
            "startingfrom": 0.95,
            "initialdeviation": 0.0,
            "interpolation": false,
        }),
        4.0,
        0.05,
        0.0,
        0.0,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let samples = collect_blocks(&runtime, &[64]);
    for (i, sample) in samples.iter().enumerate() {
        assert!(
            (-1.0..=1.0).contains(sample),
            "sample {i}: expected mirror-bounded output in [-1, 1], got {sample}"
        );
    }
}
