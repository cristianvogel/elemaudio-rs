use std::error::Error;
use std::thread;
use std::time::Duration;
use std::time::Instant;

use cpal::traits::StreamTrait;
use elemaudio_rs::{AudioRingBuffer, Runtime};

#[cfg(feature = "resources")]
#[path = "audio_decode.rs"]
mod audio_decode;
#[path = "audio_support.rs"]
mod audio_support;
#[path = "test_dsp.rs"]
mod test_dsp;

#[test]
#[ignore]
fn play_graph_through_ring_buffer_with_fast_path_setter() -> Result<(), Box<dyn Error>> {
    let (device, supported) = audio_support::default_output_setup()?;
    let stream_config = supported.config();
    let sample_rate = stream_config.sample_rate.0 as f64;
    let hardware_channels = stream_config.channels as usize;
    let process_channels = hardware_channels.max(2);
    let buffer_size = 128usize;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()?;

    let graph = test_dsp::demo_graph();
    let mounted = graph.mount();

    runtime.apply_instructions(mounted.batch())?;

    let ring = AudioRingBuffer::new(process_channels, sample_rate as usize, sample_rate)?;
    let producer_ring = ring.clone();

    let producer = thread::spawn(move || -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut outputs_storage: Vec<Vec<f64>> = vec![vec![0.0; buffer_size]; process_channels];
        let tick_interval = Duration::from_millis(250);
        let mut next_tick = Instant::now() + tick_interval;
        let mut tick = 0u32;

        loop {
            let now = Instant::now();

            if now >= next_tick {
                let block = (tick / 4) % 2;
                let train_value = if block == 0 {
                    (tick % 20) as f64 + 2.0
                } else {
                    (tick % 10) as f64 + 2.0
                };
                tick += 1;

                // Update the keyed consts via the mounted-node fast path.
                runtime.apply_instructions(
                    &mounted
                        .set_const_value("left_train", train_value)
                        .expect("left_train const should be keyed"),
                )?;

                runtime.apply_instructions(
                    &mounted
                        .set_const_value("right_train", train_value)
                        .expect("right_train const should be keyed"),
                )?;

                // Keep the companion timing consts in sync with the same tick.
                runtime.apply_instructions(
                    &mounted
                        .set_const_value("left_train_short", train_value)
                        .expect("left_train_short const should be keyed"),
                )?;

                runtime.apply_instructions(
                    &mounted
                        .set_const_value("right_train_short", train_value)
                        .expect("right_train_short const should be keyed"),
                )?;
                next_tick += tick_interval;
            }

            let free = producer_ring.free_frames();
            // backpressure check to see if
            // the consumer side is full enough that
            // the producer should pause
            if free == 0 {
                thread::sleep(Duration::from_millis(1));
                continue;
            }

            let frames = buffer_size.min(free);
            let mut outputs: Vec<&mut [f64]> = outputs_storage
                .iter_mut()
                .map(|buffer| &mut buffer[..frames])
                .collect();

            // A glitch would happen only if the producer falls behind
            // and the ring buffer runs dry, causing the audio callback
            // to read silence or underrun.
            runtime.process(frames, &[], &mut outputs)?;

            let channel_refs: Vec<&[f64]> = outputs_storage
                .iter()
                .map(|buffer| &buffer[..frames])
                .collect();
            let _ = producer_ring.push_planar_f64(&channel_refs, frames);
        }
    });

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

#[test]
#[ignore]
#[cfg(feature = "resources")]
// Requires `--features resources` so the native shared-resource bridge is linked.
/// To run this mc test:
/// `cargo test --test audio_playback --features resources -- --ignored play_mc_graph_through_ring_buffer`
fn play_mc_graph_through_ring_buffer() -> Result<(), Box<dyn Error>> {
    use elemaudio_rs::{el, mc, Graph};
    use std::path::PathBuf;

    let (device, supported) = audio_support::default_output_setup()?;
    let stream_config = supported.config();
    let sample_rate = stream_config.sample_rate.0 as f64;
    let hardware_channels = stream_config.channels as usize;
    let process_channels = hardware_channels.max(2);
    let buffer_size = 128usize;

    let runtime = Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()?;

    let wav_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("examples/demo-resources/mc-test.wav");
    let sample_path = "demo-resources/mc-test.wav";
    let audio_buffer = audio_decode::decode_wav(&wav_path)?;
    runtime.add_audio_resource(sample_path, audio_buffer)?;

    let stereo_sample_loop = mc::sample(
        serde_json::json!({
            "mode": "loop",
            "path": sample_path,
            "channels": 2,
            "playbackRate": 1
        }),
        el::const_(1.0),
    );

    let graph = Graph::new()
        .render(stereo_sample_loop.clone());

    let mounted = graph.mount();
    runtime.apply_instructions(mounted.batch())?;

    let ring = AudioRingBuffer::new(process_channels, sample_rate as usize, sample_rate)?;
    let producer_ring = ring.clone();

    let producer = thread::spawn(move || -> Result<(), Box<dyn Error + Send + Sync>> {
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
    });

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
    let _ = producer;

    thread::park();
    Ok(())
}
