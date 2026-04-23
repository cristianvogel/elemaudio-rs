// NOTE: This file is derived from the upstream Elementary vendor source but is
// OWNED by this repository. It must be updated whenever a custom node is added,
// renamed, or removed. Do not overwrite it during a vendor sync — merge instead.
//
// Custom node registry (keep in sync with src/ffi/elementary_bridge.cpp):
//   "freqshift"    — FreqShiftNode
//   "crunch"       — CrunchNode
//   "boxsum"       — BoxSumNode
//   "boxaverage"   — BoxAverageNode
//   "frameClock"   — FrameClockNode
//   "wrapAdd"      — WrapAddNode
//   "mirrorAdd"    — MirrorAddNode
//   "frameDelay"   — FrameDelayNode
//   "frameDerivative" — FrameDerivativeNode
//   "framePhasor"  — FramePhasorNode
//   "frameShaper"  — FrameShaperNode
//   "framePolySignal" — FramePolySignalNode
//   "frameSelect"  — FrameSelectNode
//   "frameBiDiSmooth" — FrameBiDiSmoothNode
//   "frameSmooth"  — FrameSmoothNode
//   "frameWriteRAM" — FrameWriteRAMNode
//   "frameRandomWalks" — FrameRandomWalksNode
//   "frameScope"   — FrameScopeNode
//   "frameValue"   — FrameValueNode
//   "limiter"      — LimiterNode
//   "variSlopeSvf" — VariSlopeSVFNode  (Butterworth, 12–72 dB/oct, no Q)
//   "stridedelay"  — StrideDelayNode
//   "vocoder"      — VocoderNode       (STFT channel vocoder, 4-in 2-out)
//   "ramp00"       — Ramp00Node        (sample-accurate one-shot 0→1 ramp)
//   "threshold"    — ThresholdNode     (sample-accurate threshold edge detector)
//   "extra.sample" — ExtraSampleNode   (always-multichannel sample playback)
//   "sampleCount"  — SampleCountNode   (VFS resource length as a constant signal)
//   "rain"         — RainNode          (random impulses with optional release)
//   "convolve"     — ConvolutionNode   (WASM-only)
//   "fft"          — FFTNode           (WASM-only)
//   "metro"        — MetronomeNode     (WASM-only)
//   "time"         — SampleTimeNode    (WASM-only)

#include <emscripten/bind.h>

#include <memory>
#include <elem/Runtime.h>

#include "Convolve.h"
#include "FFT.h"
#include "../../../../native/extra/boxsum.h"
#include "../../../../native/extra/frame_clock.h"
#include "../../../../native/extra/frame_derivative.h"
#include "../../../../native/extra/mirror_add.h"
#include "../../../../native/extra/frame_delay.h"
#include "../../../../native/extra/frame_phasor.h"
#include "../../../../native/extra/frame_shaper.h"
#include "../../../../native/extra/frame_poly_signal.h"
#include "../../../../native/extra/frame_select.h"
#include "../../../../native/extra/frame_bidi_smooth.h"
#include "../../../../native/extra/frame_smooth.h"
#include "../../../../native/extra/frame_write_ram.h"
#include "../../../../native/extra/frame_random_walks.h"
#include "../../../../native/extra/wrap_add.h"
#include "../../../../native/extra/frame_scope.h"
#include "../../../../native/extra/frame_value.h"
#include "../../../../native/extra/freqshift.h"
#include "../../../../native/extra/crunch.h"
#include "../../../../native/extra/limiter.h"
#include "../../../../native/extra/vari_slope_svf.h"
#include "../../../../native/extra/stridedelay.h"
#include "../../../../native/extra/vocoder.h"
#include "../../../../native/extra/ramp00.h"
#include "../../../../native/extra/threshold.h"
#include "../../../../native/extra/sample.h"
#include "../../../../native/extra/preset_write.h"
#include "../../../../native/extra/preset_read.h"
#include "../../../../native/extra/preset_morph.h"
#include "../../../../native/extra/sample_count.h"
#include "../../../../native/extra/rain.h"
#include "../../../../native/extra/sample_count.h"
#include "Metro.h"
#include "SampleTime.h"


using namespace emscripten;

//==============================================================================
/** The main processor for the WASM DSP. */
class ElementaryAudioProcessor
{
public:
    //==============================================================================
    ElementaryAudioProcessor(int numIns, int numOuts)
    {
        numInputChannels = static_cast<size_t>(numIns);
        numOutputChannels = static_cast<size_t>(numOuts);
    }

