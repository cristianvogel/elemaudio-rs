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
fn dust_releases_overlap_and_shorter_releases_decay_faster() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    // High density + long releases should create overlapping voices with
    // substantial output energy.
    let density = elemaudio_rs::el::const_with_key("density", sample_rate);
    let release = elemaudio_rs::el::const_with_key("release", 0.05);
    let graph = Graph::new().render(extra::dust(
        json!({ "seed": 1234, "bipolar": false, "jitter": 0.0 }),
        density,
        release,
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("process");
    }

    let energy_long: f64 = out.iter().map(|s| s.abs()).sum();
    assert!(energy_long > 10.0, "long overlapping releases should produce substantial energy: {energy_long}");

    // Shorten the release at runtime and verify the same node now decays faster.
    let len_node = mounted.node_with_key("release").expect("keyed release");
    runtime
        .apply_instructions(&len_node.set_const_value(0.005))
        .expect("apply release update");

    {
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("process 2");
    }

    let energy_short: f64 = out.iter().map(|s| s.abs()).sum();
    assert!(energy_short < energy_long, "shorter releases should reduce total energy: short={energy_short}, long={energy_long}");
}
