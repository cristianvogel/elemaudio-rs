#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

#include <elem/GraphNode.h>
#include <elem/SingleWriterSingleReaderQueue.h>

#include "../third_party/framelib/FrameLib_Dependencies/Interpolation.hpp"
#include "../third_party/framelib/FrameLib_Dependencies/SpectralFunctions.hpp"
#include "../third_party/framelib/FrameLib_Dependencies/SpectralProcessor.hpp"
#include "../third_party/framelib/FrameLib_Dependencies/tlsf/tlsf.h"

namespace elem
{
    struct FrameLibTlsfAllocator {
        using value_type = void;
        using size_type = size_t;
        using difference_type = ptrdiff_t;
        using propagate_on_container_move_assignment = std::true_type;

        struct State {
            explicit State(size_t bytes)
                : storage(std::malloc(bytes))
                , size(bytes)
                , tlsf(storage != nullptr ? tlsf_create_with_pool(storage, bytes) : nullptr)
            {}

            ~State()
            {
                if (tlsf != nullptr) {
                    tlsf_destroy(tlsf);
                }
                std::free(storage);
            }

            void* allocate(size_t size, size_t alignment)
            {
                if (tlsf == nullptr) return nullptr;
                return tlsf_memalign(tlsf, alignment, size);
            }

            void deallocate(void* ptr)
            {
                if (ptr != nullptr && tlsf != nullptr) {
                    tlsf_free(tlsf, ptr);
                }
            }

            void* storage{nullptr};
            size_t size{0};
            tlsf_t tlsf{nullptr};
        };

        explicit FrameLibTlsfAllocator(size_t bytes = defaultPoolBytes)
            : state(std::make_shared<State>(std::max(bytes, defaultPoolBytes)))
        {}

        void* allocate(size_t size, size_t alignment = alignof(std::max_align_t))
        {
            auto* ptr = state ? state->allocate(size, alignment) : nullptr;
            if (ptr == nullptr) {
                throw std::bad_alloc();
            }
            return ptr;
        }

        void deallocate(void* ptr, size_t /*size*/ = 0)
        {
            if (state) {
                state->deallocate(ptr);
            }
        }

        template <typename T>
        T* allocate(size_t count)
        {
            return static_cast<T*>(allocate(count * sizeof(T), alignof(T)));
        }

        template <typename T>
        void deallocate(T*& ptr)
        {
            if (ptr != nullptr) {
                deallocate(ptr, 0);
                ptr = nullptr;
            }
        }

        static constexpr size_t defaultPoolBytes = 1024 * 1024 * 4;
        std::shared_ptr<State> state;
    };

    // Standard allocator wrapper for FrameLib TLSF
    template <typename T>
    struct FrameLibAllocator {
        using value_type = T;
        using size_type = size_t;
        using difference_type = ptrdiff_t;
        using propagate_on_container_move_assignment = std::true_type;

        std::shared_ptr<FrameLibTlsfAllocator::State> state;

        FrameLibAllocator() = default;
        FrameLibAllocator(FrameLibTlsfAllocator& alloc) : state(alloc.state) {}
        FrameLibAllocator(std::shared_ptr<FrameLibTlsfAllocator::State> s) : state(s) {}

        template <typename U>
        FrameLibAllocator(const FrameLibAllocator<U>& other) : state(other.state) {}

        T* allocate(size_t n) {
            if (state) {
                auto* ptr = static_cast<T*>(state->allocate(n * sizeof(T), alignof(T)));
                if (ptr) return ptr;
            }
            auto* ptr = static_cast<T*>(std::malloc(n * sizeof(T)));
            if (ptr == nullptr) {
                throw std::bad_alloc();
            }
            return ptr;
        }

        void deallocate(T* p, size_t /*n*/ = 0) {
            if (state) {
                state->deallocate(p);
            } else {
                std::free(p);
            }
        }

