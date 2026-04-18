/**
 * Dust resonator bank DSP graph.
 *
 * Sparse bipolar impulses from `el.extra.dust` excite a bank of
 * self-resonating bandpass filters. Each resonator wraps a bandpass in
 * a tapIn/tapOut feedback loop so it can sustain oscillation well beyond
 * what the SVF's clamped damping would allow on its own.
 *
 * Odd partials pan left, even partials pan right.
 */

import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import {TIME_SCALE} from "../components/Oscilloscope";

export const SCOPE_NAME = "dust-bank-scope";

export interface DustBankParams {
    /** Dust trigger rate in impulses/sec. */
    density: number;
    /** Dust tail in ms — 0 = single-sample impulse, larger = soft pulse. */
    trailsMs: number;
    /** Per-impulse amplitude jitter 0.0–1.0. */
    jitter: number;
    /** Fundamental frequency in Hz. */
    fundamental: number;
    /**
     * Resonance 0.0–1.0. Drives both Q and feedback in a single coupled
     * parameter:
     *   Q  = Q_MIN + resonate * (Q_MAX - Q_MIN)   linear ramp
     *   fb = resonate^2                            squared curve
     *   fb_eff = fb * STABILITY_MARGIN / Q         Nyquist-stable
     *
     * At resonate=0 the filter is a mild bandpass. At resonate=1 it is at
     * its self-oscillation threshold, ringing indefinitely.
     */
    resonate: number;
    /** Number of partials in the bank. */
    partials: number;
    /** Per-partial detune percent. */
    spreadPct: number;
    /** Final output gain 0.0–1.0. */
    gain: number;
    /** Output clipping flavour. */
    clipMode: "soft" | "limiter";
    /** Stop flag — returns silent roots when true. */
    isStopped?: boolean;
}

/**
 * Build one tuned resonator partial.
 *
 * Karplus-Strong-style delay-line resonator:
 * ```
 *   y[n] = bp(exciter) + fb * y[n - period]
 * ```
 * where period = sr/fc. The band-limited input pre-filter `bp` shapes
 * the exciter into a pitched impulse. Sample-accurate feedback through
 * the delay line gives clean pitched resonance — no block latency.
 *
 * As fb approaches 1.0 the ring time approaches infinity. A short
 * lowpass on the feedback path gives the classic "plucked string"
 * decay character (higher partials decay faster than lower ones).
 */
function resonator(
    tag: string,
    exciter: NodeRepr_t,
    fc: number,
    fb: number,
    outGain: number
): NodeRepr_t {
    // Delay length = sr / fc, computed inside the graph so it tracks the
    // context sample rate automatically.
    const period = el.div(
        el.sr(),
        el.const({key: `bank:fc:${tag}`, value: fc})
    );

    // Shape the exciter with a narrow bandpass at fc so energy lands near
    // the resonator's natural frequency.
    const rez = el.bandpass(
        el.const({key: `bank:fc2:${tag}`, value: fc }),
        el.const({value: 20}),
        exciter
    );


    // Max delay buffer sized for low fundamentals — 8192 samples handles
    // fc down to ~6 Hz at 48 kHz.
    const buzz = el.delay(
        {key: `bank:dly:${tag}`, size: 8192},
        period,
        el.const({key: `bank:fb:${tag}`, value: fb}),
        rez
    );



    return el.mul(el.const({key: `bank:g:${tag}`, value: outGain}), buzz );
}

/**
 * Build the full resonator bank, panned alternately L/R by partial index.
 */
function buildBank(
    exciter: NodeRepr_t,
    p: DustBankParams
): [NodeRepr_t, NodeRepr_t] {
    const leftVoices: NodeRepr_t[] = [];
    const rightVoices: NodeRepr_t[] = [];

    // Resonance → feedback mapping for the delay-line resonator.
    //
    // Ring time in cycles ≈ ln(0.001)/ln(fb). So:
    //   fb=0.80 → 31 cycles   (short ping)
    //   fb=0.95 → 135 cycles  (bell)
    //   fb=0.99 → 687 cycles  (long sustain)
    //   fb=0.999 → 6900 cycles (near infinite)
    //
    // Non-linear map gives intuitive feel across the slider range.
    // At resonate=0 fb=0.5 (very short click), at 1.0 fb=0.9995.
    const FB_MIN = 0.5;
    const FB_MAX = 0.9995;
    const fbBase = FB_MIN + (FB_MAX - FB_MIN) * Math.pow(p.resonate, 0.5);

    for (let i = 0; i < p.partials; i++) {
        const harmonic = i + 1;
        const detuneSign = i % 2 === 0 ? 1 : -1;
        const detune = 1 + detuneSign * (p.spreadPct / 100) * Math.log2(harmonic + 1) * 0.5;
        const fc = p.fundamental * harmonic * detune;

        // Higher partials decay faster (plucked-string style): reduce fb
        // slightly per harmonic.
        const fbPartial = Math.pow(fbBase, 1 + Math.log2(harmonic));

        // Per-partial output gain compensation.
        const outGain = 1 / Math.sqrt(harmonic);

        const voice = resonator(String(i), exciter, fc, fbPartial, outGain);

        if (i % 2 === 0) {
            leftVoices.push(voice);
        } else {
            rightVoices.push(voice);
        }
    }

    const sumSide = (voices: NodeRepr_t[]): NodeRepr_t =>
        voices.length > 0
            ? voices.reduce((acc, v) => el.add(acc, v))
            : el.const({value: 0});

    return [sumSide(leftVoices), sumSide(rightVoices)];
}

export function buildGraph(p: DustBankParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({value: 0}), el.const({value: 0})];
    }

    const dust = el.extra.dust(
        {key: "bank:dust", seed: 7, bipolar: true, jitter: p.jitter},
        el.const({key: "bank:density", value: p.density}),
        el.const({key: "bank:trails", value: p.trailsMs / 1000})
    );


    const shapedNoise = el.mul( dust, el.pink( el.noise({seed: 7})));

    const [bankL, bankR] = buildBank(shapedNoise, p);

    const preL = el.mul(el.const({key: "bank:gain:l", value: p.gain }), bankL);
    const preR = el.mul(el.const({key: "bank:gain:r", value: p.gain }), bankR);

    // Output clipping flavour.
    let [outL, outR] = p.clipMode === "limiter"
        ? el.extra.stereoLimiter(
            {key: "bank:limiter", outputLimit: 0.95, attackMs: 0.1, holdMs: 0, releaseMs: 20},
            preL,
            preR
        )
        : [el.tanh(preL), el.tanh(preR)];

    // final pinkify, makes for more natural sound

    outL =  el.pink(outL);
    outR =   el.pink(outR);

    // Scope the summed output without affecting the audio path.
    const scopeInsert = el.scope(
        {name: SCOPE_NAME, size: TIME_SCALE, channels: 1},
        el.mul(0.5, el.add(outL, outR))
    );

    return [el.add(outL, el.mul(0, scopeInsert)), outR];
}
