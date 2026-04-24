//! End-to-end tests for the `extra.convolve` native node.

use elemaudio_rs::{Graph, Runtime, extra};
use serde_json::json;

fn warm_past_root_fade(runtime: &Runtime, sample_rate: f64, buffer_size: usize) {
    let warm_samples = ((sample_rate * 0.040).ceil() as usize).max(buffer_size);
    let mut remaining = warm_samples;
    while remaining > 0 {
        let this_block = remaining.min(buffer_size);
        let mut out = vec![0.0_f64; this_block];
        let mut outputs = [out.as_mut_slice()];
        runtime.process(this_block, &[], &mut outputs).expect("warm process");
        remaining -= this_block;
    }
}

fn process_block(runtime: &Runtime, size: usize) -> Vec<f64> {
    let mut out = vec![0.0_f64; size];
    let mut outputs = [out.as_mut_slice()];
    runtime.process(size, &[], &mut outputs).expect("process");
    out
}

fn settle_last_sample(runtime: &Runtime, size: usize, blocks: usize) -> f64 {
    let mut last = 0.0;
    for _ in 0..blocks {
        let block = process_block(runtime, size);
        last = *block.last().expect("last sample");
    }
    last
}

#[test]
fn extra_convolve_ir_attenuation_reduces_wet_gain() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let ir = vec![1.0_f32];
    runtime.add_shared_resource_f32("ir", &ir).expect("resource");

    let graph = Graph::new().render(extra::convolve(
        json!({"path": "ir", "irAttenuationDb": 6.0}),
        elemaudio_rs::el::const_(1.0),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let last = settle_last_sample(&runtime, buffer_size, 8);
    let expected = 10.0_f64.powf(-6.0 / 20.0);
    assert!((last - expected).abs() < 1e-4, "expected {expected}, got {last}");
}

#[test]
fn extra_convolve_normalize_reduces_runaway_gain_prediction() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let ir = vec![1.0_f32, 1.0_f32];

    let runtime_plain = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime plain");
    runtime_plain.add_shared_resource_f32("ir", &ir).expect("resource plain");
    let graph_plain = Graph::new().render(extra::convolve(
        json!({"path": "ir"}),
        elemaudio_rs::el::const_(1.0),
    ));
    let mounted_plain = graph_plain.mount().expect("mount plain");
    runtime_plain.apply_instructions(mounted_plain.batch()).expect("apply plain");
    warm_past_root_fade(&runtime_plain, sample_rate, buffer_size);
    let plain_last = settle_last_sample(&runtime_plain, buffer_size, 20);

    let runtime_normalized = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime normalized");
    runtime_normalized.add_shared_resource_f32("ir", &ir).expect("resource normalized");
    let graph_normalized = Graph::new().render(extra::convolve(
        json!({"path": "ir", "normalize": true}),
        elemaudio_rs::el::const_(1.0),
    ));
    let mounted_normalized = graph_normalized.mount().expect("mount normalized");
    runtime_normalized
        .apply_instructions(mounted_normalized.batch())
        .expect("apply normalized");
    warm_past_root_fade(&runtime_normalized, sample_rate, buffer_size);
    let normalized_last = settle_last_sample(&runtime_normalized, buffer_size, 20);

    assert!(plain_last > 1.9, "plain output should approach the IR sum, got {plain_last}");
    assert!(normalized_last < plain_last, "normalized output should be reduced, got plain={plain_last}, normalized={normalized_last}");
}