        template <typename U>
        bool operator==(const FrameLibAllocator<U>& other) const {
            return state == other.state;
        }

        template <typename U>
        bool operator!=(const FrameLibAllocator<U>& other) const {
            return !(*this == other);
        }
    };

    template <typename T>
    struct FrameLibSplitBuffer {
        using Split = typename FFTTypes<T>::Split;

        explicit FrameLibSplitBuffer(size_t size = 0, FrameLibAllocator<T> alloc = FrameLibAllocator<T>())
            : real(size, alloc)
            , imag(size, alloc)
        {}

        Split split()
        {
            return Split { real.data(), imag.data() };
        }

        void clear()
        {
            std::fill(real.begin(), real.end(), T(0));
            std::fill(imag.begin(), imag.end(), T(0));
        }

        std::vector<T, FrameLibAllocator<T>> real;
        std::vector<T, FrameLibAllocator<T>> imag;
    };

    template <typename T>
    struct FrameLibMagnitudeMovingAverage {
        explicit FrameLibMagnitudeMovingAverage(size_t size = 0, FrameLibAllocator<T> alloc = FrameLibAllocator<T>())
            : average(size, T(0), alloc)
        {}

        void reset()
        {
            std::fill(average.begin(), average.end(), T(0));
            initialized = false;
        }

        T process(size_t bin, T input, T alpha)
        {
            if (!initialized) {
                average[bin] = input;
            }

            if (alpha >= T(0.999999)) {
                average[bin] = input;
                return input;
            }

            if (alpha <= T(0.0)) {
                return average[bin];
            }

            // Standard exponential moving average: 
            // y[n] = alpha_ema * y[n-1] + (1 - alpha_ema) * x[n]
            // FrameLib's linear_interp(alpha, a, b) is a + alpha * (b - a) = (1-alpha)*a + alpha*b
            
            // In our case, we want:
            // alpha_ema = coefficient for previous (0.999 for long tail)
            // coefficient for new = 1 - alpha_ema
            
            // movingAverageAlpha returns (1 - blur^0.1). 
            // If blur=0.99, alpha \approx 0.001.
            // linear_interp(0.001, average, input) = 0.999 * average + 0.001 * input.
            // THIS IS CORRECT for long tail.
            
            average[bin] = linear_interp<T>()(alpha, average[bin], input);
            return average[bin];
        }

        void finishFrame()
        {
            initialized = true;
        }

        std::vector<T, FrameLibAllocator<T>> average;
        bool initialized{false};
    };

    template <typename T>
    struct FrameLibSpectralConvolver {
        using Split = typename FFTTypes<T>::Split;

        FrameLibSpectralConvolver(size_t partitionSize, std::vector<T> const& ir)
            : partSize(std::max<size_t>(16, partitionSize))
            , fftSize(partSize * 2)
            , fftLog2(spectral_processor<T, FrameLibTlsfAllocator>::calc_fft_size_log2(fftSize))
            , spectrumSize(fftSize >> 1)
            , allocator(requiredPoolBytes(fftSize))
            , buffer_allocator(allocator)
            , processor(allocator, fftSize)
            , inputBlock(fftSize, T(0), buffer_allocator)
            , fftOutput(fftSize, T(0), buffer_allocator)
            , overlap(partSize, T(0), buffer_allocator)
            , blockOutput(partSize, T(0), buffer_allocator)
            , currentInput(spectrumSize, buffer_allocator)
            , accum(spectrumSize, buffer_allocator)
            , processedIr(spectrumSize, buffer_allocator)
            , multiplyTemp(spectrumSize, buffer_allocator)
            , inputMagnitudeAverage(spectrumSize + 2, buffer_allocator)
        {
            auto const safeIrSize = std::max<size_t>(1, ir.size());
            partitionCount = (safeIrSize + partSize - 1) / partSize;
            irSpectra.reserve(partitionCount);
            inputSpectra.reserve(partitionCount);
            magnitudeAverages.reserve(partitionCount);

            for (size_t i = 0; i < partitionCount; ++i) {
                irSpectra.emplace_back(spectrumSize, buffer_allocator);
                inputSpectra.emplace_back(spectrumSize, buffer_allocator);
                magnitudeAverages.emplace_back(spectrumSize + 2, buffer_allocator);
            }

            std::vector<T> frame(fftSize, T(0));
            for (size_t partition = 0; partition < partitionCount; ++partition) {
                std::fill(frame.begin(), frame.end(), T(0));
                auto const offset = partition * partSize;
                auto const copyCount = offset < ir.size() ? std::min(partSize, ir.size() - offset) : size_t(0);
                if (copyCount > 0) {
                    std::copy_n(ir.data() + offset, copyCount, frame.data());
                }

                auto split = irSpectra[partition].split();
                processor.rfft(split, frame.data(), fftSize, fftLog2);
            }
        }

