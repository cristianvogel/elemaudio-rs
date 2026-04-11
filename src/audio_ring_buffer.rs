use crate::{Error, Result};
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

/// Lock-free SPSC ring buffer for interleaved audio samples.
#[derive(Debug, Clone)]
pub struct AudioRingBuffer {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    channels: usize,
    capacity_frames: usize,
    sample_rate: AtomicU64,
    write_pos: AtomicUsize,
    read_pos: AtomicUsize,
    samples: Box<[AtomicU32]>,
}

impl AudioRingBuffer {
    /// Creates a new ring buffer.
    pub fn new(channels: usize, capacity_frames: usize, sample_rate: f64) -> Result<Self> {
        if channels == 0 {
            return Err(Error::InvalidArgument("channels must be greater than zero"));
        }

        if capacity_frames == 0 {
            return Err(Error::InvalidArgument(
                "capacity_frames must be greater than zero",
            ));
        }

        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return Err(Error::InvalidArgument(
                "sample_rate must be a positive finite number",
            ));
        }

        let sample_count = channels
            .checked_mul(capacity_frames)
            .ok_or(Error::InvalidArgument("ring buffer capacity is too large"))?;

        let samples = (0..sample_count)
            .map(|_| AtomicU32::new(0))
            .collect::<Vec<_>>()
            .into_boxed_slice();

        Ok(Self {
            inner: Arc::new(Inner {
                channels,
                capacity_frames,
                sample_rate: AtomicU64::new(sample_rate.to_bits()),
                write_pos: AtomicUsize::new(0),
                read_pos: AtomicUsize::new(0),
                samples,
            }),
        })
    }

    /// Returns the configured number of channels.
    pub fn channels(&self) -> usize {
        self.inner.channels
    }

    /// Returns the frame capacity.
    pub fn capacity_frames(&self) -> usize {
        self.inner.capacity_frames
    }

    /// Returns the current sample rate.
    pub fn sample_rate(&self) -> f64 {
        f64::from_bits(self.inner.sample_rate.load(Ordering::Relaxed))
    }

    /// Updates the sample rate and clears buffered audio.
    pub fn reset_sample_rate(&self, sample_rate: f64) -> Result<()> {
        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return Err(Error::InvalidArgument(
                "sample_rate must be a positive finite number",
            ));
        }

        self.clear();
        self.inner
            .sample_rate
            .store(sample_rate.to_bits(), Ordering::Relaxed);
        Ok(())
    }

    /// Returns the number of frames currently buffered.
    pub fn available_frames(&self) -> usize {
        let write = self.inner.write_pos.load(Ordering::Acquire);
        let read = self.inner.read_pos.load(Ordering::Acquire);
        write.saturating_sub(read).min(self.inner.capacity_frames)
    }

    /// Returns the remaining free frames.
    pub fn free_frames(&self) -> usize {
        self.inner
            .capacity_frames
            .saturating_sub(self.available_frames())
    }

    /// Clears buffered audio.
    pub fn clear(&self) {
        self.inner.write_pos.store(0, Ordering::Release);
        self.inner.read_pos.store(0, Ordering::Release);
        for sample in self.inner.samples.iter() {
            sample.store(0, Ordering::Relaxed);
        }
    }

    /// Pushes planar `f64` channel slices into the ring.
    pub fn push_planar_f64(&self, inputs: &[&[f64]], frames: usize) -> usize {
        if inputs.len() != self.channels() || frames == 0 {
            return 0;
        }

        if inputs.iter().any(|channel| channel.len() < frames) {
            return 0;
        }

        let frames = frames.min(self.free_frames());
        if frames == 0 {
            return 0;
        }

        let channels = self.channels();
        let mut write = self.inner.write_pos.load(Ordering::Relaxed);

        for frame in 0..frames {
            let slot = write % self.inner.capacity_frames;
            let base = slot * channels;

            for (channel, channel_input) in inputs.iter().enumerate().take(channels) {
                self.inner.samples[base + channel]
                    .store((channel_input[frame] as f32).to_bits(), Ordering::Relaxed);
            }

            write = write.wrapping_add(1);
        }

        self.inner.write_pos.store(write, Ordering::Release);
        frames
    }

    /// Pops interleaved audio into a hardware buffer.
    pub fn pop_to_hardware<T>(
        &self,
        output: &mut [T],
        hardware_channels: usize,
        convert: impl Fn(f32) -> T,
    ) -> usize
    where
        T: Copy + Default,
    {
        if output.is_empty() || hardware_channels == 0 {
            return 0;
        }

        let frames = output.len() / hardware_channels;
        let frames = frames.min(self.available_frames());
        let active_channels = self.channels().min(hardware_channels);
        let channels = self.channels();
        let mut read = self.inner.read_pos.load(Ordering::Relaxed);

        for frame in 0..frames {
            let slot = read % self.inner.capacity_frames;
            let base = slot * channels;
            let out_base = frame * hardware_channels;

            for channel in 0..active_channels {
                output[out_base + channel] = convert(f32::from_bits(
                    self.inner.samples[base + channel].load(Ordering::Relaxed),
                ));
            }

            for channel in active_channels..hardware_channels {
                output[out_base + channel] = T::default();
            }

            read = read.wrapping_add(1);
        }

        for sample in &mut output[frames * hardware_channels..] {
            *sample = T::default();
        }

        self.inner.read_pos.store(read, Ordering::Release);
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::AudioRingBuffer;

    #[test]
    fn push_and_pop() {
        let ring = AudioRingBuffer::new(2, 8, 48_000.0).unwrap();
        let written = ring.push_planar_f64(&[&[1.0, 3.0], &[2.0, 4.0]], 2);
        assert_eq!(written, 2);

        let mut out = [0.0_f32; 4];
        let read = ring.pop_to_hardware(&mut out, 2, |x| x);
        assert_eq!(read, 2);
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn underrun_zero_fills() {
        let ring = AudioRingBuffer::new(2, 8, 48_000.0).unwrap();
        let mut out = [9.0_f32; 4];
        let read = ring.pop_to_hardware(&mut out, 2, |x| x);
        assert_eq!(read, 0);
        assert_eq!(out, [0.0, 0.0, 0.0, 0.0]);
    }
}
