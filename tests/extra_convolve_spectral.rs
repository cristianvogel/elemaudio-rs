//! End-to-end tests for the prototype `extra.convolveSpectral` native node.

use elemaudio_rs::{Graph, Node, Runtime, el, extra};
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

fn spectral_output_rms(ir: &[f32], props: serde_json::Value, source: Node) -> f64 {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    runtime
        .add_shared_resource_f32("ir", ir)
        .expect("resource");

    let graph = Graph::new().render(extra::convolve_spectral(props, source));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut sum_squares = 0.0;
    let mut samples = 0;
    for _ in 0..32 {
        let mut out = vec![0.0_f64; buffer_size];
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("process");

        for sample in out {
            sum_squares += sample * sample;
            samples += 1;
        }
    }

    (sum_squares / samples as f64).sqrt()
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

#[test]
fn extra_convolve_spectral_blur_smooths_ir_partition_magnitudes() {
    let mut ir = vec![0.0_f32; 128];
    ir[0] = 1.0;
    ir[64] = 0.25;

    let neutral = spectral_output_rms(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "blur": 0.0}),
        el::cycle(el::const_(440.0)),
    );
    let blurred = spectral_output_rms(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "blur": 0.5}),
        el::cycle(el::const_(440.0)),
    );

    assert!(
        (blurred - neutral).abs() > 0.01,
        "blur should smooth partition magnitudes and alter the output energy, neutral {neutral}, blurred {blurred}"
    );
}