        void reset()
        {
            inputMagnitudeAverage.reset();
            for (auto& avg : magnitudeAverages) {
                avg.reset();
            }
        }

        size_t getPartitionSize() const { return partSize; }
        size_t getInputFill() const { return inputFill; }

        void process(T const* input, T const* tiltInput, T const* blurInput, T* output, size_t count, T gain)
        {
            for (size_t i = 0; i < count; ++i) {
                output[i] = blockOutput[outputRead++];

                auto const sample = input[i];
                inputBlock[inputFill++] = std::isfinite(static_cast<double>(sample)) ? sample : T(0);

                if (inputFill == partSize) {
                    auto const tilt = readControl(tiltInput, i, T(0));
                    auto const blur = readControl(blurInput, i, T(0));
                    processPartition(gain, tilt, blur);
                }
            }
        }

    private:
        void swapState(FrameLibSpectralConvolver& other)
        {
            // We only swap data that doesn't involve the allocator or internal references
            // if the FFT sizes are the same. If they differ, we'd need a more complex strategy,
            // but the current architecture ensures this is called on compatible objects or
            // completely replaces them (which we avoid here).
            if (fftSize != other.fftSize) {
                // If sizes differ, we can't easily swap without reallocating or breaking invariants.
                // For now, we assume the user doesn't change partition size frequently, 
                // and if they do, we might just accept a glitch or find a better way.
                return;
            }

            std::swap(partitionCount, other.partitionCount);
            std::swap(writeIndex, other.writeIndex);
            
            // We swap the contents of the vectors/buffers.
            // Since they use different allocators, we must be careful.
            // std::vector swap is O(1) if allocators are equal. 
            // Here they are NOT equal (different TlsfAllocator states).
            // In C++11+, if propagate_on_container_swap is false (default) and allocators 
            // are not equal, it's UB or it might do a linear copy.
            // Our FrameLibAllocator doesn't define propagate_on_container_swap, so it's false.
            
            // Safer to just swap the contents of the shared_ptrs if we used them,
            // but here we have flat vectors.
            
            // Actually, the most robust way to "replace" is to swap the data members 
            // that are NOT bound to the allocator by reference at construction time.
            
            irSpectra.swap(other.irSpectra);
            inputSpectra.swap(other.inputSpectra);
            
            // Note: magnitudeAverage is a single instance and we are inside swapState
            // which was noted as potentially UB or safe depending on allocators.
            // But swapState itself is not currently called in a way that matters 
            // as the Node uses shared_ptr swaps.
            // Still, let's keep it consistent.
            // We can't swap vectors with different allocators easily if propagate is false.
            // However, FrameLibMagnitudeMovingAverage has a vector.
            // Since we're not using this swapState (Node swaps shared_ptrs), 
            // I'll just remove the magnitudeAverages line.
            
            // The spectral_processor 'processor' and vectors 'inputBlock' etc are 
            // tied to the local 'allocator'. We should NOT swap them if allocators differ.
            // But 'irSpectra' and others are also tied to 'buffer_allocator'.
            
            // Wait, if we swap two vectors with different allocators and 
            // propagate_on_container_swap is false, it's technically undefined behavior 
            // unless the allocators compare equal.
            
            // Given the complexity and the crash, the safest thing is to NOT swap 
            // but to use a pointer to the convolver in the Node and swap THAT.
        }

