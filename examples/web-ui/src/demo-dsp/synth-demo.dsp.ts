/**
 * Synth + extras DSP graph — arp synth with crunch, stride delay, and limiter.
 */

import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import type {StrideDelayBigLeapMode} from "@elem-rs/core/extra";

export interface SynthParams {
    frequency: number;
    limiterEnabled: boolean;
    limiterDrive: number;
    crunchEnabled: boolean;
    crunchDrive: number;
    crunchFuzz: number;
    crunchToneHz: number;
    crunchCutHz: number;
    crunchOutGain: number;
    delayTimeMs: number;
    delayFeedback: number;
    delayTransitionMs: number;
    delayInsertCutoff: number;
    bigLeapMode: StrideDelayBigLeapMode;
    isStopped?: boolean;
}

const morphingWaves = (hz: NodeRepr_t) => el.extra.interpolateN(
        { barberpole: true },
        el.mul(4.0, el.cycle( ((8 + 6) / 2) / 256 )),
        [el.cycle(el.mul(hz, 2.0)),
        el.blepsaw(el.mul(hz, (2/3))),
        el.blepsquare(hz)]
);

const synthVoice = (hz: NodeRepr_t) =>
    el.mul(
        0.25,
        morphingWaves(hz)
    );

const trains = [el.train(8), el.train(6)];

const arp = [0, 4, 7, 11, 12, 11, 4, 7].map(
    (x) => 261.63 * 0.5 * Math.pow(2, x / 12)
);

const modulate = (x: number, rate: number, amt: number) =>
    el.add(x, el.mul(amt, el.cycle(rate)));

const env = el.adsr(0.01, 0.5, 0, 0.4, trains[0]);

const lpf = (vn: number, f: number, x: NodeRepr_t) =>
    el.lowpass(
        el.add(
            el.const({key: "lpf-cutoff-" + vn, value: f}),
            el.mul(modulate(400, 0.05, 800), env)
        ),
        1,
        x
    );

const synthOut = (f: number) => [
    el.mul(0.25, lpf(1, f, synthVoice(el.seq({seq: arp, hold: true, offset: 4}, trains[0], 1)))),
    el.mul(0.25, lpf(2, f, synthVoice(el.seq({seq: arp, hold: true, offset: 0}, trains[1], 1))))
];

function crunchBranch(key: string, input: NodeRepr_t, p: SynthParams): NodeRepr_t {
    // Keep the crunch node in the graph always. Bypass via a keyed mix
    // const so the graph topology stays stable — toggling on/off does not
    // add/remove nodes, which would cause audio dropouts and clicks when
    // downstream state (e.g. stride delay buffer) is disrupted.
    const crunched = el.extra.crunch({
        key,
        channels: 1,
        drive: p.crunchDrive,
        fuzz: p.crunchFuzz,
        toneHz: p.crunchToneHz,
        cutHz: p.crunchCutHz,
        outGain: p.crunchOutGain,
        autoGain: true
    }, input)[0];

    // mix: 0 = dry input, 1 = crunched
    const mix = el.const({ key: `${key}:mix`, value: p.crunchEnabled ? 1 : 0 });
    return el.select(mix, crunched, input);
}

function makeStrideDelay(vn: number, x: NodeRepr_t, p: SynthParams) {
    return el.extra.strideDelayWithInsert(
        {
            key: "stride-delay-" + vn,
            fbtap: "stride-fb-" + vn,
            bigLeapMode: p.bigLeapMode,
            transitionMs: p.delayTransitionMs,
            maxDelayMs: 1000
        },
        el.const({value: p.delayTimeMs, key: "stride-delay-ms-" + vn}),
        el.const({value: p.delayFeedback, key: "stride-delay-fb-" + vn}),
        (fbAudio) => {
            // Lowpass filter in the feedback loop — each repeat gets darker.
            return el.lowpass(
                el.const({value: p.delayInsertCutoff, key: "stride-insert-fc-" + vn}),
                el.const({value: 0.707}),
                fbAudio
            );
        },
        x
    );
}

export function buildGraph(p: SynthParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({ value: 0 }), el.const({ value: 0 })];
    }
    const out = synthOut(p.frequency);
    const crunchy = [
        crunchBranch("crunch:0", out[0], p),
        crunchBranch("crunch:1", out[1], p)
    ];
    const delayed = [
        makeStrideDelay(1, crunchy[0], p),
        makeStrideDelay(2, crunchy[1], p)
    ];

    if (!p.limiterEnabled) return delayed;

    return el.extra.stereoLimiter(
        {key: "stereo-limiter", inputGain: p.limiterDrive},
        delayed[0],
        delayed[1]
    );
}
