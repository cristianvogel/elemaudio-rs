//! End-to-end tests for the `frameWriteRAM` native node.

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
    assert!(delta <= 1e-9, "{context}: expected {expected}, got {actual} (|delta|={delta})");
}

#[test]
fn frame_write_ram_updates_table_after_one_frame_latency() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let frame_length = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    let writer_source = extra::frame_shaper(
        json!({ "framelength": frame_length }),
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0.5,
    );
    let writer = extra::frame_write_ram(
        json!({ "framelength": frame_length, "path": "wf/ram/test-wave" }),
        writer_source,
    );
    let table_read = el::table(
        json!({ "path": "wf/ram/test-wave" }),
        el::constant(json!({ "value": 4.0 / 7.0 })),
    );
    let left = el::add((el::mul((0.0, writer)), table_read.clone()));
    let graph = Graph::new().render(vec![left, table_read]);
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut first = vec![0.0_f64; frame_length];
    let mut outputs = [first.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("first");
    for (i, sample) in first.iter().enumerate() {
        assert_close(*sample, 0.0, &format!("first frame sample {i}"));
    }

    let mut second = vec![0.0_f64; frame_length];
    let mut outputs = [second.as_mut_slice()];
    runtime.process(frame_length, &[], &mut outputs).expect("second");
    for (i, sample) in second.iter().enumerate() {
        assert_close(*sample, 1.0, &format!("second frame sample {i}"));
    }
}