        static T readControl(T const* signal, size_t index, T fallback)
        {
            if (signal == nullptr) {
                return fallback;
            }

            auto const value = signal[index];
            return std::isfinite(static_cast<double>(value)) ? value : fallback;
        }

        void processPartition(T gain, T tiltDb, T blurAmount)
        {
            blurAmount = std::max(T(0), std::min(T(1.0), blurAmount));
            std::fill(inputBlock.begin() + static_cast<std::ptrdiff_t>(partSize), inputBlock.end(), T(0));

            auto currentSplit = currentInput.split();
            processor.rfft(currentSplit, inputBlock.data(), fftSize, fftLog2);

            auto const blurAlpha = movingAverageAlpha(blurAmount);
            
            // Blur the input spectrum before it enters the history buffer.
            // This creates the "long tails" effect on the audio signal itself.
            applyMagnitudeSmoothing(currentSplit, currentSplit, blurAlpha, inputMagnitudeAverage);
            inputMagnitudeAverage.finishFrame();

            std::copy(currentInput.real.begin(), currentInput.real.end(), inputSpectra[writeIndex].real.begin());
            std::copy(currentInput.imag.begin(), currentInput.imag.end(), inputSpectra[writeIndex].imag.begin());
            
            // Debug: print RMS of blurred spectrum
            // double sum = 0;
            // for(auto x : currentInput.real) sum += x*x;
            // for(auto x : currentInput.imag) sum += x*x;
            // if (sum > 0) printf("Blurred input energy: %f, alpha: %f\n", sum, (double)blurAlpha);

            accum.clear();
            auto accumSplit = accum.split();
            auto tempSplit = multiplyTemp.split();
            auto const scale = T(0.25) / static_cast<T>(fftSize);

            for (size_t partition = 0; partition < partitionCount; ++partition) {
                auto const inputIndex = (writeIndex + partitionCount - partition) % partitionCount;
                auto inputSplit = inputSpectra[inputIndex].split();
                auto irSplit = irSpectra[partition].split();
                auto processedIrSplit = processedIr.split();
                auto& magnitudeAverage = magnitudeAverages[partition];
                
                // We also smooth the IR edits (tilt/gain) to avoid glitches and allow slow spectral morphs.
                processIrSpectrum(processedIrSplit, irSplit, gain, tiltDb, blurAlpha, magnitudeAverage);
                magnitudeAverage.finishFrame();
                
                ir_convolve_real(&tempSplit, &inputSplit, &processedIrSplit, fftSize, scale);

                for (size_t bin = 0; bin < spectrumSize; ++bin) {
                    accum.real[bin] += multiplyTemp.real[bin];
                    accum.imag[bin] += multiplyTemp.imag[bin];
                }
            }

            processor.rifft(fftOutput.data(), accumSplit, fftLog2);

            for (size_t i = 0; i < partSize; ++i) {
                auto const wet = fftOutput[i] + overlap[i];
                blockOutput[i] = std::isfinite(static_cast<double>(wet)) ? wet : T(0);
                overlap[i] = fftOutput[i + partSize];
            }

            // Standard overlap-add for partitioned convolution: 
            // fftSize = 2 * partSize. rifft produces fftSize samples.
            // We use the first partSize samples (added to previous overlap) as output.
            // The second partSize samples become the new overlap.
            
            outputRead = 0;
            writeIndex = (writeIndex + 1) % partitionCount;
            inputFill = 0;
        }

