use std::error::Error;

use cpal::SampleFormat;
use cpal::traits::{DeviceTrait, HostTrait};
use elemaudio_rs::AudioRingBuffer;
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
    ring: AudioRingBuffer,
    channels: usize,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    match format {
        SampleFormat::F32 => device.build_output_stream(
            config,
            move |output: &mut [f32], _| {
                ring.pop_to_hardware(output, channels, |sample| sample);
            },
            err_fn,
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            config,
            move |output: &mut [i16], _| {
                ring.pop_to_hardware(output, channels, |sample| {
                    let clamped = sample.clamp(-1.0, 1.0);
                    (clamped * i16::MAX as f32) as i16
                });
            },
            err_fn,
            None,
        ),
        SampleFormat::U16 => device.build_output_stream(
            config,
            move |output: &mut [u16], _| {
                ring.pop_to_hardware(output, channels, |sample| {
                    let clamped = sample.clamp(-1.0, 1.0);
                    (((clamped + 1.0) * 0.5) * u16::MAX as f32) as u16
                });
            },
            err_fn,
            None,
        ),
        other => panic!("unsupported output sample format: {other:?}"),
    }
}