    ~ElementaryAudioProcessor() = default;

    //==============================================================================
    /** Called before processing starts. */
    void prepare (double sr, unsigned int maxBlockSize)
    {
        sampleRate = sr;

        scratchBuffers.clear();
        scratchPointers.clear();

        for (int i = 0; i < (numInputChannels + numOutputChannels); ++i)
            scratchBuffers.push_back(std::vector<double>(maxBlockSize));

        for (int i = 0; i < (numInputChannels + numOutputChannels); ++i)
            scratchPointers.push_back(scratchBuffers[i].data());

        // Configure the runtime
        runtime = std::make_unique<elem::Runtime<double>>(sampleRate, maxBlockSize);

        // Register extension nodes
        runtime->registerNodeType("convolve", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::ConvolutionNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("freqshift", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FreqShiftNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("crunch", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::CrunchNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("boxsum", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::BoxSumNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("boxaverage", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::BoxAverageNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameClock", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameClockNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("wrapAdd", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::WrapAddNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("mirrorAdd", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::MirrorAddNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameDelay", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameDelayNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameDerivative", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameDerivativeNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameScope", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameScopeNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("framePhasor", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FramePhasorNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameShaper", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameShaperNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("framePolySignal", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FramePolySignalNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameSelect", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameSelectNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameBiDiSmooth", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameBiDiSmoothNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameSmooth", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameSmoothNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameWriteRAM", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameWriteRAMNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameRandomWalks", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameRandomWalksNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("frameValue", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FrameValueNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("limiter", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::LimiterNode<double>>(id, fs, bs);
        });

        // VariSlopeSVFNode: Rossum-style continuously morphable Butterworth slope SVF (12–72 dB/oct).
        // Inputs: [0] cutoff_hz, [1] audio, [2] slope (1.0–6.0). Q fixed at Butterworth.
        // Property: filterType ("lowpass"/"lp" or "highpass"/"hp").
        runtime->registerNodeType("variSlopeSvf", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::VariSlopeSVFNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("stridedelay", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::StrideDelayNode<double>>(id, fs, bs);
        });

        // VocoderNode: STFT channel vocoder. 4 inputs, 2 outputs.
        runtime->registerNodeType("vocoder", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::VocoderNode<double>>(id, fs, bs);
        });

        // Ramp00Node: sample-accurate one-shot 0→1 ramp that drops to 0 on peak.
        // Inputs: [0] dur in samples, [1] trigger.
        // Property: blocking (bool, default true).
        runtime->registerNodeType("ramp00", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::Ramp00Node<double>>(id, fs, bs);
        });

        runtime->registerNodeType("threshold", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::ThresholdNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("extra.sample", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::ExtraSampleNode<double>>(id, fs, bs);
        });

        // PresetWrite / PresetRead / PresetMorph: multi-slot preset RAM bank.
        runtime->registerNodeType("presetWrite", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::PresetWriteNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("presetRead", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::PresetReadNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("presetMorph", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::PresetMorphNode<double>>(id, fs, bs);
        });

        // SampleCountNode: emits the length (in samples) of a VFS-resident
        // audio resource as a constant-valued signal. Zero children.
        // Property: path (string, required) — VFS key of the resource.
        runtime->registerNodeType("sampleCount", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::SampleCountNode<double>>(id, fs, bs);
        });

        // RainNode: sparse impulses with a pinged, vactrol-like trail.
        // Inputs: [0] density (impulses/sec), [1] release (seconds, signal).
        // Properties: seed, jitter.
        runtime->registerNodeType("rain", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::RainNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("fft", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::FFTNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("metro", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::MetronomeNode<double>>(id, fs, bs);
        });

        runtime->registerNodeType("time", [](elem::NodeId const id, double fs, int const bs) {
            return std::make_shared<elem::SampleTimeNode<double>>(id, fs, bs);
        });
    }

    //==============================================================================
    /** Returns a Float32Array view into the internal work buffer data. */
    val getInputBufferData (int index)
    {
        auto len = scratchBuffers[index].size();
        auto* data = scratchBuffers[index].data();

        return val(typed_memory_view(len, data));
    }

    /** Returns a Float32Array view into the internal work buffer data. */
    val getOutputBufferData (int index)
    {
        auto len = scratchBuffers[numInputChannels + index].size();
        auto* data = scratchBuffers[numInputChannels + index].data();

        return val(typed_memory_view(len, data));
    }

    //==============================================================================
    /** Message batch handling. */
    val postMessageBatch (val payload)
    {
        auto v = emValToValue(payload);

        if (!v.isArray()) {
            return valueToEmVal(elem::js::Object {
                {"success", false},
                {"message", "Malformed message batch"},
            });
        }

        auto const& batch = v.getArray();
        auto const rc = runtime->applyInstructions(batch);

        return valueToEmVal(elem::js::Object {
            {"success", rc == elem::ReturnCode::Ok()},
            {"message", elem::ReturnCode::describe(rc)},
        });
    }

    void reset()
    {
        runtime->reset();
    }

    val gc()
    {
        auto pruned = runtime->gc();
        auto ret = elem::js::Array();

        for (auto& n : pruned) {
            ret.push_back(elem::js::Value((double) n));
        }

        return valueToEmVal(ret);
    }

    val addSharedResource(val name, val buffer)
    {
        auto n = emValToValue(name);
        auto buf = emValToValue(buffer);

        if (!n.isString()) {
            return valueToEmVal(elem::js::Object {
                {"success", false},
                {"message", "name must be a string type"},
            });
        }

        if (!buf.isFloat32Array() && !buf.isArray()) {
            return valueToEmVal(elem::js::Object {
                {"success", false},
                {"message", "buffer must be an Array<Float32Array> or a Float32Array"},
            });
        }

        if (buf.isArray()) {
            auto& channels = buf.getArray();
            std::vector<std::vector<float>> channelData;
            std::vector<float*> channelPointers;

            for (size_t i = 0; i < channels.size(); ++i) {
                if (!channels[i].isFloat32Array()) {
                    return valueToEmVal(elem::js::Object {
                        {"success", false},
                        {"message", "buffer must be an Array<Float32Array> or a Float32Array"},
                    });
                }

                channelData.push_back(channels[i].getFloat32Array());
                channelPointers.push_back(channelData[i].data());
            }

            auto resource = std::make_unique<elem::AudioBufferResource>(channelPointers.data(), channelPointers.size(), channelData[0].size());
            auto result = runtime->addSharedResource((elem::js::String) n, std::move(resource));

            return valueToEmVal(elem::js::Object {
                {"success", result},
                {"message", result ? "Ok" : "cannot overwrite existing shared resource"},
            });
        }

        auto& f32vec = buf.getFloat32Array();
        auto result = runtime->addSharedResource((elem::js::String) n, std::make_unique<elem::AudioBufferResource>(f32vec.data(), f32vec.size()));

        return valueToEmVal(elem::js::Object {
            {"success", result},
            {"message", result ? "Ok" : "cannot overwrite existing shared resource"},
        });
    }

    void pruneSharedResources()
    {
        runtime->pruneSharedResources();
    }

    val listSharedResources()
    {
        auto ret = val::array();
        size_t i = 0;

        for (auto& k : runtime->getSharedResourceMapKeys()) {
            ret.set(i++, val(k));
        }

        return ret;
    }

    /** Audio block processing. */
    void process (int const numSamples)
    {
        for (size_t i = numInputChannels; i < numOutputChannels; ++i) {
            if (i < scratchBuffers.size()) {
                auto& vec = scratchBuffers[i];
                std::fill(vec.begin(), vec.end(), 0.0);
            }
        }

        // We just operate on our scratch data. Expect the JavaScript caller to hit
        // our getInputBufferData and getOutputBufferData to prepare and extract the actual
        // data for this processor
        runtime->process(
            const_cast<const double**>(scratchPointers.data()),
            numInputChannels,
            scratchPointers.data() + numInputChannels,
            numOutputChannels,
            numSamples,
            static_cast<void*>(&sampleTime)
        );

        sampleTime += static_cast<int64_t>(numSamples);
    }

    /** Callback events. */
    void processQueuedEvents(val callback)
    {
        elem::js::Array batch;

        runtime->processQueuedEvents([this, &batch](std::string const& type, elem::js::Value evt) {
            batch.push_back(elem::js::Object({
                {"type", type},
                {"event", evt}
            }));
        });

        callback(valueToEmVal(batch));
    }

    void setCurrentTime(int const timeInSamples)
    {
        sampleTime = timeInSamples;
    }

    void setCurrentTimeMs(double const timeInMs)
    {
        double const timeInSeconds = timeInMs / 1000.0;
        sampleTime = static_cast<int64_t>(timeInSeconds * sampleRate);
    }

private:
    //==============================================================================
    elem::js::Value emValToValue (val const& v)
    {
        if (v.isUndefined())
            return elem::js::Undefined();
        if (v.isNull())
            return elem::js::Null();
        if (v.isTrue())
            return elem::js::Value(true);
        if (v.isFalse())
            return elem::js::Value(false);
        if (v.isNumber())
            return elem::js::Value(v.as<double>());
        if (v.isString())
            return elem::js::Value(v.as<std::string>());
        if (v.instanceof(val::global("Float32Array"))) {
            // This conversion function is part of the emscripten namespace for
            // mapping from emscripten::val to a simple std::vector.
            return elem::js::Value(convertJSArrayToNumberVector<float>(v));
        }

        if (v.isArray())
        {
            auto const length = v["length"].as<int>();
            elem::js::Array ret;

            for (int i = 0; i < length; ++i)
            {
                ret.push_back(emValToValue(v[i]));
            }

            return ret;
        }

        // We don't support functions yet...
        if (v.instanceof(val::global("Function"))) {
            return elem::js::Undefined();
        }

        // This case must come at the end, because Arrays, Functions, Float32Arrays,
        // etc are all Objects too
        if (v.instanceof(val::global("Object"))) {
            auto const keys = val::global("Object").call<val>("keys", v);
            auto const numKeys = keys["length"].as<size_t>();

            elem::js::Object ret;

            for (size_t i = 0; i < numKeys; ++i) {
                ret.insert({keys[i].as<std::string>(), emValToValue(v[keys[i]])});
            }

            return ret;
        }

        return elem::js::Undefined();
    }

    val valueToEmVal (elem::js::Value const& v)
    {
        if (v.isUndefined())
            return val::undefined();
        if (v.isNull())
            return val::null();
        if (v.isBool())
            return val((bool) v);
        if (v.isNumber())
            return val((elem::js::Number) v);
        if (v.isString())
            return val((elem::js::String) v);

        if (v.isArray())
        {
            auto& va = v.getArray();
            auto ret = val::array();

            for (size_t i = 0; i < va.size(); ++i)
            {
                ret.set(i, valueToEmVal(va[i]));
            }

            return ret;
        }

        if (v.isFloat32Array())
        {
            auto& va = v.getFloat32Array();

            auto opts = val::object();
            opts.set("length", va.size());

            auto ret = val::global("Float32Array").call<val>("from", opts);

            for (size_t i = 0; i < va.size(); ++i)
            {
                ret.set(i, val(va[i]));
            }

            return ret;
        }

        if (v.isObject())
        {
            auto& vo = v.getObject();
            auto ret = val::object();

            for (auto const& [key, x] : vo)
            {
                ret.set(key, valueToEmVal(x));
            }

            return ret;
        }

        // Function types not supported!
        return val::undefined();
    }

    //==============================================================================
    std::unique_ptr<elem::Runtime<double>> runtime;
    std::vector<std::vector<double>> scratchBuffers;
    std::vector<double*> scratchPointers;

    int64_t sampleTime = 0;
    double sampleRate = 0;

    size_t numInputChannels = 0;
    size_t numOutputChannels = 2;
};

EMSCRIPTEN_BINDINGS(Elementary) {
    class_<ElementaryAudioProcessor>("ElementaryAudioProcessor")
        .constructor<int, int>()
        .function("prepare", &ElementaryAudioProcessor::prepare)
        .function("getInputBufferData", &ElementaryAudioProcessor::getInputBufferData)
        .function("getOutputBufferData", &ElementaryAudioProcessor::getOutputBufferData)
        .function("postMessageBatch", &ElementaryAudioProcessor::postMessageBatch)
        .function("reset", &ElementaryAudioProcessor::reset)
        .function("gc", &ElementaryAudioProcessor::gc)
        .function("addSharedResource", &ElementaryAudioProcessor::addSharedResource)
        .function("pruneSharedResources", &ElementaryAudioProcessor::pruneSharedResources)
        .function("listSharedResources", &ElementaryAudioProcessor::listSharedResources)
        .function("process", &ElementaryAudioProcessor::process)
        .function("processQueuedEvents", &ElementaryAudioProcessor::processQueuedEvents)
        .function("setCurrentTime", &ElementaryAudioProcessor::setCurrentTime)
        .function("setCurrentTimeMs", &ElementaryAudioProcessor::setCurrentTimeMs);
};
