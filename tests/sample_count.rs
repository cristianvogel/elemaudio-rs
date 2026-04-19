//! End-to-end tests for the `sampleCount` native node.
//!
//! These exercise the full Rust-authoring → Graph → Runtime → native C++
//! processor path, plus the VFS (`SharedResourceMap`) wiring.
//!
//! Root fade-in note: `RootNode` multiplies every new graph by a 20 ms
//! fade-in envelope, so for the first ~960 samples @ 48 kHz the emitted
//! signal rises from 0 to its true value. Assertions that read the exact
//! length value sample-for-sample warm past the fade first.

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

/// Basic contract: after registering an f32 asset with N samples, the
/// `sampleCount` node's output must equal N on every sample once the
/// root fade-in has settled.
#[test]
fn sample_count_emits_resource_length_on_every_sample() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let asset_len = 4096_usize;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    // Register the resource BEFORE rendering a graph that references it.
    let asset: Vec<f32> = (0..asset_len).map(|i| i as f32 * 0.0001).collect();
    runtime
        .add_shared_resource_f32("test/len-asset", &asset)
        .expect("add resource");

    let graph = Graph::new().render(extra::sample_count(json!({ "path": "test/len-asset" })));
    let mounted = graph.mount().expect("mount");
    runtime
        .apply_instructions(mounted.batch())
        .expect("apply mount");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut block = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [block.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process");
    }

    let expected = asset_len as f64;
    for (i, &s) in block.iter().enumerate() {
        assert!(
            (s - expected).abs() < 1e-9,
            "sample {i}: expected {expected}, got {s}",
        );
    }
}

/// Rendering a graph that references a not-yet-registered asset must fail
/// cleanly (matches the `el::sample` / `el::table` contract).
#[test]
fn sample_count_rejects_unknown_path_at_render_time() {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(64)
        .call()
        .expect("runtime");

    // NOTE: no `add_shared_resource_f32` call — the path does not exist.
    let graph = Graph::new().render(extra::sample_count(
        json!({ "path": "nope/nonexistent.wav" }),
    ));
    let mounted = graph.mount().expect("mount");

    let result = runtime.apply_instructions(mounted.batch());
    assert!(
        result.is_err(),
        "applying a graph with an unknown VFS path must fail, got Ok",
    );
}

/// Swapping the `path` prop at runtime updates the emitted length on the
/// next block. Uses the fast-path property update (no re-mount) so the
/// node identity is stable — this mirrors how a UI-driven demo would
/// swap assets via `mounted.set_property("path", ...)`.
#[test]
fn sample_count_reflects_length_of_whichever_asset_is_named() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let short: Vec<f32> = vec![0.0; 128];
    let long: Vec<f32> = vec![0.0; 9001];
    runtime
        .add_shared_resource_f32("test/short", &short)
        .expect("add short");
    runtime
        .add_shared_resource_f32("test/long", &long)
        .expect("add long");

    // Start with the short asset, using a keyed node so we can look it up later.
    let graph = Graph::new().render(extra::sample_count(
        json!({ "key": "len", "path": "test/short" }),
    ));
    let mounted = graph.mount().expect("mount");
    runtime
        .apply_instructions(mounted.batch())
        .expect("apply mount");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out_a = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out_a.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process A");
    }
    assert!(
        (out_a[buffer_size - 1] - 128.0).abs() < 1e-9,
        "first path should emit 128.0, got {}",
        out_a[buffer_size - 1],
    );

    // Swap the path on the already-mounted node via fast-path property update.
    let len_node = mounted
        .node_with_key("len")
        .expect("keyed sampleCount node");
    let swap = len_node.set_property("path", json!("test/long"));
    runtime.apply_instructions(&swap).expect("apply swap");

    // The next block should emit the new length. No root fade to burn off
    // because we did not re-mount.
    let mut out_b = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out_b.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process B");
    }
    assert!(
        (out_b[buffer_size - 1] - 9001.0).abs() < 1e-9,
        "after path swap, should emit 9001.0, got {}",
        out_b[buffer_size - 1],
    );
}

/// `unit: "ms"` scales the output to milliseconds: `1000 × len / sr`.
#[test]
fn sample_count_unit_ms_yields_duration_in_milliseconds() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    // 1.0 second of silence at 48 kHz.
    let asset: Vec<f32> = vec![0.0; 48_000];
    runtime
        .add_shared_resource_f32("test/one-sec-ms", &asset)
        .expect("add");

    let graph = Graph::new().render(extra::sample_count(
        json!({ "path": "test/one-sec-ms", "unit": "ms" }),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process");
    }

    for (i, &s) in out.iter().enumerate() {
        assert!(
            (s - 1000.0).abs() < 1e-9,
            "sample {i}: expected 1000.0 ms, got {s}",
        );
    }
}