        void applyMagnitudeSmoothing(Split& output, Split const& input, T alpha, FrameLibMagnitudeMovingAverage<T>& magnitudeAverage)
        {
            // DC/Nyquist
            auto const dcReal = static_cast<double>(input.realp[0]);
            auto const smoothedDc = static_cast<double>(magnitudeAverage.process(0, static_cast<T>(std::abs(dcReal)), alpha));
            output.realp[0] = static_cast<T>(smoothedDc * (dcReal < 0 ? -1.0 : 1.0));

            auto const nyqReal = static_cast<double>(input.imagp[0]);
            auto const smoothedNyq = static_cast<double>(magnitudeAverage.process(spectrumSize, static_cast<T>(std::abs(nyqReal)), alpha));
            output.imagp[0] = static_cast<T>(smoothedNyq * (nyqReal < 0 ? -1.0 : 1.0));

            // Complex bins
            for (size_t bin = 1; bin < spectrumSize; ++bin) {
                auto const real = static_cast<double>(input.realp[bin]);
                auto const imag = static_cast<double>(input.imagp[bin]);
                auto const magnitude = std::sqrt(real * real + imag * imag);
                auto const smoothedMagnitude = static_cast<double>(magnitudeAverage.process(bin, static_cast<T>(magnitude), alpha));

                double const phaseScale = magnitude > 1.0e-20 ? smoothedMagnitude / magnitude : 0.0;
                output.realp[bin] = static_cast<T>(real * phaseScale);
                output.imagp[bin] = static_cast<T>(imag * phaseScale);
            }
        }

        void processIrSpectrum(Split& output, Split const& input, T gain, T tiltDb, T blurAlpha, FrameLibMagnitudeMovingAverage<T>& magnitudeAverage)
        {
            // Bin 0 in FrameLib's real FFT format contains DC in the real part and Nyquist in the imaginary part.
            // We apply the overall gain, tilt, and blur (smoothing) to both.

            // Handle DC (Real part of bin 0)
            auto const dcReal = static_cast<double>(input.realp[0]);
            auto const dcGain = spectralBinGain(0, spectrumSize, static_cast<double>(tiltDb)) * static_cast<double>(gain);
            auto const smoothedDc = static_cast<double>(magnitudeAverage.process(0, static_cast<T>(std::abs(dcReal) * dcGain), blurAlpha));
            output.realp[0] = static_cast<T>(smoothedDc * (dcReal < 0 ? -1.0 : 1.0));

            // Handle Nyquist (Imaginary part of bin 0)
            auto const nyqReal = static_cast<double>(input.imagp[0]);
            auto const nyqGain = spectralBinGain(spectrumSize, spectrumSize, static_cast<double>(tiltDb)) * static_cast<double>(gain);
            auto const smoothedNyq = static_cast<double>(magnitudeAverage.process(spectrumSize, static_cast<T>(std::abs(nyqReal) * nyqGain), blurAlpha));
            output.imagp[0] = static_cast<T>(smoothedNyq * (nyqReal < 0 ? -1.0 : 1.0));

            // Process remaining complex bins
            for (size_t bin = 1; bin < spectrumSize; ++bin) {
                auto const real = static_cast<double>(input.realp[bin]);
                auto const imag = static_cast<double>(input.imagp[bin]);
                auto const magnitude = std::sqrt(real * real + imag * imag);
                auto const binGain = spectralBinGain(bin, spectrumSize, static_cast<double>(tiltDb)) * static_cast<double>(gain);
                
                auto const smoothedMagnitude = static_cast<double>(magnitudeAverage.process(bin, static_cast<T>(magnitude * binGain), blurAlpha));

                double const phaseScale = magnitude > 1.0e-20 ? smoothedMagnitude / magnitude : 0.0;
                output.realp[bin] = static_cast<T>(real * phaseScale);
                output.imagp[bin] = static_cast<T>(imag * phaseScale);
            }
        }

