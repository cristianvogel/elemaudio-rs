#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <elem/JSON.h>
#include <elem/Runtime.h>

#include <extra/crunch.h>
#include <extra/boxsum.h>
#include <extra/freqshift.h>
#include <extra/limiter.h>
#include <extra/stridedelay.h>

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

        handle->runtime->registerNodeType("crunch", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::CrunchNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("boxsum", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::BoxSumNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("boxaverage", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::BoxAverageNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("limiter", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::LimiterNode<double>>(id, fs, bs);
        });

        handle->runtime->registerNodeType("stridedelay", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::StrideDelayNode<double>>(id, fs, bs);
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

#if defined(ELEM_RS_ENABLE_RESOURCES)
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
#endif

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
