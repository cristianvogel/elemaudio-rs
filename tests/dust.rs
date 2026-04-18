//! End-to-end tests for the `dust` native node.
//!
//! These exercise the full Rust authoring → Runtime → native C++ path.
//! The node is intentionally sparse and stateful, so the tests focus on
//! deterministic shape properties rather than exact random-event timing.

use elemaudio_rs::{extra, Graph, Runtime};
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

#[test]
fn dust_is_silent_when_density_is_zero() {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(64)
        .call()
        .expect("runtime");

    let graph = Graph::new().render(extra::dust(
        json!({ "seed": 1 }),
        elemaudio_rs::el::const_(0.0),
        elemaudio_rs::el::const_(0.05),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, 48_000.0, 64);

    let mut out = vec![0.0_f64; 64];
    let mut outputs = [out.as_mut_slice()];
    runtime.process(64, &[], &mut outputs).expect("process");

    assert!(out.iter().all(|&s| s == 0.0));
}

#[test]
fn dust_output_stays_bounded_across_release_sweeps() {
    let sample_rate = 48_000.0;
    let buffer_size = 512;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    // Stress test: high density + long release should pile up many
    // concurrent voices. The node's built-in normalization must keep the
    // output within ±1 regardless, preventing downstream clipping.
    let density = elemaudio_rs::el::const_with_key("density", sample_rate);
    let release = elemaudio_rs::el::const_with_key("release", 0.1);
    let graph = Graph::new().render(extra::dust(
        json!({ "seed": 1234, "bipolar": false, "jitter": 0.0 }),
        density,
        release,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];

    // Let the bank saturate: process several blocks so voices fully stack
    // up to the expected polyphony ceiling.
    for _ in 0..8 {
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("process");
    }

    let max_abs = out.iter().map(|s| s.abs()).fold(0.0_f64, f64::max);
    let energy_long: f64 = out.iter().map(|s| s.abs()).sum();

    // Tolerance picks up the tiny FP round-off in the gap-filling
    // unipolar path, which by construction targets exactly 1.0 at peak.
    const EPS: f64 = 1e-9;
    assert!(
        max_abs <= 1.0 + EPS,
        "normalized dust must stay within ±1 at heavy polyphony; max abs = {max_abs}",
    );
    assert!(energy_long > 0.0, "dust should produce non-zero output: {energy_long}");

    // Now shorten the release drastically. The bound must still hold.
    let len_node = mounted.node_with_key("release").expect("keyed release");
    runtime
        .apply_instructions(&len_node.set_const_value(0.001))
        .expect("apply release update");

    for _ in 0..4 {
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("process 2");
    }

    let max_abs_short = out.iter().map(|s| s.abs()).fold(0.0_f64, f64::max);
    assert!(
        max_abs_short <= 1.0 + EPS,
        "normalized dust must stay within ±1 after release change; max abs = {max_abs_short}",
    );
}