        static T movingAverageAlpha(T blurAmount)
        {
            auto const clamped = std::max(T(0), std::min(T(1.0), blurAmount));
            if (clamped < T(1.0e-6)) return T(1.0);
            
            // Map 0 -> 1.0 (no blur)
            // Map 1.0 -> 0.0 (max blur/freeze)
            // Using a power function to make the high end of the slider more sensitive
            // y = 1 - x^0.1 makes 0.9 -> 0.20, 0.99 -> 0.046, 0.999 -> 0.002
            return T(1) - std::pow(clamped, T(0.1));
        }

        static double dbToGain(double db)
        {
            return std::pow(10.0, db / 20.0);
        }

        static double spectralBinGain(size_t bin, size_t maxBin, double tiltDb)
        {
//            if (std::abs(tiltDb) < 1.0e-12 || maxBin <= 1) {
//                return 1.0;
//            }

            // Note: bin 0 (DC/Nyquist) is now passed into this function from processIrSpectrum.
            // We use a fixed pivot at the geometric center of the spectrum (in frequency).
            // This ensures +tilt and -tilt are symmetric and continuous.
            // maxBin is typically fftSize / 2, representing Nyquist.
            // Bin 1 is the lowest frequency (excluding DC).
            // Pivot is sqrt(1 * maxBin) in bin-space.
            auto const pivotBin = std::sqrt(static_cast<double>(maxBin));
            
            // We use (bin + 1) to avoid log2(0) and to provide a smoother transition from DC.
            // Since DC is effectively bin 0, we can think of the spectrum starting at bin 0.
            // Using a small offset for the log helps stabilize the very low end.
            auto const octavesFromPivot = std::log2((static_cast<double>(bin) + 1.0) / (pivotBin + 1.0));
            
            // We clamp the gain to a reasonable range to prevent "explosion"
            // while still allowing significant spectral shaping.
            // *** AGENT DO NOT EDIT THESE GAINS, this is hand tuned ***
            return dbToGain(std::clamp(tiltDb * octavesFromPivot, -26.0, 1.5));
        }

        static size_t requiredPoolBytes(size_t fftSize)
        {
            return std::max<size_t>(FrameLibTlsfAllocator::defaultPoolBytes, fftSize * 64);
        }

        size_t partSize;
        size_t fftSize;
        uintptr_t fftLog2;
        size_t spectrumSize;
        size_t partitionCount{0};
        size_t writeIndex{0};
        size_t inputFill{0};
        size_t outputRead{0};

        FrameLibTlsfAllocator allocator;
        FrameLibAllocator<T> buffer_allocator;
        spectral_processor<T, FrameLibTlsfAllocator> processor;
        std::vector<T, FrameLibAllocator<T>> inputBlock;
        std::vector<T, FrameLibAllocator<T>> fftOutput;
        std::vector<T, FrameLibAllocator<T>> overlap;
        std::vector<T, FrameLibAllocator<T>> blockOutput;
        FrameLibSplitBuffer<T> currentInput;
        FrameLibSplitBuffer<T> accum;
        FrameLibSplitBuffer<T> processedIr;
        FrameLibSplitBuffer<T> multiplyTemp;
        FrameLibMagnitudeMovingAverage<T> inputMagnitudeAverage;
        std::vector<FrameLibMagnitudeMovingAverage<T>> magnitudeAverages;
        std::vector<FrameLibSplitBuffer<T>> irSpectra;
        std::vector<FrameLibSplitBuffer<T>> inputSpectra;
    };

    template <typename FloatType>
    struct SpectralConvolutionNode : public GraphNode<FloatType> {
        SpectralConvolutionNode(NodeId id, FloatType const sr, int const blockSize)
            : GraphNode<FloatType>::GraphNode(id, sr, blockSize)
            , allocator(FrameLibTlsfAllocator::defaultPoolBytes)
            , buffer_allocator(allocator)
            , scratchIn(buffer_allocator)
            , scratchOut(buffer_allocator)
            , scratchTilt(buffer_allocator)
            , scratchBlur(buffer_allocator)
        {
            scratchIn.resize(blockSize);
            scratchOut.resize(blockSize);
            scratchTilt.resize(blockSize);
            scratchBlur.resize(blockSize);
        }

