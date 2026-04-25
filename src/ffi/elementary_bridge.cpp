#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <elem/JSON.h>
#include <elem/Runtime.h>

#include <extra/crunch.h>
#include <extra/boxsum.h>
#include <extra/convolve.h>
#include <extra/convolve_spectral.h>
#include <extra/frame_clock.h>
#include <extra/frame_derivative.h>
#include <extra/mirror_add.h>
#include <extra/frame_delay.h>
#include <extra/frame_phasor.h>
#include <extra/frame_shaper.h>
#include <extra/frame_poly_signal.h>
#include <extra/frame_select.h>
#include <extra/frame_bidi_smooth.h>
#include <extra/frame_smooth.h>
#include <extra/frame_write_ram.h>
#include <extra/frame_random_walks.h>
#include <extra/wrap_add.h>
#include <extra/frame_scope.h>
#include <extra/frame_value.h>
#include <extra/freqshift.h>
#include <extra/limiter.h>
// VariSlopeSVFNode: Rossum-style continuously morphable Butterworth slope SVF (12–72 dB/oct).
// Inputs: [0] cutoff_hz, [1] audio, [2] slope (1.0–6.0). Q fixed at Butterworth.
#include <extra/vari_slope_svf.h>
#include <extra/stridedelay.h>
#include <extra/sample_time.h>
// VocoderNode: STFT-based channel vocoder (port of Geraint Luff's JSFX).
// Inputs: [0] carrier L, [1] carrier R, [2] modulator L, [3] modulator R.
// Properties: windowMs, smoothingMs, maxGainDb, swapInputs.
#include <extra/vocoder.h>
// Ramp00Node: sample-accurate one-shot 0→1 ramp that drops to 0 on peak.
// Inputs: [0] dur (samples), [1] trigger (rising-edge gate).
// Property: blocking (bool, default true).
#include <extra/ramp00.h>
#include <extra/threshold.h>
#include <extra/sample.h>
// PresetWrite / PresetRead / PresetMorph: multi-slot preset RAM bank primitives.
#include <extra/preset_write.h>
#include <extra/preset_read.h>
#include <extra/preset_morph.h>
// SampleCountNode: emits the exact length (in samples) of a VFS-resident
// audio resource as a constant-valued signal. Zero children.
// Property: path (string, required) — VFS key of the resource.
#include <extra/sample_count.h>
// RainNode: sparse impulses with a vactrol-like pinged decay.
// Inputs: [0] density (impulses/sec), [1] release (seconds, signal).
// Properties: seed (number, optional), jitter (0..1).
#include <extra/rain.h>

