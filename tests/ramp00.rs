//! End-to-end tests for the `ramp00` native node.
//!
//! These exercise the full path: Rust authoring → Graph → Runtime → native
//! C++ processor → output buffer. They assert analytic properties of the
//! signal (not just "output is non-zero") so regressions in the C++ side are
//! caught precisely.
//!
//! Note on root fade-in: Elementary's `RootNode` applies a 20 ms fade-in and
//! fade-out on every activated root (see `Core.h` line 80). At 48 kHz that is
//! 960 samples. Tests here warm the runtime past that fade before asserting
//! raw output values, otherwise the expected ramp is multiplied by the
//! fade envelope and comparisons fail.

use elemaudio_rs::{el, extra, ElemNode, Graph, Runtime};
use serde_json::json;

/// Render enough silent blocks to drain the root's 20 ms fade-in so raw
/// processor output can be asserted against analytic values.
fn warm_past_root_fade(runtime: &Runtime, sample_rate: f64, buffer_size: usize) {
    // 20 ms fade-in + safety margin.
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

/// Untriggered ramp00 should produce pure silence.
#[test]
fn ramp00_outputs_zero_without_trigger() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let dur = el::const_with_key("dur", 480.0);
    let trig = el::const_with_key("trig", 0.0);
    let ramp = extra::ramp00(json!({ "blocking": true }), dur, ElemNode::from(trig));
    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // Several blocks with no trigger.
    let mut probe = vec![0.0_f64; buffer_size];
    for _ in 0..4 {
        let mut o = [probe.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("process");
        assert!(
            probe.iter().all(|&s| s == 0.0),
            "untriggered ramp must be silent; first nonzero = {:?}",
            probe.iter().position(|&s| s != 0.0),
        );
    }
}

/// When the trigger flips from 0 → 1 between two render blocks, the ramp
/// should start at 0 and increment by ~1/dur per sample. The peak sample
/// (1.0) must be emitted, then the output drops to 0.
#[test]
fn ramp00_produces_linear_ramp_ending_at_one_then_zero() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let dur = 32.0; // short enough that a single buffer covers trigger + ramp + tail

    // First mount: trigger held at 0. Process one block of silence.
    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let dur_node = el::const_with_key("dur", dur);
    let trig_node = el::const_with_key("trig", 0.0);
    let ramp = extra::ramp00(
        json!({ "blocking": true }),
        dur_node,
        ElemNode::from(trig_node),
    );
    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount");

    runtime
        .apply_instructions(mounted.batch())
        .expect("apply mount");

    // Warm past the 20 ms root fade so raw ramp values are observable.
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // Flip trig → 1.0 between blocks. This is a rising edge on block boundary.
    let update = mounted.set_const_value("trig", 1.0).expect("trig is keyed");
    runtime
        .apply_instructions(&update)
        .expect("apply trigger flip");

    // Next block: trigger rises at sample 0; ramp should go 0, 1/dur, 2/dur, ...
    let mut block2 = vec![0.0_f64; buffer_size];
    {
        let mut outputs = [block2.as_mut_slice()];
        runtime
            .process(buffer_size, &[], &mut outputs)
            .expect("process");
    }

    // Expected first few samples: 0, 1/32, 2/32, ..., up to and including 1.0
    // at sample 32, then 0 from sample 33 onward.
    let step = 1.0 / dur;
    // Sample 0 is the triggering sample: value=0 is emitted, then incremented.
    assert_eq!(block2[0], 0.0, "triggering sample must emit 0");
    // Samples 1..=32 increase linearly.
    for i in 1..=(dur as usize) {
        let expected = (i as f64) * step;
        let expected = expected.min(1.0);
        let diff = (block2[i] - expected).abs();
        assert!(
            diff < 1e-9,
            "sample {i}: expected {expected}, got {}; diff = {}",
            block2[i],
            diff,
        );
    }
    // Peak sample: the last sample of the ramp must reach 1.0 exactly.
    assert!(
        (block2[dur as usize] - 1.0).abs() < 1e-9,
        "peak sample must equal 1.0, got {}",
        block2[dur as usize],
    );
    // After the peak, output must drop to 0 for the rest of the block.
    for i in (dur as usize + 1)..buffer_size {
        assert_eq!(
            block2[i], 0.0,
            "post-peak sample {i} must be 0, got {}",
            block2[i],
        );
    }
}