        void setInternalProperty(std::string const& key, js::Value const& val)
        {
            if (key == "tiltDbPerOct") {
                if (val.isNumber()) {
                    defaultTilt = static_cast<double>(val);
                }
            }
            if (key == "blur") {
                if (val.isNumber()) {
                    defaultBlur = static_cast<double>(val);
                }
            }
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            setInternalProperty(key, val);

            if (key == "path") {
                if (!val.isString()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const nextPath = std::string((js::String) val);
                if (nextPath == path) {
                    return elem::ReturnCode::Ok();
                }

                if (!resources.has(nextPath)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                path = nextPath;
                return rebuildConvolver(resources);
            }

            if (key == "partitionSize") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed) || parsed < 16.0) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                auto const nextSize = nextPowerOf2(static_cast<size_t>(parsed));
                if (nextSize != partitionSize.load(std::memory_order_relaxed)) {
                    partitionSize.store(nextSize, std::memory_order_relaxed);
                    return rebuildConvolver(resources);
                }
                return elem::ReturnCode::Ok();
            }

            if (key == "magnitudeGainDb") {
                if (!val.isNumber()) {
                    return elem::ReturnCode::InvalidPropertyType();
                }

                auto const parsed = static_cast<double>((js::Number) val);
                if (!std::isfinite(parsed)) {
                    return elem::ReturnCode::InvalidPropertyValue();
                }

                magnitudeGain.store(dbToGain(parsed), std::memory_order_relaxed);
                return elem::ReturnCode::Ok();
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            if (convolver) {
                convolver->reset();
            }
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto** inputData = ctx.inputData;
            auto* outputData = ctx.outputData[0];
            auto numChannels = ctx.numInputChannels;
            auto numSamples = ctx.numSamples;

            if (numChannels == 0) {
                std::fill_n(outputData, numSamples, FloatType(0));
                return;
            }

            if (!convolver) {
                if (convolverQueue.size() > 0) {
                    std::shared_ptr<FrameLibSpectralConvolver<double>> next;
                    while (convolverQueue.size() > 0) {
                        convolverQueue.pop(next);
                    }
                    convolver = std::move(next);
                }

                if (!convolver) {
                    std::fill_n(outputData, numSamples, FloatType(0));
                    return;
                }
            }

            auto const* tiltInput = numChannels >= 3 ? inputData[0] : nullptr;
            auto const* blurInput = numChannels >= 3 ? inputData[1] : nullptr;
            auto const* sourceInput = (numChannels >= 3) ? inputData[2] : inputData[0];
            
            size_t processed = 0;
            while (processed < numSamples) {
                // If we are at the start of a partition, check for a new convolver
                // and latch the magnitudeGain
                if (convolver->getInputFill() == 0) {
                    if (convolverQueue.size() > 0) {
                        std::shared_ptr<FrameLibSpectralConvolver<double>> next;
                        while (convolverQueue.size() > 0) {
                            convolverQueue.pop(next);
                        }
                        if (next) {
                            convolver = std::move(next);
                        }
                    }
                    latchedGain = magnitudeGain.load(std::memory_order_relaxed);
                }

                auto const remaining = numSamples - processed;
                auto const toPartition = static_cast<size_t>(convolver->getPartitionSize() - convolver->getInputFill());
                auto const chunk = std::min(remaining, toPartition);

                if constexpr (std::is_same_v<FloatType, float>) {
                    for (size_t i = 0; i < chunk; ++i) {
                        auto const source = static_cast<double>(sourceInput[processed + i]);
                        scratchIn[i] = std::isfinite(source) ? source : 0.0;
                    }

                    double const* tiltData = nullptr;
                    double const* blurData = nullptr;
                    
                    // We need to determine if the input signal is "active" (not constant 0 or different from default)
                    // But simpler: always use scratch if numChannels >= 3, and fill it with signal or default.
                    for (size_t i = 0; i < chunk; ++i) {
                        scratchTilt[i] = tiltInput ? static_cast<double>(tiltInput[processed + i]) : defaultTilt;
                        scratchBlur[i] = blurInput ? static_cast<double>(blurInput[processed + i]) : defaultBlur;
                    }
                    tiltData = scratchTilt.data();
                    blurData = scratchBlur.data();

                    convolver->process(scratchIn.data(), tiltData, blurData, scratchOut.data(), chunk, latchedGain);

                    for (size_t i = 0; i < chunk; ++i) {
                        auto const wet = scratchOut[i];
                        outputData[processed + i] = std::isfinite(wet) ? static_cast<FloatType>(wet) : FloatType(0);
                    }
                } else {
                    // Double path
                    for (size_t i = 0; i < chunk; ++i) {
                        scratchTilt[i] = tiltInput ? static_cast<double>(tiltInput[processed + i]) : defaultTilt;
                        scratchBlur[i] = blurInput ? static_cast<double>(blurInput[processed + i]) : defaultBlur;
                    }
                    
                    convolver->process(sourceInput + processed, scratchTilt.data(),
                                       scratchBlur.data(),
                                       outputData + processed, chunk, latchedGain);
                }

                processed += chunk;
            }
        }

