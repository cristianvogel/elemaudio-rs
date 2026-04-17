#pragma once

#include <algorithm>
#include <cstddef>
#include <memory>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"
#include "../../vendor/elementary/runtime/elem/SharedResource.h"
#include "../../vendor/elementary/runtime/elem/SingleWriterSingleReaderQueue.h"

namespace elem
{
    // SampleCountNode — emits the length of a VFS-resident audio resource
    // as a constant-valued signal, optionally scaled into a natural domain.
    //
    // Shape mirrors `el::sr()`: zero children, one scalar output.
    //
    // Children: none
    // Props:
    //   path (string, required) — VFS key of the shared resource whose
    //                             per-channel frame count drives the output.
    //   unit (string, optional, default "samp") — domain of the emitted signal:
    //         "samp" : raw per-channel sample count (e.g. 48000 for a 1s
    //                  asset @ 48 kHz). The default; preserves the pure-length
    //                  contract for authors who want integer sample counts.
    //         "ms"   : duration in milliseconds. (len * 1000) / sr.
    //         "hz"   : fundamental period frequency. sr / len. Useful as a
    //                  `phasor` rate to clock the asset exactly once per
    //                  cycle; for a 2-second asset this is 0.5 Hz.
    //
    // Output:
    //   out[i] = scaled(length(resource[path]), unit)  for every i in the block
    //            0                                     if no resource attached
    //            0                                     if unit == "hz" and len == 0
    //
    // Scaling math (all performed once on the non-audio thread at setProperty
    // time; the audio loop is always a plain std::fill_n):
    //
    //   unit == samp :  cachedLength = static_cast<FloatType>(len)
    //   unit == ms   :  cachedLength = (len * 1000.0) / sr
    //   unit == hz   :  cachedLength = sr / len            (len > 0)
    //                   cachedLength = 0                   (len == 0)
    //
    // Property-order tolerance:
    //   setProperty is called once per prop in the order the JSON supplies
    //   them. We store both the current unit and the raw sample count from
    //   the most recent resource swap, then recompute `cachedLength` in
    //   either branch so any arrival order (`path` first, `unit` first, or
    //   mixed over time) produces the correct scaled value. The updated
    //   value is pushed across to the audio thread through the same SPSC
    //   queue the rest of the file uses — the `process()` loop does not
    //   observe partial/stale state.
    //
    // Missing-resource behavior:
    //   Matches `Sample` / `Table` exactly — if the resource named by
    //   `path` is not present in the SharedResourceMap at the time
    //   setProperty("path", …) is called, setProperty returns
    //   `InvalidPropertyValue` and the node's state is unchanged.
    //
    // Unknown unit string:
    //   `setProperty("unit", <unrecognized-string>)` returns
    //   `InvalidPropertyValue`. Recognized tokens are exactly "samp", "ms",
    //   and "hz" (case-sensitive).
    //
    // Runtime path or unit changes:
    //   Every successful setProperty that affects the cached value pushes
    //   a fresh FloatType through the SPSC queue. The audio thread drains
    //   the queue at the top of each process() call, so the new value is
    //   reflected on the next block after the setProperty lands.
    //
    // Realtime safety:
    //   - process() performs no allocation, no floating-point division,
    //     and no string comparisons. Just std::fill_n with the cached
    //     scalar.
    //   - The SPSC queue hands a single FloatType across threads; no
    //     std::string, no std::shared_ptr churn in the hot path. The
    //     SharedResourcePtr is still held on the node to keep the resource
    //     alive, but is accessed only on the message thread.

    template <typename FloatType>
    struct SampleCountNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;

        enum class Unit : int {
            Samp = 0,
            Ms   = 1,
            Hz   = 2,
        };

        SampleCountNode(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "path") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }
                if (!resources.has((js::String) val)) {
                    return ReturnCode::InvalidPropertyValue();
                }

                // Non-audio thread: remember the resource (to keep it alive)
                // and its raw sample count, then push the newly-scaled value
                // to the audio thread.
                activeResource = resources.get((js::String) val);
                rawSampleCount = activeResource ? activeResource->numSamples() : 0;
                pushScaledValue();
            } else if (key == "unit") {
                if (!val.isString()) {
                    return ReturnCode::InvalidPropertyType();
                }

                Unit parsed;
                if (!parseUnit((js::String) val, parsed)) {
                    return ReturnCode::InvalidPropertyValue();
                }
                currentUnit = parsed;
                pushScaledValue();
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override {}

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto* out = ctx.outputData[0];
            auto numSamples = ctx.numSamples;

            // Drain any pending value swap.
            while (valueQueue.size() > 0) {
                valueQueue.pop(cachedLength);
            }

            std::fill_n(out, numSamples, cachedLength);
        }

    private:
        // Compute the scaled value from the stored raw sample count and
        // current unit, then enqueue it for the audio thread. Called on the
        // non-audio thread whenever `path` or `unit` changes.
        void pushScaledValue()
        {
            FloatType scaled = FloatType(0);
            if (rawSampleCount > 0) {
                auto const sr = GraphNode<FloatType>::getSampleRate();
                switch (currentUnit) {
                    case Unit::Samp:
                        scaled = static_cast<FloatType>(rawSampleCount);
                        break;
                    case Unit::Ms:
                        scaled = static_cast<FloatType>(
                            (static_cast<double>(rawSampleCount) * 1000.0) / sr
                        );
                        break;
                    case Unit::Hz:
                        // rawSampleCount > 0 guaranteed by the guard above,
                        // so this divide cannot produce inf.
                        scaled = static_cast<FloatType>(
                            sr / static_cast<double>(rawSampleCount)
                        );
                        break;
                }
            }

            valueQueue.push(std::move(scaled));
        }

        // Exact-match recognition of the three accepted unit tokens. Returns
        // true on success and writes the parsed enum into `out`.
        static bool parseUnit(std::string const& s, Unit& out)
        {
            if (s == "samp") { out = Unit::Samp; return true; }
            if (s == "ms")   { out = Unit::Ms;   return true; }
            if (s == "hz")   { out = Unit::Hz;   return true; }
            return false;
        }

        // Non-audio-thread state. Never touched from process().
        SharedResourcePtr activeResource;
        size_t rawSampleCount = 0;
        Unit currentUnit = Unit::Samp;

        // Cross-thread handoff: the non-audio thread computes the scaled
        // FloatType and pushes it; the audio thread pops it at the top of
        // each process() call.
        SingleWriterSingleReaderQueue<FloatType> valueQueue;

        // Audio-thread state. Only touched inside process().
        FloatType cachedLength = FloatType(0);
    };

} // namespace elem
