use std::error::Error;
use std::thread;
use std::time::Duration;

use cpal::traits::StreamTrait;
use elemaudio_rs::{el, AudioRingBuffer, Graph, Runtime};

#[path = "audio_support.rs"]
mod audio_support;

#[test]
#[ignore]
fn play_sparseq_sequence_through_ring_buffer() -> std::result::Result<(), Box<dyn Error>> {
    let (device, supported) = audio_support::default_output_setup()?;
    let stream_config = supported.config();
    let sample_rate = stream_config.sample_rate.0 as f64;
    let hardware_channels = stream_config.channels as usize;
    let process_channels = hardware_channels.max(1);
    let buffer_size = 128usize;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()?;


    fn trigger() -> elemaudio_rs::Node {
        el::train(el::const_(2.0))
    };

    fn freq_sequence() -> elemaudio_rs::Node {
        el::sparseq(
            serde_json::json!({
            "seq": [
                { "value": 110.0, "tickTime": 0.0 },
                { "value": 165.0, "tickTime": 1.0 },
                { "value": 220.0, "tickTime": 2.0 },
                { "value": 330.0, "tickTime": 3.0 },
                { "value": 440.0, "tickTime": 4.0 },
                { "value": 660.0, "tickTime": 5.0 }
            ],
            "loop": [0, 5]
        }),
            trigger(),
            el::const_(0.0),
            el::const_(0.0),
        )
    }

    let seq = freq_sequence();

    let graph = Graph::new().root(el::mul([
        el::hann(el::phasor(seq.clone())),
        el::env(
            el::tau2pole(el::const_(0.01)),
            el::tau2pole(el::const_(0.1)),
            el::train(el::const_(2.0)),
        ),
        el::cycle(seq),
    ]));

    runtime.apply_instructions(&graph.lower())?;

    let ring = AudioRingBuffer::new(process_channels, sample_rate as usize, sample_rate)?;
    let producer_ring = ring.clone();

    let producer = thread::spawn(
        move || -> std::result::Result<(), Box<dyn Error + Send + Sync>> {
            let mut outputs_storage: Vec<Vec<f64>> = vec![vec![0.0; buffer_size]; process_channels];

            loop {
                let free = producer_ring.free_frames();
                if free == 0 {
                    thread::sleep(Duration::from_millis(1));
                    continue;
                }

                let frames = buffer_size.min(free);
                let mut outputs: Vec<&mut [f64]> = outputs_storage
                    .iter_mut()
                    .map(|buffer| &mut buffer[..frames])
                    .collect();

                runtime.process(frames, &[], &mut outputs)?;

                let channel_refs: Vec<&[f64]> = outputs_storage
                    .iter()
                    .map(|buffer| &buffer[..frames])
                    .collect();
                let _ = producer_ring.push_planar_f64(&channel_refs, frames);
            }
        },
    );

    // a startup gate, waits until the producer has prefilled some audio
    while ring.available_frames() < buffer_size * 4 {
        thread::sleep(Duration::from_millis(5));
    }

    let stream = audio_support::build_stream(
        &device,
        &stream_config,
        supported.sample_format(),
        ring,
        hardware_channels,
        |error| eprintln!("cpal stream error: {error}"),
    )?;

    stream.play().expect("failed to start audio stream");
    let _ = producer; // keep producer thread alive for the lifetime of the demo

    loop {
        thread::park();
    }
}