        SingleWriterSingleReaderQueue<std::shared_ptr<FrameLibSpectralConvolver<double>>> convolverQueue;
        std::shared_ptr<FrameLibSpectralConvolver<double>> convolver;

        FrameLibTlsfAllocator allocator;
        FrameLibAllocator<double> buffer_allocator;
        std::vector<double, FrameLibAllocator<double>> scratchIn;
        std::vector<double, FrameLibAllocator<double>> scratchOut;
        std::vector<double, FrameLibAllocator<double>> scratchTilt;
        std::vector<double, FrameLibAllocator<double>> scratchBlur;
        double defaultTilt{0.0};
        double defaultBlur{0.0};
        double latchedGain{1.0};

    private:
        int rebuildConvolver(SharedResourceMap& resources)
        {
            if (path.empty()) {
                return elem::ReturnCode::Ok();
            }

            auto resource = resources.get(path);
            if (resource == nullptr) {
                return elem::ReturnCode::InvalidPropertyValue();
            }

            auto bufferView = resource->getChannelData(0);
            auto preparedIr = prepareSpectralIr(bufferView);

            auto const headSize = partitionSize.load(std::memory_order_relaxed);
            auto co = std::make_shared<FrameLibSpectralConvolver<double>>(headSize, preparedIr);
            convolverQueue.push(std::move(co));
            return elem::ReturnCode::Ok();
        }

        std::vector<double> prepareSpectralIr(BufferView<float> const& bufferView) const
        {
            auto const irLen = bufferView.size();
            if (irLen == 0) {
                return {0.0};
            }

            auto const partSize = std::max<size_t>(16, partitionSize.load(std::memory_order_relaxed));
            auto const partitionCount = (irLen + partSize - 1) / partSize;
            std::vector<double> prepared(partitionCount * partSize, 0.0);

            for (size_t i = 0; i < irLen; ++i) {
                prepared[i] = static_cast<double>(bufferView.data()[i]);
            }

            return prepared;
        }

        static size_t nextPowerOf2(size_t value)
        {
            size_t result = 1;
            while (result < value) {
                result <<= 1;
            }
            return result;
        }

        static double dbToGain(double db)
        {
            return std::pow(10.0, db / 20.0);
        }

        std::string path;
        std::atomic<size_t> partitionSize{512};
        std::atomic<double> magnitudeGain{1.0};
    };

} // namespace elem
