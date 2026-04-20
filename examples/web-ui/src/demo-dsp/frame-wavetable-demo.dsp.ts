import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const RAM_PATH = "wf/ram/frame-wavetable";
export const FRAME_SCOPE_EVENT = "frame-wavetable:scope";

export interface FrameWavetableDemoParams {
    modulate: number;
    smooth: number;
    smoothShape: number;
    smoothMode: number;
    shift: number;
    tilt: number;
    zoom: number;
    scale: number;
    wave: number;
    frequency: number;
    level: number;
    isStopped?: boolean;
}

export function buildGraph(p: FrameWavetableDemoParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({value: 0}), el.const({value: 0})];
    }

    const beat = el.train(0.5);
    const modGain = el.const({key: "fwt:modGain", value: p.modulate});
    const scaleNode = el.const({key: "fwt:scale", value: p.scale});

    const statelessOscillator = el.extra.frameShaper(
        // de-synchronise frame length for creative phasing patterns!
        {key: "fwt:shaper", framelength: FRAME_LENGTH},
        el.const({key: "fwt:offset", value: 0}),
        el.const({key: "fwt:shift", value: p.shift}),
        el.const({key: "fwt:tilt", value: p.tilt}),
        el.const({key: "fwt:zoom", value: p.zoom}),
        scaleNode,
        el.const({key: "fwt:wave", value: p.wave})
    );

    const rampShaper = el.extra.framePhasor(
        {key: "fwt:rwRamp", framelength: FRAME_LENGTH},
        -1,
        0,
        0,
        2
    );

    let randomWalks = el.extra.frameRandomWalks(
        {
            key: "fwt:randomWalks",
            framelength: (FRAME_LENGTH) ,
            seed: 17,
            interpolation: true,
            startingfrom: 0,
            initialdeviation: 0.1
        },
        0.1,
        0.5,
        0,
        el.sub( 1, statelessOscillator)
    );

    // use the frames compatible box helpers to cluster the random walks , less hf buzz
    let modSource =  el.extra.boxAverage( { window: 16 } , randomWalks)

    const rawFrameWithMod = el.add(
                statelessOscillator,
                el.mul( modGain, modSource)
            );

    // Mode A: Uniform frameSmooth (no shaping)
    const uniformSmoothedFrame = el.extra.frameSmooth(
        {key: "fwt:uniformSmooth", framelength: FRAME_LENGTH},
        el.const({key: "fwt:smoothTime", value: p.smooth}),
        0, // No shaping - use 0 instead of rampShaper
        rawFrameWithMod
    );

    // Mode B: frameSmooth with shaping activated
    const shapedSmoothedFrame = el.extra.frameSmooth(
        {key: "fwt:shapedSmooth", framelength: FRAME_LENGTH},
        el.const({key: "fwt:smoothTime", value: p.smooth}),
        el.mul(el.const({key: "fwt:smoothShape", value: p.smoothShape}), rampShaper),
        rawFrameWithMod
    );

    // Mode C: frameBiDiSmooth
    const bidiSmoothedFrame = el.extra.frameBiDiSmooth(
        {key: "fwt:bidiSmooth", framelength: FRAME_LENGTH},
        el.const({key: "fwt:attackTime", value: p.smooth * 0.5}),
        el.const({key: "fwt:releaseTime", value: p.smooth * 2.0}),
        0,
        0,
        rawFrameWithMod
    );

    // Select based on smoothMode:
    // 0 = A (uniform), 1 = B (shaped), 2 = C (bidi)
    const mode = el.const({ key: "fwt:smoothMode", value: p.smoothMode });

    const finalFrame = el.extra.frameSelect(
        { framelength: FRAME_LENGTH },
        el.eq(mode, 0),
        uniformSmoothedFrame,
        el.extra.frameSelect(
            { framelength: FRAME_LENGTH },
            el.eq(mode, 1),
            shapedSmoothedFrame,
            bidiSmoothedFrame,
        ),
    );

    // a direct JS pick will reset the frame , as js cannot be frame synchronised like audio
   //  const finalFrame = [neutralSmoothedFrame, smoothedFrame, bidiSmoothedFrame][p.smoothMode]


    const writer = el.extra.frameWriteRAM(
        {key: "fwt:writer", framelength: FRAME_LENGTH, path: RAM_PATH},
        finalFrame
    );

    const frameScope = el.extra.frameScope(
        {key: "fwt:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT},
        finalFrame
    );
    
    const reset = 0;

    const chordVoices = [
        [0, -3, -5, -2],
        [4, 0, 2, 5],
        [7, 9, 10, 9],
        [11, 14, 12, 16]
    ];
    const pans = [-0.95, -0.25, 0.25, 0.095];
    const detunes = [0.997, 1.002, 1.006, 0.994];
    const motionRates = [0.031, 0.041, 0.053, 0.067];
    const voiceLevels = [0.32, 0.27, 0.24, 0.21];

    const root = el.const({key: "fwt:root", value: p.frequency});
    const voices = chordVoices.map((intervals, index) => {
        // sequencer on top of base frequency 
        const hz = el.seq({
            key: `fwt:voice:${index}:seq`,
            seq: intervals.map((semi) => p.frequency * Math.pow(2, semi / 12)),
            hold: true
        }, beat, reset);
        
        // some organic slow low modulation
        const drift = el.mul(0.0035 * (index + 1), el.cycle(motionRates[index]));
        
        const freq = el.mul(detunes[index], el.add(hz, el.mul(root, drift)));
        
        const phase = el.phasor(freq); // phasor reads the table

        const envelope = el.adsr(0.1, 4, 0.001, 4 , beat);

        const levelledTable = el.mul(
                    envelope,
                    el.sm( el.const( {key: `fwt:level:${index}`, value: p.level})) ,
                    voiceLevels[index],
                    el.table({path: RAM_PATH}, phase)
        );

        const leftGain = (1 - pans[index]) * 0.5;
        const rightGain = (1 + pans[index]) * 0.5;
        return [el.mul(leftGain, levelledTable), el.mul(rightGain, levelledTable)];
    });

    const left = el.dcblock( el.add(el.mul(0, writer, frameScope), ...voices.map((voice) => voice[0])));
    const right = el.dcblock( el.add(...voices.map((voice) => voice[1])));
    return [left, right];
}
