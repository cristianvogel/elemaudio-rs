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

#[test]
fn extra_convolve_trim_changes_steady_state_gain() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let mut ir = vec![0.0_f32; 129];
    ir[0] = 1.0;
    ir[128] = 0.001;
    runtime.add_shared_resource_f32("ir", &ir).expect("mirror resource");

    let graph = Graph::new().render(extra::convolve(
        json!({"path": "ir", "irTrimDb": -40.0, "Weighting": "none"}),
        elemaudio_rs::el::const_(1.0),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut last = 0.0;
    for _ in 0..20 {
        let block = process_block(&runtime, buffer_size);
        last = *block.last().expect("last sample");
    }

    assert!((last - 1.0).abs() < 1e-4, "trimmed IR should settle near 1.0, got {last}");
}

#[test]
fn extra_convolve_without_trim_keeps_full_ir_gain() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let mut ir = vec![0.0_f32; 129];
    ir[0] = 1.0;
    ir[128] = 0.001;
    runtime.add_shared_resource_f32("ir", &ir).expect("mirror resource");

    let graph = Graph::new().render(extra::convolve(
        json!({"path": "ir"}),
        elemaudio_rs::el::const_(1.0),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut last = 0.0;
    for _ in 0..20 {
        let block = process_block(&runtime, buffer_size);
        last = *block.last().expect("last sample");
    }

    assert!(
        (last - 1.001).abs() < 1e-4,
        "untrimmed IR should settle near the full gain sum, got {last}"
    );
}
