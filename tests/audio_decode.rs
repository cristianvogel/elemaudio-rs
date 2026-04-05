/// Helper for decoding audio resources formats using Symphonia
use std::error::Error;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

use elemaudio_rs::AudioBuffer;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};

pub fn decode_wav(path: impl AsRef<Path>) -> Result<AudioBuffer, Box<dyn Error>> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("wav");

    let probed = get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("missing default track")?;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or("missing sample rate")?;
    let channels = track
        .codec_params
        .channels
        .ok_or("missing channels")?
        .count();
    let mut decoder = get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
    let mut samples = Vec::new();

    loop {
        match format.next_packet() {
            Ok(packet) => {
                let decoded = match decoder.decode(&packet) {
                    Ok(decoded) => decoded,
                    Err(SymphoniaError::ResetRequired) => continue,
                    Err(err) => return Err(err.into()),
                };

                let spec = *decoded.spec();
                let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                sample_buf.copy_interleaved_ref(decoded);
                let interleaved = sample_buf.samples();

                samples.extend_from_slice(interleaved);
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => continue,
            Err(err) => return Err(err.into()),
        }
    }

    Ok(AudioBuffer {
        samples: Arc::from(samples.into_boxed_slice()),
        sample_rate,
        channels: channels as u16,
    })
}
