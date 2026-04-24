//! End-to-end tests for the `frameclock` native node.
//!
//! These verify that frameclock is anchored to absolute sample time rather than
//! local block boundaries, so pulse placement remains exact across uneven host
//! process sizes, explicit time seeks, and runtime resets.

use elemaudio_rs::{Graph, Runtime, extra};

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

fn mount_frameclock(runtime: &Runtime, period: usize) {
    let graph = Graph::new().render(extra::frameclock(period));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
}

#[test]
fn frameclock_emits_pulses_at_exact_absolute_periods_across_uneven_blocks() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let period = 16_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    mount_frameclock(&runtime, period);
    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.set_current_time_samples(0);

    let block_sizes = [7_usize, 5, 19, 3, 22, 8];
    let mut absolute = 0_usize;

    for &block_size in &block_sizes {
        let mut block = vec![0.0_f64; block_size];
        let mut outputs = [block.as_mut_slice()];
        runtime
            .process(block_size, &[], &mut outputs)
            .expect("process");

        for (i, &sample) in block.iter().enumerate() {
            let t = absolute + i;
            let expected = if t % period == 0 { 1.0 } else { 0.0 };
            assert_eq!(
                sample, expected,
                "absolute sample {t}: expected {expected}, got {sample}",
            );
        }

        absolute += block_size;
    }
}

#[test]
fn frameclock_respects_explicit_absolute_time_seek() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let period = 16_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    mount_frameclock(&runtime, period);
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    runtime.set_current_time_samples(13);

    let mut block = vec![0.0_f64; buffer_size];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(buffer_size, &[], &mut outputs)
        .expect("process");

    for (i, &sample) in block.iter().enumerate() {
        let t = 13 + i;
        let expected = if t % period == 0 { 1.0 } else { 0.0 };
        assert_eq!(
            sample, expected,
            "absolute sample {t}: expected {expected}, got {sample}",
        );
    }
}

#[test]
fn frameclock_restarts_from_sample_zero_after_reset_and_time_reset() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let period = 8_usize;
    let runtime = build_runtime(sample_rate, buffer_size);

    mount_frameclock(&runtime, period);
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut pre_reset = vec![0.0_f64; buffer_size];
    let mut outputs = [pre_reset.as_mut_slice()];
    runtime
        .process(buffer_size, &[], &mut outputs)
        .expect("pre-reset process");

    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut post_reset = vec![0.0_f64; buffer_size];
    let mut outputs = [post_reset.as_mut_slice()];
    runtime
        .process(buffer_size, &[], &mut outputs)
        .expect("post-reset process");

    for (i, &sample) in post_reset.iter().enumerate() {
        let expected = if i % period == 0 { 1.0 } else { 0.0 };
        assert_eq!(
            sample, expected,
            "post-reset sample {i}: expected {expected}, got {sample}",
        );
    }
}
