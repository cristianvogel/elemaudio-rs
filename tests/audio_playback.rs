use std::collections::VecDeque;
use std::error::Error;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::StreamTrait;
use elemaudio_rs::{el, Graph, Runtime};

#[path = "audio_support.rs"]
mod audio_support;

#[test]
#[ignore]
fn play_rust_authored_graph_through_cpal() -> std::result::Result<(), Box<dyn Error>> {
    let (device, supported) = audio_support::default_output_setup()?;

    let stream_config = supported.config();
    let sample_rate = stream_config.sample_rate.0 as f64;
    let channels = stream_config.channels as usize;
    let buffer_size = 128usize;
    let seconds = 2.0;
    let total_frames = (sample_rate * seconds) as usize;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()?;

    let graph = (0..channels).fold(Graph::new(), |graph, _| {
        graph.root(el::cycle(el::const_(220.0)))
    });
    let process_channels = graph.roots().len();
    runtime.apply_instructions(&graph.lower())?;

    let mut rendered = 0usize;
    let mut outputs_storage: Vec<Vec<f64>> = vec![vec![0.0; buffer_size]; process_channels];
    let mut queue = VecDeque::with_capacity(total_frames * process_channels);

    while rendered < total_frames {
        let frames = buffer_size.min(total_frames - rendered);
        let mut outputs: Vec<&mut [f64]> = outputs_storage
            .iter_mut()
            .map(|buffer| &mut buffer[..frames])
            .collect();

        runtime.process(frames, &[], &mut outputs)?;

        for frame in 0..frames {
            for channel in 0..process_channels {
                queue.push_back(outputs_storage[channel][frame] as f32);
            }
        }

        rendered += frames;
    }

    let shared = Arc::new(Mutex::new(queue));
    let err_fn = |error| eprintln!("cpal stream error: {error}");

    let stream = audio_support::build_stream(
        &device,
        &stream_config,
        supported.sample_format(),
        shared.clone(),
        process_channels,
        channels,
        err_fn,
    )?;

    stream.play().expect("failed to start audio stream");
    thread::sleep(Duration::from_secs_f64(seconds));

    Ok(())
}

#[test]
#[ignore]
fn play_windowed_sine_with_fast_path_frequency() -> std::result::Result<(), Box<dyn Error>> {
    let (device, supported) = audio_support::default_output_setup()?;

    let stream_config = supported.config();
    let sample_rate = stream_config.sample_rate.0 as f64;
    let channels = stream_config.channels as usize;
    let buffer_size = 128usize;
    let process_channels = 1usize;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()?;

    ///////////////////////////
    // Graph definition     //
    let graph = Graph::new().root(el::mul([
        el::hann(el::phasor(el::const_with_key(
            Option::from("hann_rate"),
            0.2,
        ))),
        el::cycle(el::const_with_key(Option::from("freq"), 220.0)),
    ]));
    ///////////////////////////

    let mounted = graph.mount();

    runtime.apply_instructions(mounted.batch())?;

    let queue = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(buffer_size * 32)));
    let err_fn = |error| eprintln!("cpal stream error: {error}");

    audio_support::prefill_queue(&runtime, &queue, buffer_size, 16, process_channels)?;

    let stream = audio_support::build_stream(
        &device,
        &stream_config,
        supported.sample_format(),
        queue.clone(),
        process_channels,
        channels,
        err_fn,
    )?;

    stream.play().expect("failed to start audio stream");

    let sweep = [110.0, 165.0, 320.0, 330.0, 440.0, 660.0];
    let rate = [0.1, 0.5, 0.3];
    let mut index = 0usize;

    loop {
        let next_freq = sweep[index % sweep.len()];
        let next_rate = rate[index % rate.len()];
        index += 1;
        runtime.apply_instructions(
            &mounted
                .set_const_value("hann_rate", next_rate)
                .expect("hann_rate should be keyed const"),
        )?;
        runtime.apply_instructions(
            &mounted
                .set_const_value("freq", next_freq)
                .expect("freq should be keyed const"),
        )?;
        audio_support::prefill_queue(&runtime, &queue, buffer_size, 4, process_channels)?;
    }
}
