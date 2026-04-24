//! End-to-end tests for the `iirHilbert` native node.

use elemaudio_rs::{Graph, Runtime, el, extra};
use serde_json::json;

fn warm_past_root_fade(runtime: &Runtime, sample_rate: f64, buffer_size: usize) {
    let warm_samples = ((sample_rate * 0.040).ceil() as usize).max(buffer_size);
    let mut remaining = warm_samples;
    while remaining > 0 {
        let this_block = remaining.min(buffer_size);
        let mut real = vec![0.0_f64; this_block];
        let mut imag = vec![0.0_f64; this_block];
        let mut outputs = [real.as_mut_slice(), imag.as_mut_slice()];
        runtime.process(this_block, &[], &mut outputs).expect("warm process");
        remaining -= this_block;
    }
}

#[test]
fn iir_hilbert_is_silent_for_silence() {
    let sample_rate = 48_000.0;
    let buffer_size = 128;
    let runtime = Runtime::new().sample_rate(sample_rate).buffer_size(buffer_size).call().expect("runtime");

    let graph = Graph::new().render(extra::iir_hilbert(json!({ "passbandGain": 2.0 }), el::const_(0.0)));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut real = vec![0.0_f64; buffer_size];
    let mut imag = vec![0.0_f64; buffer_size];
    let mut outputs = [real.as_mut_slice(), imag.as_mut_slice()];
    runtime.process(buffer_size, &[], &mut outputs).expect("process");

    assert!(real.iter().all(|&sample| sample == 0.0));
    assert!(imag.iter().all(|&sample| sample == 0.0));
}

#[test]
fn iir_hilbert_produces_quadrature_pair_for_sine() {
    let sample_rate = 48_000.0;
    let buffer_size = 512;
    let runtime = Runtime::new().sample_rate(sample_rate).buffer_size(buffer_size).call().expect("runtime");

    let graph = Graph::new().render(extra::iir_hilbert(
        json!({ "passbandGain": 2.0 }),
        el::cycle(el::const_(1_000.0)),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);

    let mut real = vec![0.0_f64; buffer_size];
    let mut imag = vec![0.0_f64; buffer_size];
    let mut outputs = [real.as_mut_slice(), imag.as_mut_slice()];
    runtime.process(buffer_size, &[], &mut outputs).expect("process");

    let avg_magnitude = real
        .iter()
        .zip(&imag)
        .map(|(&re, &im)| (re * re + im * im).sqrt())
        .sum::<f64>()
        / buffer_size as f64;
    let imag_peak = imag.iter().map(|sample| sample.abs()).fold(0.0_f64, f64::max);

    assert!(
        (0.9..=1.1).contains(&avg_magnitude),
        "analytic magnitude should stay near 1 for a unit sine; got {avg_magnitude}"
    );
    assert!(
        imag_peak > 0.5,
        "Hilbert quadrature output should be clearly non-zero for a sine; peak {imag_peak}"
    );
}