extern "C" {

struct elementary_runtime_handle {
    std::unique_ptr<elem::Runtime<double>> runtime;
    double sample_rate;
    std::int64_t sample_time;
};

using elementary_gc_callback = void (*)(std::int32_t node_id, void* user_data);

elementary_runtime_handle* elementary_runtime_new(double sample_rate, int block_size)
{
    try {
        auto handle = std::make_unique<elementary_runtime_handle>();
        handle->runtime = std::make_unique<elem::Runtime<double>>(sample_rate, block_size);
        handle->sample_rate = sample_rate;
        handle->sample_time = 0;

        handle->runtime->registerNodeType("freqshift", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FreqShiftNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("extra.convolve", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::ExtraConvolutionNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("extra.convolveSpectral", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::SpectralConvolutionNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("crunch", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::CrunchNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("boxsum", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::BoxSumNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("boxaverage", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::BoxAverageNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameclock", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameClockNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("wrapAdd", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::WrapAddNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("mirrorAdd", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::MirrorAddNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameDelay", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameDelayNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameDerivative", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameDerivativeNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameScope", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameScopeNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("framePhasor", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FramePhasorNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameShaper", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameShaperNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("framePolySignal", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FramePolySignalNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameSelect", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameSelectNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameBiDiSmooth", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameBiDiSmoothNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameSmooth", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameSmoothNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameWriteRAM", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameWriteRAMNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameRandomWalks", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameRandomWalksNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("frameValue", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameValueNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("limiter", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::LimiterNode<double>>(id, fs, bs);
        });

        // "variSlopeSvf" — VariSlopeSVFNode.
        // Inputs: [0] cutoff_hz, [1] audio, [2] slope (1.0–6.0).
        // Property: filterType ("lowpass"/"lp" or "highpass"/"hp").
        // Q fixed at Butterworth. 1–6 cascaded stages (12–72 dB/oct).
        handle->runtime->registerNodeType("variSlopeSvf", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::VariSlopeSVFNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("stridedelay", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::StrideDelayNode<double>>(id, fs, bs);
        });

        // "vocoder" — VocoderNode.
        // STFT channel vocoder. 4 inputs (carrier L/R, modulator L/R), 2 outputs.
        handle->runtime->registerNodeType("vocoder", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::VocoderNode<double>>(id, fs, bs);
        });

        // "ramp00" — Ramp00Node.
        // Sample-accurate one-shot 0→1 ramp that drops to 0 immediately on peak.
        // Inputs: [0] dur in samples, [1] trigger.
        // Property: blocking (bool, default true) — block retriggers while running.
        handle->runtime->registerNodeType("ramp00", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::Ramp00Node<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("threshold", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::ThresholdNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("extra.sample", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::ExtraSampleNode<double>>(id, fs, bs);
        });

        // "presetWrite" / "presetRead" / "presetMorph" — multi-slot preset RAM bank.
        // Props: path (string, required), framelength (positive int), slots (positive int).
        handle->runtime->registerNodeType("presetWrite", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::PresetWriteNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("presetRead", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::PresetReadNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("presetMorph", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::PresetMorphNode<double>>(id, fs, bs);
        });

        // "sampleCount" — SampleCountNode.
        // Constant-signal node whose value is the length (in samples, per channel)
        // of the VFS resource named by the `path` prop. Zero children.
        handle->runtime->registerNodeType("sampleCount", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::SampleCountNode<double>>(id, fs, bs);
        });

        // "rain" — RainNode.
        // Sparse random impulses with optional overlapping decaying releases.
        // Inputs: [0] density (impulses/sec), [1] release (seconds, signal).
        // Properties: seed, jitter.
        handle->runtime->registerNodeType("rain", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::RainNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("time", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::SampleTimeNode<double>>(id, fs, bs);
        });

        return handle.release();
    } catch (...) {
        return nullptr;
    }
}

void elementary_runtime_free(elementary_runtime_handle* handle)
{
    delete handle;
}

int elementary_runtime_apply_instructions(elementary_runtime_handle* handle, char const* json)
{
    if (handle == nullptr || json == nullptr) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }

    try {
        auto batch_value = elem::js::parseJSON(std::string(json));

        if (!batch_value.isArray()) {
            return elem::ReturnCode::InvalidInstructionFormat();
        }

        return handle->runtime->applyInstructions(batch_value.getArray());
    } catch (...) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }
}

void elementary_runtime_reset(elementary_runtime_handle* handle)
{
    if (handle != nullptr) {
        handle->runtime->reset();
    }
}

void elementary_runtime_prune_shared_resources(elementary_runtime_handle* handle)
{
    if (handle != nullptr) {
        handle->runtime->pruneSharedResources();
    }
}

void elementary_runtime_set_current_time_samples(elementary_runtime_handle* handle, std::int64_t sample_time)
{
    if (handle != nullptr) {
        handle->sample_time = sample_time;
    }
}

void elementary_runtime_set_current_time_ms(elementary_runtime_handle* handle, double sample_time_ms)
{
    if (handle != nullptr) {
        handle->sample_time = static_cast<std::int64_t>((sample_time_ms / 1000.0) * handle->sample_rate);
    }
}

// VFS / shared-resource FFI. Always compiled — these are thin wrappers over
// the runtime's built-in `SharedResourceMap` and have no dependency on the
// optional `elemaudio-resources` feature. Any extra that consumes a VFS
// asset (`el.sample`, `el.table`, `el.extra.sampleCount`, …) needs these
// entry points to be linkable regardless of which cargo features are on.
int elementary_runtime_add_shared_resource_f32(
    elementary_runtime_handle* handle,
    char const* name,
    float const* data,
    std::size_t num_samples)
{
    if (handle == nullptr || name == nullptr || (data == nullptr && num_samples != 0)) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }

    try {
        auto resource = std::make_unique<elem::AudioBufferResource>(const_cast<float*>(data), num_samples);
        return handle->runtime->addSharedResource(std::string(name), std::move(resource))
            ? elem::ReturnCode::Ok()
            : elem::ReturnCode::InvariantViolation();
    } catch (...) {
        return elem::ReturnCode::InvariantViolation();
    }
}

int elementary_runtime_replace_shared_resource_f32(
    elementary_runtime_handle* handle,
    char const* name,
    float const* data,
    std::size_t num_samples)
{
    if (handle == nullptr || name == nullptr || (data == nullptr && num_samples != 0)) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }

    try {
        auto resource = std::make_unique<elem::AudioBufferResource>(const_cast<float*>(data), num_samples);
        return handle->runtime->replaceSharedResource(std::string(name), std::move(resource))
            ? elem::ReturnCode::Ok()
            : elem::ReturnCode::InvariantViolation();
    } catch (...) {
        return elem::ReturnCode::InvariantViolation();
    }
}

int elementary_runtime_add_shared_resource_f32_multi(
    elementary_runtime_handle* handle,
    char const* name,
    float const* const* data,
    std::size_t num_channels,
    std::size_t num_samples)
{
    if (handle == nullptr || name == nullptr || (data == nullptr && num_channels != 0)) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }

    try {
        auto resource = std::make_unique<elem::AudioBufferResource>(const_cast<float**>(data), num_channels, num_samples);
        return handle->runtime->addSharedResource(std::string(name), std::move(resource))
            ? elem::ReturnCode::Ok()
            : elem::ReturnCode::InvariantViolation();
    } catch (...) {
        return elem::ReturnCode::InvariantViolation();
    }
}

int elementary_runtime_replace_shared_resource_f32_multi(
    elementary_runtime_handle* handle,
    char const* name,
    float const* const* data,
    std::size_t num_channels,
    std::size_t num_samples)
{
    if (handle == nullptr || name == nullptr || (data == nullptr && num_channels != 0)) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }

    try {
        auto resource = std::make_unique<elem::AudioBufferResource>(const_cast<float**>(data), num_channels, num_samples);
        return handle->runtime->replaceSharedResource(std::string(name), std::move(resource))
            ? elem::ReturnCode::Ok()
            : elem::ReturnCode::InvariantViolation();
    } catch (...) {
        return elem::ReturnCode::InvariantViolation();
    }
}

int elementary_runtime_process(
    elementary_runtime_handle* handle,
    double const** input_channel_data,
    std::size_t num_input_channels,
    double** output_channel_data,
    std::size_t num_output_channels,
    std::size_t num_samples)
{
    if (handle == nullptr) {
        return elem::ReturnCode::InvalidInstructionFormat();
    }

    try {
        handle->runtime->process(
            input_channel_data,
            num_input_channels,
            output_channel_data,
            num_output_channels,
            num_samples,
            static_cast<void*>(&handle->sample_time)
        );

        handle->sample_time += static_cast<std::int64_t>(num_samples);
        return elem::ReturnCode::Ok();
    } catch (...) {
        return elem::ReturnCode::InvariantViolation();
    }
}

char* elementary_runtime_process_queued_events_json(elementary_runtime_handle* handle)
{
    if (handle == nullptr) {
        return nullptr;
    }

    try {
        elem::js::Array batch;
        handle->runtime->processQueuedEvents([&batch](std::string const& type, elem::js::Value evt) {
            batch.push_back(elem::js::Object({
                {"type", type},
                {"event", evt},
            }));
        });

        auto const json = elem::js::serialize(elem::js::Value(batch));
        auto* out = static_cast<char*>(std::malloc(json.size() + 1));
        if (out == nullptr) {
            return nullptr;
        }

        std::memcpy(out, json.c_str(), json.size() + 1);
        return out;
    } catch (...) {
        return nullptr;
    }
}

void elementary_string_free(char* ptr)
{
    std::free(ptr);
}

void elementary_runtime_gc(elementary_runtime_handle* handle, elementary_gc_callback callback, void* user_data)
{
    if (handle == nullptr || callback == nullptr) {
        return;
    }

    auto pruned = handle->runtime->gc();

    for (auto const node_id : pruned) {
        callback(node_id, user_data);
    }
}

}