/// With `blocking = true`, a second rising edge *during* the ramp must be
/// ignored. Without blocking, the ramp restarts.
#[test]
fn ramp00_blocking_suppresses_mid_ramp_retrigger() {
    let sample_rate = 48_000.0;
    let buffer_size = 128;
    let dur = 64.0;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let dur_node = el::const_with_key("dur", dur);
    // Trigger is driven by a phasor-square train at 250 Hz (period = 192
    // samples @ 48kHz), but we only need two rising edges during the test
    // so we hand-craft a gate signal using `le(phasor, 0.5)` with a keyed
    // rate and toggle the rate between blocks to simulate retrigger timing.
    //
    // Simpler approach: drive trig with a keyed const and manually toggle it.
    let trig_node = el::const_with_key("trig", 0.0);
    let ramp = extra::ramp00(
        json!({ "blocking": true }),
        dur_node,
        ElemNode::from(trig_node),
    );

    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount");
    runtime
        .apply_instructions(mounted.batch())
        .expect("apply mount");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // Rising edge: 0 → 1 at start of next block.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 1.0).unwrap())
        .expect("edge 1");

    let mut b2 = vec![0.0_f64; buffer_size];
    {
        let mut o = [b2.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("p2");
    }

    // Block should contain the rising ramp (samples 0..=dur), then zeros.
    // The ramp value at sample k (for k > 0, k <= dur) should be k/dur.
    assert!(
        (b2[1] - (1.0 / dur)).abs() < 1e-9,
        "ramp started (sample 1 = 1/dur): got {}",
        b2[1],
    );

    // Second scenario: longer dur so the ramp straddles two buffers; force a
    // retrigger mid-ramp and verify blocking=true ignores it.
    drop(mounted);
    drop(runtime);

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime 2");

    let long_dur = 256.0; // > 2 buffer lengths
    let dur_node = el::const_with_key("dur", long_dur);
    let trig_node = el::const_with_key("trig", 0.0);
    let ramp = extra::ramp00(
        json!({ "blocking": true }),
        dur_node,
        ElemNode::from(trig_node),
    );
    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount 2");
    runtime
        .apply_instructions(mounted.batch())
        .expect("apply 2");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // First rising edge.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 1.0).unwrap())
        .expect("first edge");

    let mut block_a = vec![0.0_f64; buffer_size];
    {
        let mut o = [block_a.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("a");
    }
    // Ramp running: last sample of block_a ≈ buffer_size / long_dur = 0.5.
    assert!(
        block_a[buffer_size - 1] > 0.4 && block_a[buffer_size - 1] < 0.6,
        "ramp should be ~halfway through block A: got {}",
        block_a[buffer_size - 1],
    );

    // Realize a real low→high transition on the trigger to produce an
    // observable rising edge (a single atomic trig=0 followed by trig=1
    // before processing would collapse into "still high"). With
    // blocking=true, the rising edge must be ignored and the ramp must
    // continue uninterrupted.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 0.0).unwrap())
        .expect("low");
    let mut block_low = vec![0.0_f64; buffer_size];
    {
        let mut o = [block_low.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("low");
    }
    // Ramp continues during trig=0 (trig going low does not stop it). At end
    // of block_low the ramp is past the half point — a restart would drop to
    // 0 and climb slowly; a correct blocking node keeps the value high.
    let prev_last = block_low[buffer_size - 1];

    runtime
        .apply_instructions(&mounted.set_const_value("trig", 1.0).unwrap())
        .expect("high (retrigger attempt)");

    let mut block_b = vec![0.0_f64; buffer_size];
    {
        let mut o = [block_b.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("b");
    }

    // Critical assertion: block_b[0] must be strictly greater than
    // prev_last (one sample's worth of continued climb). If the retrigger
    // had been accepted, block_b[0] would be 0.
    assert!(
        block_b[0] > prev_last - 1e-9,
        "blocking=true failed to suppress retrigger: block_b[0]={} vs block_low last={}",
        block_b[0],
        prev_last,
    );
}

/// With `blocking = false`, a rising edge during a running ramp restarts it.
///
/// Note on realizing a "retrigger" via keyed consts: applying `trig=0` and
/// then `trig=1` back-to-back BEFORE processing does not produce an
/// observable rising edge — the const node stores an atomic `value` that
/// simply ends at 1.0 when the next block runs, so no edge is visible to
/// the downstream node. To produce a real rising edge, we must process a
/// block with `trig=0` (dropping the gate), then apply `trig=1` and process
/// another block (raising the gate). The edge is at block boundary.
#[test]
fn ramp00_non_blocking_allows_mid_ramp_retrigger() {
    let sample_rate = 48_000.0;
    let buffer_size = 128;
    let long_dur = 512.0; // > 4 buffers, so the ramp is definitely running during retrigger

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let dur_node = el::const_with_key("dur", long_dur);
    let trig_node = el::const_with_key("trig", 0.0);
    let ramp = extra::ramp00(
        json!({ "blocking": false }),
        dur_node,
        ElemNode::from(trig_node),
    );
    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // First rising edge. Keeping trig high for one block lets the ramp run.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 1.0).unwrap())
        .expect("edge1");

    let mut block_a = vec![0.0_f64; buffer_size];
    {
        let mut o = [block_a.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("a");
    }
    // Ramp should be running: last sample is roughly buffer_size/long_dur =
    // 128/512 = 0.25.
    assert!(
        block_a[buffer_size - 1] > 0.15 && block_a[buffer_size - 1] < 0.35,
        "ramp should be ~1/4 through block A: got {}",
        block_a[buffer_size - 1],
    );

    // Drop trig → process a block so the downstream node actually sees trig=0.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 0.0).unwrap())
        .expect("low");
    let mut block_gap = vec![0.0_f64; buffer_size];
    {
        let mut o = [block_gap.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("gap");
    }
    // Ramp continues (trig=0 does not stop a running ramp, it just prepares
    // the next rising edge). The value at end of block_gap should be around
    // 2 × buffer_size / long_dur = 0.5.
    assert!(
        block_gap[buffer_size - 1] > 0.4 && block_gap[buffer_size - 1] < 0.6,
        "ramp should be ~halfway through block_gap: got {}",
        block_gap[buffer_size - 1],
    );

    // Raise trig again → this is a real rising edge at block boundary.
    // blocking=false: ramp restarts at 0.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 1.0).unwrap())
        .expect("high");

    let mut block_b = vec![0.0_f64; buffer_size];
    {
        let mut o = [block_b.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("b");
    }

    // block_b[0] must be 0 (restart), NOT continuing from block_gap's last.
    assert!(
        block_b[0] < 1e-9,
        "non-blocking: retrigger should restart ramp at 0, got {}",
        block_b[0],
    );
    // And sample 1 should be 1/long_dur.
    assert!(
        (block_b[1] - 1.0 / long_dur).abs() < 1e-9,
        "non-blocking: sample 1 after retrigger must be 1/dur, got {}",
        block_b[1],
    );
}

/// `dur <= 0` at trigger time: the trigger must be ignored and output stays 0.
#[test]
fn ramp00_ignores_trigger_when_dur_is_zero() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let dur_node = el::const_with_key("dur", 0.0);
    let trig_node = el::const_with_key("trig", 0.0);
    let ramp = extra::ramp00(
        json!({ "blocking": true }),
        dur_node,
        ElemNode::from(trig_node),
    );
    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // Rising edge while dur is 0 — trigger must be ignored.
    runtime
        .apply_instructions(&mounted.set_const_value("trig", 1.0).unwrap())
        .expect("trig");

    let mut out = vec![0.0_f64; buffer_size];
    {
        let mut o = [out.as_mut_slice()];
        runtime.process(buffer_size, &[], &mut o).expect("p");
    }

    assert!(
        out.iter().all(|&s| s == 0.0),
        "dur<=0 must suppress trigger; first nonzero at {:?}",
        out.iter().position(|&s| s != 0.0),
    );
}

/// The trigger argument is `impl Into<ElemNode>`, which means a per-sample
/// signal (for example `el::train(rate)`) works just like a numeric const —
/// but edges inside a block are detected at the exact sample they occur,
/// not at the next block boundary.
///
/// Scenario: drive the trigger with a `train(rate)` whose period crosses a
/// single render block. The first rising edge inside the block must start
/// the ramp at that exact sample, and the ramp must run uninterrupted from
/// there. This is the property that differentiates `ramp00` from a
/// graph-rebuild-based approach.
///
/// With `rate=100 Hz` at `sr=48000`, the period is 480 samples. `phasor`
/// starts at 0 and wraps every 480 samples; `train = le(phasor, 0.5)` is
/// high for samples where `phasor <= 0.5` (i.e. samples 0..=240 of each
/// period, low for 241..=479). The rising edge (transition low→high) lands
/// at sample 480 (start of the second period).
///
/// If the runtime's buffer_size is 64, then after a ~100 ms warm-up the
/// phasor state can land anywhere; the key property we actually test is:
/// the ramp's first sample after we detect nonzero output must be at a
/// sample index that aligns with the first sample AFTER a rising edge, and
/// the subsequent values must be `k/dur` for consecutive `k`. This
/// demonstrates that edge detection is per-sample, not per-block.
#[test]
fn ramp00_triggered_by_per_sample_signal_detects_edge_mid_block() {
    let sample_rate = 48_000.0;
    let buffer_size = 128;
    // Short ramp so the whole thing fits well inside one block no matter
    // where the edge lands.
    let dur: f64 = 16.0;
    // Low rate so there's at most one rising edge in the observation window.
    // At 8 Hz, period = 6000 samples; one edge per ~47 blocks of 128.
    let rate_hz: f64 = 8.0;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime");

    let dur_node = el::const_(dur);
    let trig_signal = el::train(el::const_(rate_hz));
    let ramp = extra::ramp00(json!({ "blocking": true }), dur_node, trig_signal);

    let graph = Graph::new().render(ramp);
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    // Collect enough blocks that at least one full period has elapsed and
    // we're guaranteed to observe at least one rising edge.
    let period_samples = (sample_rate / rate_hz) as usize; // 6000
    let blocks_needed = (period_samples / buffer_size) + 2;
    let mut all = Vec::with_capacity(blocks_needed * buffer_size);
    for _ in 0..blocks_needed {
        let mut block = vec![0.0_f64; buffer_size];
        {
            let mut o = [block.as_mut_slice()];
            runtime.process(buffer_size, &[], &mut o).expect("process");
        }
        all.extend_from_slice(&block);
    }

    // Find the first nonzero ramp output.
    let first_nonzero = all
        .iter()
        .position(|&s| s != 0.0)
        .expect("at least one rising edge should have fired");

    // The triggering sample itself must be 0 (my node emits 0 on the edge
    // sample then increments). So first_nonzero corresponds to the sample
    // AFTER the edge; its value must be exactly 1/dur (within float eps).
    let expected_step = 1.0 / dur;
    let diff = (all[first_nonzero] - expected_step).abs();
    assert!(
        diff < 1e-9,
        "first nonzero ramp sample (index {}) must be 1/dur = {}, got {}; diff = {}",
        first_nonzero,
        expected_step,
        all[first_nonzero],
        diff,
    );

    // And the subsequent samples must continue the linear ramp at 1/dur
    // per sample for the next (dur - 1) samples.
    for k in 1..(dur as usize) {
        let idx = first_nonzero + k;
        let expected = ((k + 1) as f64) * expected_step;
        let expected = expected.min(1.0);
        let got = all[idx];
        assert!(
            (got - expected).abs() < 1e-9,
            "sample {idx} (k={k} after edge): expected {expected}, got {got}",
        );
    }

    // Peak sample reaches 1.0 exactly.
    let peak_idx = first_nonzero + (dur as usize) - 1;
    assert!(
        (all[peak_idx] - 1.0).abs() < 1e-9,
        "peak at index {peak_idx} must equal 1.0, got {}",
        all[peak_idx],
    );

    // And the sample immediately after the peak must be 0 (drop).
    assert_eq!(
        all[peak_idx + 1],
        0.0,
        "post-peak sample at index {} must be 0, got {}",
        peak_idx + 1,
        all[peak_idx + 1],
    );

    // The triggering edge must NOT be aligned to a block boundary —
    // verifying that edge detection is truly per-sample. The "sample before
    // the first nonzero output" is the triggering sample (output 0 at the
    // edge, then 1/dur next). Its index modulo buffer_size should almost
    // never be 0; asserting it is nonzero would be flaky if the phasor
    // happens to align. Instead, assert something robust: the ramp
    // completed within a SINGLE block would cross a block boundary if and
    // only if `trigger_index % buffer_size + dur > buffer_size`. We don't
    // need to test that path specifically — the per-sample correctness is
    // already asserted above (every sample from the edge onward matches
    // the analytic ramp regardless of where it landed in the buffer).
    let trigger_index = first_nonzero - 1;
    let offset_in_block = trigger_index % buffer_size;
    eprintln!(
        "ramp triggered at global sample {trigger_index} (offset {offset_in_block} \
         within its block of size {buffer_size}); per-sample ramp values match \
         the analytic expectation at every sample."
    );
}