/// `unit: "hz"` yields the fundamental period frequency: `sr / len`.
/// A 2-second asset at 48 kHz should emit exactly 0.5 Hz.
#[test]
fn sample_count_unit_hz_yields_fundamental_period() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    // 2.0 seconds of silence at 48 kHz → 96000 samples.
    let asset: Vec<f32> = vec![0.0; 96_000];
    runtime
        .add_shared_resource_f32("test/two-sec-hz", &asset)
        .expect("add");

    let graph = Graph::new().render(extra::sample_count(
        json!({ "path": "test/two-sec-hz", "unit": "hz" }),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process");
    }

    for (i, &s) in out.iter().enumerate() {
        assert!(
            (s - 0.5).abs() < 1e-9,
            "sample {i}: expected 0.5 Hz, got {s}",
        );
    }
}

/// Default `unit` is `"samp"` — omitting the prop preserves the
/// backward-compatible raw-count behavior that the earlier
/// `sample_count_emits_resource_length_on_every_sample` test established.
#[test]
fn sample_count_unit_defaults_to_samp_when_omitted() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let asset: Vec<f32> = vec![0.0; 7777];
    runtime
        .add_shared_resource_f32("test/default-unit", &asset)
        .expect("add");

    // Omit `unit` entirely.
    let graph = Graph::new().render(extra::sample_count(json!({ "path": "test/default-unit" })));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process");
    }

    for (i, &s) in out.iter().enumerate() {
        assert!(
            (s - 7777.0).abs() < 1e-9,
            "sample {i}: expected 7777.0 (default unit is samp), got {s}",
        );
    }
}

/// Unknown unit token must be rejected with an error.
#[test]
fn sample_count_rejects_unknown_unit() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let asset: Vec<f32> = vec![0.0; 1024];
    runtime
        .add_shared_resource_f32("test/unknown-unit", &asset)
        .expect("add");

    // `"seconds"` is not one of the accepted tokens.
    let graph = Graph::new().render(extra::sample_count(
        json!({ "path": "test/unknown-unit", "unit": "seconds" }),
    ));
    let mounted = graph.mount().expect("mount");

    let result = runtime.apply_instructions(mounted.batch());
    assert!(
        result.is_err(),
        "unknown unit token must be rejected, got Ok",
    );
}

/// Swapping `unit` at runtime via `mounted.set_property` updates the
/// emitted value on the next block.
#[test]
fn sample_count_unit_swap_at_runtime() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let asset: Vec<f32> = vec![0.0; 48_000]; // exactly 1 second
    runtime
        .add_shared_resource_f32("test/unit-swap", &asset)
        .expect("add");

    // Start in "samp" (default).
    let graph = Graph::new().render(extra::sample_count(
        json!({ "key": "len", "path": "test/unit-swap" }),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("samp");
    }
    assert!(
        (out[buffer_size - 1] - 48_000.0).abs() < 1e-9,
        "default samp: expected 48000, got {}",
        out[buffer_size - 1],
    );

    // Switch to "ms" via fast-path property update.
    let len_node = mounted.node_with_key("len").expect("keyed sampleCount");
    runtime
        .apply_instructions(&len_node.set_property("unit", json!("ms")))
        .expect("switch to ms");

    {
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("ms");
    }
    assert!(
        (out[buffer_size - 1] - 1000.0).abs() < 1e-9,
        "after switch to ms: expected 1000.0, got {}",
        out[buffer_size - 1],
    );

    // Switch to "hz".
    runtime
        .apply_instructions(&len_node.set_property("unit", json!("hz")))
        .expect("switch to hz");

    {
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut outputs).expect("hz");
    }
    assert!(
        (out[buffer_size - 1] - 1.0).abs() < 1e-9,
        "after switch to hz: expected 1.0, got {}",
        out[buffer_size - 1],
    );
}

/// Composing with `el::sr()` yields duration in seconds:
///     duration_s = sampleCount(path) / sr
#[test]
fn sample_count_composes_with_sr_to_give_seconds() {
    use elemaudio_rs::el;
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    // 48000 samples == exactly 1.0 seconds at this sample rate.
    let one_second: Vec<f32> = vec![0.0; 48_000];
    runtime
        .add_shared_resource_f32("test/one-second", &one_second)
        .expect("add");

    let length_node = extra::sample_count(json!({ "path": "test/one-second" }));
    let duration_s = el::div((length_node, el::sr()));

    let graph = Graph::new().render(duration_s);
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process");
    }

    for (i, &s) in out.iter().enumerate() {
        assert!(
            (s - 1.0).abs() < 1e-9,
            "sample {i}: expected 1.0 seconds, got {s}",
        );
    }
}
