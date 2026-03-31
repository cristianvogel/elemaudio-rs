use std::collections::VecDeque;
use std::error::Error;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::SampleFormat;
use elemaudio_rs::Runtime;

pub fn default_output_setup() -> Result<(cpal::Device, cpal::SupportedStreamConfig), Box<dyn Error>>
{
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| String::from("no default output device available"))?;
    let supported = device.default_output_config()?;
    Ok((device, supported))
}

pub fn build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: SampleFormat,
    queue: Arc<Mutex<VecDeque<f32>>>,
    channels: usize,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    match format {
        SampleFormat::F32 => device.build_output_stream(
            config,
            move |output: &mut [f32], _| write_audio(output, &queue, channels, |sample| sample),
            err_fn,
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            config,
            move |output: &mut [i16], _| {
                write_audio(output, &queue, channels, |sample| {
                    let clamped = sample.clamp(-1.0, 1.0);
                    (clamped * i16::MAX as f32) as i16
                })
            },
            err_fn,
            None,
        ),
        SampleFormat::U16 => device.build_output_stream(
            config,
            move |output: &mut [u16], _| {
                write_audio(output, &queue, channels, |sample| {
                    let clamped = sample.clamp(-1.0, 1.0);
                    (((clamped + 1.0) * 0.5) * u16::MAX as f32) as u16
                })
            },
            err_fn,
            None,
        ),
        other => panic!("unsupported output sample format: {other:?}"),
    }
}

pub fn prefill_queue(
    runtime: &Runtime,
    queue: &Arc<Mutex<VecDeque<f32>>>,
    frames: usize,
    blocks: usize,
) -> Result<(), Box<dyn Error>> {
    for _ in 0..blocks {
        let mut output = vec![0.0_f64; frames];
        let mut outputs = [&mut output[..]];
        runtime.process(frames, &[], &mut outputs)?;

        let mut queue = queue.lock().expect("audio queue poisoned");
        queue.extend(output.into_iter().map(|sample| sample as f32));
    }

    Ok(())
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
