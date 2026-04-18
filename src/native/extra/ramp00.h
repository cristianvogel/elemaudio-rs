#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <string>

#include "../../vendor/elementary/runtime/elem/GraphNode.h"

namespace elem
{
    // Ramp00Node — sample-accurate one-shot 0→1 ramp.
    //
    //   ▲ 1 ┈┈┈┈┈┈┈┈┈┈┈┈┈
    //       ╱|
    //      ╱ |
    //     ╱  |
    //    ╱   |
    //   ╱    |
    //  0─────▼───────────▶
    //   trig       reaches 1, drops to 0 on the same sample
    //
    // Children layout:
    //   [0] dur — duration in SAMPLES (signal; may vary continuously)
    //   [1] x   — trigger signal (rising edge when crossing 0.5 upward)
    //
    // Props:
    //   blocking (bool, default true)
    //     When true, further triggers are ignored while the ramp is running
    //     (i.e. until the value returns to exactly 0). When false, any rising
    //     edge on x restarts the ramp from 0.
    //
    // Behavior:
    //   - Output starts at 0. On a rising edge of x, the ramp begins.
    //   - At each sample the output increments by 1 / dur (dur read per-sample).
    //   - When the running value reaches or exceeds 1, the node emits exactly
    //     one sample at 1.0 and then immediately drops to 0 on the next sample
    //     (hence the "00" suffix: starts at 0, ends at 0). The exact peak
    //     sample is not skipped.
    //   - If dur <= 0 at the moment of a would-be trigger, the trigger is
    //     ignored and the output stays at 0. If dur becomes <= 0 while the
    //     ramp is running, the ramp is aborted and the output snaps to 0.
    //   - `dur` can change continuously while the ramp is running; the current
    //     value is preserved and only the per-sample increment is recomputed.
    //
    // Trigger detection:
    //   A rising edge is defined as the previous sample of x being <= 0.5 and
    //   the current sample being > 0.5. Matches the gate convention used by
    //   el::train output and other Elementary gate-consuming nodes.
    //
    // Realtime:
    //   - No heap allocation in process().
    //   - Only atomic_relaxed loads for props.
    //   - No locks. No I/O. No branches on floating-point exceptions.

    template <typename FloatType>
    struct Ramp00Node : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;
        using Sample = FloatType;

        static constexpr size_t CHILD_DUR = 0;
        static constexpr size_t CHILD_TRIG = 1;
        static constexpr size_t NUM_CHILDREN = 2;

        Ramp00Node(NodeId id, double sr, int blockSize)
            : GraphNode<FloatType>(id, sr, blockSize)
        {}

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap&) override
        {
            if (key == "blocking") {
                if (!val.isBool()) return ReturnCode::InvalidPropertyType();
                blockingTarget.store(static_cast<bool>((js::Boolean) val), std::memory_order_relaxed);
            }

            return GraphNode<FloatType>::setProperty(key, val);
        }

        void reset() override
        {
            value = Sample(0);
            running = false;
            prevTrig = Sample(0);
        }

        void process(BlockContext<FloatType> const& ctx) override
        {
            auto numIns = ctx.numInputChannels;
            auto numOuts = ctx.numOutputChannels;
            auto numSamples = ctx.numSamples;

            // Need both children. If not, emit silence on all outputs.
            if (numIns < NUM_CHILDREN || numOuts == 0 || numSamples == 0) {
                for (size_t c = 0; c < numOuts; ++c) {
                    std::fill_n(ctx.outputData[c], numSamples, Sample(0));
                }
                return;
            }

            auto const* durSignal  = ctx.inputData[CHILD_DUR];
            auto const* trigSignal = ctx.inputData[CHILD_TRIG];
            auto* out = ctx.outputData[0];

            bool const blocking = blockingTarget.load(std::memory_order_relaxed);

            for (size_t i = 0; i < numSamples; ++i) {
                Sample dur = durSignal[i];
                Sample trig = trigSignal[i];

                // Rising-edge detection on trig using the 0.5 threshold gate
                // convention. This matches el::train / le(phasor,0.5) output.
                bool risingEdge = (trig > Sample(0.5)) && (prevTrig <= Sample(0.5));
                prevTrig = trig;

                // Accept trigger? Only if (dur > 0) AND
                //   - blocking disabled, OR
                //   - not currently running (i.e. value == 0).
                if (risingEdge && dur > Sample(0)) {
                    bool accept = blocking ? (!running) : true;
                    if (accept) {
                        value = Sample(0);
                        running = true;
                    }
                }

                // If dur goes non-positive mid-ramp, abort cleanly.
                if (running && dur <= Sample(0)) {
                    value = Sample(0);
                    running = false;
                }

                if (running) {
                    // Emit the current value, then advance.
                    out[i] = value;

                    // If we just emitted the peak, drop to 0 next sample.
                    if (value >= Sample(1)) {
                        value = Sample(0);
                        running = false;
                    } else {
                        value += Sample(1) / dur;
                        if (value > Sample(1)) {
                            value = Sample(1);
                        }
                    }
                } else {
                    out[i] = Sample(0);
                }
            }

            // Secondary output channels (if the graph asked for more) get zero.
            for (size_t c = 1; c < numOuts; ++c) {
                std::fill_n(ctx.outputData[c], numSamples, Sample(0));
            }
        }

    private:
        std::atomic<bool> blockingTarget{true};

        // Per-instance audio-thread state. Only touched in process()/reset().
        Sample value    = Sample(0);
        bool   running  = false;
        Sample prevTrig = Sample(0);
    };

} // namespace elem
