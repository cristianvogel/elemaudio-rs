//! Audio support utilities for integration tests.
//!
//! This module provides helper functions to initialize and manage audio output
//! streams using the `cpal` library. It bridges the `elemaudio_rs::AudioRingBuffer`
//! with hardware audio endpoints, handling device discovery, configuration, and
//! sample format conversion for continuous audio playback during tests.

use std::error::Error;

use cpal::SampleFormat;
use cpal::traits::{DeviceTrait, HostTrait};
use elemaudio_rs::AudioRingBuffer;

/// Discovers and configures the default system audio output device.
///
/// This function queries the host system for its default audio output endpoint
/// and retrieves its default stream configuration.
///
/// # Returns
///
/// Returns a tuple containing the selected `cpal::Device` and its
/// `cpal::SupportedStreamConfig` on success, or an error if no device is available
/// or if configuration retrieval fails.
pub fn default_output_setup() -> Result<(cpal::Device, cpal::SupportedStreamConfig), Box<dyn Error>>
{
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| String::from("no default output device available"))?;
    let supported = device.default_output_config()?;
    Ok((device, supported))
}

/// Builds and configures an audio playback stream for the specified device.
///
/// This function creates an output stream that continuously pulls audio samples
/// from the provided `AudioRingBuffer` and pushes them to the hardware audio buffer.
/// It automatically handles conversion from the internal `f32` representation to
/// the hardware's required sample format (`f32`, `i16`, or `u16`).
///
/// # Arguments
///
/// * `device` - The `cpal::Device` to output audio to.
/// * `config` - The `cpal::StreamConfig` specifying sample rate and channel count.
/// * `format` - The hardware `cpal::SampleFormat` expected by the device.
/// * `ring` - The `AudioRingBuffer` containing rendered audio frames.
/// * `channels` - The number of audio channels (e.g., 2 for stereo).
/// * `err_fn` - A callback function invoked when a stream error occurs.
///
/// # Returns
///
/// Returns a ready-to-play `cpal::Stream` on success, or a `cpal::BuildStreamError`
/// if stream creation fails.
///
/// # Panics
///
/// Panics if the requested output sample format is not supported (i.e., not `f32`, `i16`, or `u16`).
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
