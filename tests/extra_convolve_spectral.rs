//! End-to-end tests for the prototype `extra.convolveSpectral` native node.

use elemaudio_rs::{Graph, Runtime, el, extra};
use serde_json::json;

fn warm_past_root_fade(runtime: &Runtime, sample_rate: f64, buffer_size: usize) {
    let warm_samples = ((sample_rate * 0.040).ceil() as usize).max(buffer_size);
    let mut remaining = warm_samples;
    while remaining > 0 {
        let this_block = remaining.min(buffer_size);
        let mut out = vec![0.0_f64; this_block];
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(this_block, &[], &mut outputs)
            .expect("warm process");
        remaining -= this_block;
    }
}

fn settle_last_sample(runtime: &Runtime, size: usize, blocks: usize) -> f64 {
    let mut last = 0.0;
    for _ in 0..blocks {
        let mut out = vec![0.0_f64; size];
        let mut outputs = [out.as_mut_slice()];
        runtime.process(size, &[], &mut outputs).expect("process");
        last = *out.last().expect("last sample");
    }
    last
}

#[test]
fn extra_convolve_spectral_neutral_matches_static_ir_gain() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let ir = vec![1.0_f32, 1.0_f32];
    runtime
        .add_shared_resource_f32("ir", &ir)
        .expect("resource");

    let graph = Graph::new().render(extra::convolve_spectral(
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512}),
        el::const_(1.0),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let last = settle_last_sample(&runtime, buffer_size, 20);
    assert!(
        (last - 2.0).abs() < 1e-4,
        "neutral spectral edit should preserve IR sum, got {last}"
    );
}

#[test]
fn extra_convolve_spectral_magnitude_gain_scales_ir_gain() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let ir = vec![1.0_f32, 1.0_f32];
    runtime
        .add_shared_resource_f32("ir", &ir)
        .expect("resource");

    let graph = Graph::new().render(extra::convolve_spectral(
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "magnitudeGainDb": -6.0}),
        el::const_(1.0),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let last = settle_last_sample(&runtime, buffer_size, 20);
    let expected = 2.0 * 10.0_f64.powf(-6.0 / 20.0);
    assert!(
        (last - expected).abs() < 1e-4,
        "spectral magnitude gain should scale IR sum, expected {expected}, got {last}"
    );
}
