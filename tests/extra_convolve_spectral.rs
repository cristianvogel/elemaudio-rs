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
    let output = convolver_output(ir, props, source, true);
    rms(&output)
}

fn rms(samples: &[f64]) -> f64 {
    let sum_squares = samples.iter().map(|sample| sample * sample).sum::<f64>();
    (sum_squares / samples.len() as f64).sqrt()
}

fn convolver_output(ir: &[f32], props: serde_json::Value, source: Node, spectral: bool) -> Vec<f64> {
    let tilt = props
        .get("tiltDbPerOct")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);
    let blur = props
        .get("blur")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);

    convolver_output_with_controls(ir, props, el::const_(tilt), el::const_(blur), source, spectral)
}

fn convolver_output_with_controls(
    ir: &[f32],
    props: serde_json::Value,
    tilt: Node,
    blur: Node,
    source: Node,
    spectral: bool,
) -> Vec<f64> {
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

    let graph = if spectral {
        Graph::new().render(extra::convolve_spectral(props, tilt, blur, source))
    } else {
        Graph::new().render(extra::convolve(props, source))
    };

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut output = Vec::with_capacity(buffer_size * 256);
    // Block 0: Impulse
    let mut input = vec![0.0_f64; buffer_size];
    input[0] = 1.0;
    {
        let mut out = vec![0.0_f64; buffer_size];
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[input.as_slice()], &mut outputs).expect("process");
        output.extend(out);
    }

    for _ in 1..256 {
        let mut out = vec![0.0_f64; buffer_size];
        let mut outputs = [out.as_mut_slice()];
        runtime.process(buffer_size, &[vec![0.0; buffer_size].as_slice()], &mut outputs).expect("process");
        output.extend(out);
    }

    output
}

fn spectral_output_rms_with_controls(ir: &[f32], props: serde_json::Value, tilt: Node, blur: Node, source: Node) -> f64 {
    let output = convolver_output_with_controls(ir, props, tilt, blur, source, true);
    rms(&output)
}

fn spectral_impulse_response(ir: &[f32], props: serde_json::Value, blocks: usize) -> Vec<f64> {
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

    let graph = Graph::new().render(extra::convolve_spectral(
        props,
        el::const_(0.0),
        el::const_(0.0),
        el::r#in(json!({"channel": 0}), None),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    let mut warm_remaining = ((sample_rate * 0.040).ceil() as usize).max(buffer_size);
    while warm_remaining > 0 {
        let this_block = warm_remaining.min(buffer_size);
        let input = vec![0.0_f64; this_block];
        let mut out = vec![0.0_f64; this_block];
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(this_block, &[input.as_slice()], &mut outputs)
            .expect("warm process");
        warm_remaining -= this_block;
    }

    let mut output = Vec::with_capacity(buffer_size * blocks);
    for block in 0..blocks {
        let mut input = vec![0.0_f64; buffer_size];
        if block == 0 {
            input[0] = 1.0;
        }

        let mut out = vec![0.0_f64; buffer_size];
        let mut outputs = [out.as_mut_slice()];
        runtime
            .process(buffer_size, &[input.as_slice()], &mut outputs)
            .expect("process");
        output.extend(out);
    }

    output
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
        el::const_(0.0),
        el::const_(0.0),
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
        el::const_(0.0),
        el::const_(0.0),
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
fn extra_convolve_spectral_positive_tilt_attenuates_dc() {
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
        el::const_(6.0),
        el::const_(0.0),
        el::const_(1.0),
    ));

    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");
    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let last = settle_last_sample(&runtime, buffer_size, 20);
    assert!(
        last < 1.0,
        "positive spectral tilt should attenuate DC/constant response, got {last}"
    );
}

// `extra_convolve_spectral_blur_smooths_input_and_creates_tail` was
// removed: it was added during the FrameBlur experiment and assumed
// input-side magnitude smoothing. The musical 1-pole model only smooths
// IR magnitudes, so this assertion was incompatible by construction. If
// input-side smoothing is revisited later, restore the test from the
// FrameBlur commit history and adjust it to match the chosen model.

#[test]
fn extra_convolve_spectral_uses_frame_latched_blur_child() {
    let mut ir = vec![0.0_f32; 128];
    ir[0] = 1.0;
    ir[64] = 0.25;

    let neutral = spectral_output_rms_with_controls(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "blur": 0.5}),
        el::const_(0.0),
        el::const_with_key("spectral-blur-child", 0.0),
        el::r#in(json!({"channel": 0}), None),
    );
    let blurred = spectral_output_rms_with_controls(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "blur": 0.0}),
        el::const_(0.0),
        el::const_with_key("spectral-blur-child", 0.5),
        el::r#in(json!({"channel": 0}), None),
    );

    assert!(
        (blurred - neutral).abs() > 1e-10,
        "blur child should override prop fallback at frame boundaries, neutral {neutral}, blurred {blurred}"
    );
}

#[test]
fn extra_convolve_spectral_accepts_keyable_tilt_child() {
    let mut ir = vec![0.0_f32; 128];
    ir[0] = 1.0;
    ir[8] = -0.75;
    ir[32] = 0.5;

    let neutral = spectral_output_rms_with_controls(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "tiltDbPerOct": -12.0}),
        el::const_with_key("spectral-tilt-child", 0.0),
        el::const_(0.0),
        el::cycle(el::const_(440.0)),
    );
    let tilted = spectral_output_rms_with_controls(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512, "tiltDbPerOct": 0.0}),
        el::const_with_key("spectral-tilt-child", -12.0),
        el::const_(0.0),
        el::cycle(el::const_(440.0)),
    );

    assert!(
        (tilted - neutral).abs() > 0.01,
        "tilt child should override prop fallback at frame boundaries, neutral {neutral}, tilted {tilted}"
    );
}

#[test]
fn extra_convolve_spectral_neutral_impulse_response_is_clean_delayed_fir() {
    let mut ir = vec![0.0_f32; 192];
    ir[0] = 0.7;
    ir[17] = -0.3;
    ir[64] = 0.2;
    ir[129] = -0.1;

    let output = spectral_impulse_response(
        &ir,
        json!({"path": "ir", "partitionSize": 64, "tailBlockSize": 512}),
        5,
    );

    let mut expected = vec![0.0; output.len()];
    for (i, sample) in ir.iter().enumerate() {
        expected[64 + i] = f64::from(*sample);
    }

    let diff = output.iter().zip(expected.iter()).map(|(a, b)| a - b).collect::<Vec<_>>();

    assert!(
        rms(&diff) < 1e-9,
        "neutral spectral convolver should reproduce the delayed FIR impulse response, diff rms {}",
        rms(&diff)
    );
}

