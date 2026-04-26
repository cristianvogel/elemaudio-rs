# FrameLib FFT Integration in `convolveSpectral`

This document details the implementation and architectural decisions regarding the integration of **FrameLib** for spectral processing within the `convolveSpectral` node.

## 1. Block Sizes and Latency

The spectral engine operates on a partitioned convolution model, where the impulse response (IR) is divided into equal-sized segments.

*   **`partitionSize` (L)**: The user-defined block size for processing. 
*   **FFT Size (N)**: Always set to **`partitionSize * 2`**. This provides the necessary zero-padding to perform linear convolution via the overlap-add method without time-domain aliasing.
*   **Spectrum Size**: `N / 2` bins (plus DC and Nyquist).
*   **Latency**: The algorithmic latency is exactly `partitionSize` samples.

## 2. FrameLib Real FFT Format

FrameLib's `spectral_processor::rfft` uses a packed format for real-to-complex transforms to maximize efficiency.

### Bin 0 Packing
In the `Split` buffer returned by the FFT:
*   `realp[0]` contains the **DC component** (0 Hz).
*   `imagp[0]` contains the **Nyquist component** (Fs/2).

Since both DC and Nyquist are purely real in the frequency domain, their imaginary parts are always zero. FrameLib packs the Nyquist real value into the imaginary slot of the DC bin.

### Spectral Processing Logic
When applying spectral shaping (tilt, blur, or gain):
1.  **DC**: Processed using `realp[0]`.
2.  **Nyquist**: Processed using `imagp[0]`.
3.  **Bins 1 to (N/2 - 1)**: Processed as standard complex pairs (`realp[i]`, `imagp[i]`).

## 3. Phase Integrity and Synchronized Updates

To avoid "phase smears" or audible glitches during parameter changes or IR swaps, all updates are latched to the start of a partition cycle.

### Update Latching
The `FrameLibSpectralConvolver` monitors `inputFill`. Property updates (like `gain`) and convolver swaps (on `path` or `partitionSize` changes) only occur when `inputFill == 0`.

### IR Swapping
When a new IR is loaded:
1.  A new `FrameLibSpectralConvolver` instance is created in a background thread or a non-audio-critical path.
2.  It is pushed into a `SingleWriterSingleReaderQueue`.
3.  The active convolver checks this queue at the start of every partition and swaps itself with the new instance if one is available.

## 4. Memory Management (`FrameLibTlsfAllocator`)

FrameLib requires a real-time safe allocator for its internal spectral structures. We use the **TLSF (Two-Level Segregate Fit)** allocator.

*   **Pool Allocation**: A contiguous memory pool is allocated upfront (default 1MB or scaled by FFT size).
*   **Real-time Safety**: `tlsf_memalign` and `tlsf_free` are O(1) and guaranteed not to block, making them suitable for the audio thread.
*   **Shared State**: The allocator state is managed via `std::shared_ptr` to ensure the memory pool outlives any internal FrameLib objects that might reference it during destruction.

## 5. Spectral Shaping Math

### Spectral Tilt
The tilt is applied in decibels per octave, using a geometric pivot point:
*   **Pivot**: `sqrt(maxBin)` (geometric center of the spectrum).
*   **Formula**: `gain = tiltDb * log2((bin + 1) / (pivotBin + 1))`.
*   **Stability**: Gains are clamped to ±40dB to prevent "gain explosions" at extreme frequencies.

### Smoothing (Blur)
Uses a one-pole moving average filter across successive FFT frames for each bin:
*   `alpha = 1.0 - blurAmount`.
*   Magnitudes are smoothed independently, and phase is preserved by scaling the original complex vector.

## 6. Implementation References

*   `src/native/extra/convolve_spectral.h`: Primary implementation.
*   `src/native/third_party/framelib/`: FrameLib dependency headers.
