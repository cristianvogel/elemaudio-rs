use std::collections::VecDeque;
use std::error::Error;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use elemaudio_rs::{el, Graph, Runtime};

#[test]
#[ignore]
fn play_rust_authored_graph_through_cpal() -> std::result::Result<(), Box<dyn Error>> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .expect("no default output device available");
    let supported = device
        .default_output_config()
        .expect("could not read default output config");

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
    runtime.apply_instructions(&graph.lower())?;

    let mut rendered = 0usize;
    let mut outputs_storage: Vec<Vec<f64>> = vec![vec![0.0; buffer_size]; channels];
    let mut queue = VecDeque::with_capacity(total_frames * channels);

    while rendered < total_frames {
        let frames = buffer_size.min(total_frames - rendered);
        let mut outputs: Vec<&mut [f64]> = outputs_storage
            .iter_mut()
            .map(|buffer| &mut buffer[..frames])
            .collect();

        runtime.process(frames, &[], &mut outputs)?;

        for frame in 0..frames {
            for channel in 0..channels {
                queue.push_back(outputs_storage[channel][frame] as f32);
            }
        }

        rendered += frames;
    }

    let shared = Arc::new(Mutex::new(queue));
    let err_fn = |error| eprintln!("cpal stream error: {error}");

    let stream = match supported.sample_format() {
        SampleFormat::F32 => {
            build_stream_f32(&device, &stream_config, shared.clone(), channels, err_fn)?
        }
        SampleFormat::I16 => {
            build_stream_i16(&device, &stream_config, shared.clone(), channels, err_fn)?
        }
        SampleFormat::U16 => {
            build_stream_u16(&device, &stream_config, shared.clone(), channels, err_fn)?
        }
        other => panic!("unsupported output sample format: {other:?}"),
    };

    stream.play().expect("failed to start audio stream");
    thread::sleep(Duration::from_secs_f64(seconds));

    Ok(())
}

fn build_stream_f32(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Arc<Mutex<VecDeque<f32>>>,
    channels: usize,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_output_stream(
        config,
        move |output: &mut [f32], _| write_audio(output, &queue, channels, |sample| sample),
        err_fn,
        None,
    )
}

fn build_stream_i16(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Arc<Mutex<VecDeque<f32>>>,
    channels: usize,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_output_stream(
        config,
        move |output: &mut [i16], _| {
            write_audio(output, &queue, channels, |sample| {
                let clamped = sample.clamp(-1.0, 1.0);
                (clamped * i16::MAX as f32) as i16
            })
        },
        err_fn,
        None,
    )
}

fn build_stream_u16(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Arc<Mutex<VecDeque<f32>>>,
    channels: usize,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_output_stream(
        config,
        move |output: &mut [u16], _| {
            write_audio(output, &queue, channels, |sample| {
                let clamped = sample.clamp(-1.0, 1.0);
                (((clamped + 1.0) * 0.5) * u16::MAX as f32) as u16
            })
        },
        err_fn,
        None,
    )
}

fn write_audio<T>(
    output: &mut [T],
    queue: &Arc<Mutex<VecDeque<f32>>>,
    channels: usize,
    convert: impl Fn(f32) -> T,
) where
    T: Copy + Default,
{
    let mut queue = queue.lock().expect("audio queue poisoned");

    for frame in output.chunks_mut(channels) {
        for sample in frame {
            *sample = queue.pop_front().map(&convert).unwrap_or_default();
        }
    }
}
