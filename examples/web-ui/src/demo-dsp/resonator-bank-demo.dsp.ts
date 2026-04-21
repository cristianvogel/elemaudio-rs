/**
 * Modal stiff-string resonator bank demo — TS reference implementation.
 *
 * Two helpers live here, built only from existing `el.*` nodes so the
 * browser can run them today. A native `el.extra.resonatorBank` /
 * `el.extra.hammerStrike` pair will replace these in a later phase. The
 * public shape of `resonatorBankReference` intentionally mirrors the
 * intended native signal-first API:
 *
 *   resonatorBankReference(
 *     { modes },
 *     f0, inharmonicity, strikePos, brightness, decay,
 *     exciter,
 *   )
 *
 * All control inputs are signals. `modes` is structural and stays a prop.
 *
 * # Modal stiff-string model
 *
 * Each partial n in [1, modes] becomes one Karplus-Strong-style delay
 * resonator tuned to:
 *
 *   f_n = n * f0 * sqrt(1 + B * n^2)
 *
 * where B is the inharmonicity coefficient. Per-mode excitation weight
 * follows the struck-string pattern:
 *
 *   w_n = sin(pi * n * strikePos) * brightnessTilt(n, brightness)
 *
 * Damping is applied via a per-mode feedback factor. Higher modes decay
 * faster.
 *
 * # Hammer exciter
 *
 * `hammerStrikeReference` emits a short amplitude burst shaped by
 * `hardness` and `velocity` signals, gated by a `trigger` signal.
 */

import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import {TIME_SCALE} from "../components/Oscilloscope";

export const SCOPE_HAMMER = "resonator-bank-scope-hammer";
export const SCOPE_OUTPUT = "resonator-bank-scope-output";

// Clamp range for modes. The bank cost is O(modes) graph nodes.
const MODES_MIN = 1;
const MODES_MAX = 64;

// Per-mode feedback clamping. Keep below 1.0 for strict stability of
// the delay-line resonator. At 0.9995 the ring approaches infinity.
const FB_HEAD_ROOM = 0.9995;

export interface ResonatorBankProps {
    /** Number of modes in the bank. Structural; default 24. */
    modes?: number;
    /** Optional authoring key prefix for all internal consts. */
    key?: string;
}

/**
 * Signal-first reference modal resonator bank.
 *
 * Mono exciter in, stereo resonant output. All control inputs are signals.
 */
export function resonatorBank(
    props: ResonatorBankProps,
    f0: NodeRepr_t,
    inharmonicity: NodeRepr_t,
    strikePos: NodeRepr_t,
    brightness: NodeRepr_t,
    spread: NodeRepr_t,
    decay: NodeRepr_t,
    exciter: NodeRepr_t
): [NodeRepr_t, NodeRepr_t] {
    const modes = Math.max(
        MODES_MIN,
        Math.min(MODES_MAX, Math.floor(props.modes ?? 24))
    );
    const key = props.key ?? "rbank";

    const DECAY_CURVE = 0.1956;
    const decayClamped = el.max(0, el.min(1, decay));
    const spreadClamped = el.max(0, el.min(1, spread));
    const fbMacro = el.mul(FB_HEAD_ROOM, el.pow(decayClamped, DECAY_CURVE));

    const modeOutputsL: NodeRepr_t[] = [];
    const modeOutputsR: NodeRepr_t[] = [];

    for (let i = 0; i < modes; i++) {
        const n = i + 1;
        const tag = `${key}:m${i}`;

        // --- Frequency -------------------------------------------------
        // f_n = n * f0 * sqrt(1 + B * n^2)
        const nSq = n * n;
        const stretch = el.sqrt(el.add(1, el.mul(nSq, inharmonicity)));
        const fn = el.mul(n, el.mul(f0, stretch));

        // Clamp to audible range. Above Nyquist/0.4 the SVF-backed
        // bandpass becomes unstable anyway.
        const fnClamped = el.max(20, el.min(12000, fn));

        // Delay length in samples = sr / f_n.
        const period = el.div(el.sr(), fnClamped);

        // --- Excitation weight -----------------------------------------
        // sin(pi * n * strikePos) — struck-string modal amplitude.
        const spClamped = el.max(0.001, el.min(0.999, strikePos));
        const excArg = el.mul(Math.PI * n, spClamped);
        const posWeight = el.sin(excArg);

        // Brightness tilt: blend between darker 1/sqrt(n) upper-mode
        // attenuation (brightness=0) and flat response (brightness=1).
        const brClamped = el.max(0, el.min(1, brightness));
        const flatTerm = brClamped;
        const tiltedTerm = el.mul(el.sub(1, brClamped), 1 / Math.sqrt(n));
        const brightWeight = el.add(flatTerm, tiltedTerm);

        const weight = el.mul(posWeight, brightWeight);

        // --- Damping (per-mode fb) -------------------------------------
        // fb_n = fb_macro ^ (1 + log2(n) * 0.3)
        // Upper modes decay faster.
        const fbExponent = 1 + Math.log2(n) * 0.3;
        const fbPartial = el.pow(fbMacro, fbExponent);

        // --- Pre-shape the exciter at f_n ------------------------------
        const shaped = el.bandpass(fnClamped, el.const({value: 160  }), exciter);

        const drive = el.mul(weight, shaped);

        // --- Resonator core --------------------------------------------
        const rung = el.delay(
            {key: `${tag}:dly`, size: 8192},
            period,
            fbPartial,
            drive
        );

        // Per-mode output compensation — keeps low modes from dominating.
        const compGain = 1 / Math.sqrt(n);

        // Pairwise widening around center. The first pair sits close to
        // center and later pairs fan outward:
        //   mode 0 -> center + spread * 1/modes
        //   mode 1 -> center - spread * 1/modes
        //   mode 2 -> center + spread * 2/modes
        //   mode 3 -> center - spread * 2/modes
        const pairIndex = Math.floor(i / 2) + 1;
        const offset = pairIndex / modes;
        const panSign = i % 2 === 0 ? 1 : -1;
        const panPos = el.max(
            0,
            el.min(
                1,
                el.add(0.5, el.mul(0.5 * panSign * offset, spreadClamped))
            )
        );
        const gainL = el.sub(1, panPos);
        const gainR = panPos;
        const voice = el.mul(compGain, rung);
        modeOutputsL.push(el.mul(gainL, voice));
        modeOutputsR.push(el.mul(gainR, voice));
    }

    // Sum all modes. Start from a zero const so the reduce is stable
    // even for modes=1.
    const sumL = modeOutputsL.reduce<NodeRepr_t>(
        (acc, v) => el.add(acc, v),
        el.const({value: 0})
    );
    const sumR = modeOutputsR.reduce<NodeRepr_t>(
        (acc, v) => el.add(acc, v),
        el.const({value: 0})
    );

    // Loose normalization by sqrt(modes) so sweeping modes doesn't
    // cause big loudness jumps.
    const normGain = 1 / Math.sqrt(modes);
    return [el.mul(normGain, sumL), el.mul(normGain, sumR)];
}

// -----------------------------------------------------------------------
// Hammer exciter (TS reference)
// -----------------------------------------------------------------------

export interface HammerStrikeProps {
    /** Optional authoring key. */
    key?: string;
}

/**
 * Signal-first hammer strike exciter.
 *
 * Emits a short noise burst on each `trigger` rising edge. Its shape is:
 *   - attack set by `hardness` (harder = sharper attack, brighter)
 *   - amplitude scaled by `velocity`
 *   - softened by a lowpass whose cutoff tracks `hardness`
 *
 * `trigger`  — gate signal, typically el.train(rateHz)
 * `velocity` — 0..1 signal
 * `hardness` — 0..1 signal (soft felt → hard hammer)
 */
export function hammerStrikeReference(
    props: HammerStrikeProps,
    trigger: NodeRepr_t,
    velocity: NodeRepr_t,
    hardness: NodeRepr_t
): NodeRepr_t {
    const key = props.key ?? "hammer";

    const velClamp = el.max(0, el.min(1, velocity));
    const hardClamp = el.max(0, el.min(1, hardness));

    // Attack time: 0.5 ms (hard) → 8 ms (soft felt).
    const attackMs = el.sub(8, el.mul(7.5, hardClamp));
    const attackSec = el.mul(attackMs, 1 / 1000);

    // Release time: 20 ms (soft) → 60 ms (hard). Hard hammers ring
    // slightly longer in the burst itself.
    const releaseMs = el.add(20, el.mul(40, hardClamp));
    const releaseSec = el.mul(releaseMs, 1 / 1000);

    // ADSR envelope: the burst shape (attack, release, sustain=0,
    // release-after-gate=very short, gate=trigger).
    const env = el.adsr(attackSec, releaseSec, 0, 0.001, trigger);

    // Contact noise body, shaped by hardness. Soft hammers sound duller.
    // Cutoff maps 400 Hz (soft) → 7 kHz (hard).
    const cutoff = el.add(400, el.mul(6600, hardClamp));
    const body = el.lowpass(
        cutoff,
        el.const({value: 0.707}),
        el.noise({key: `${key}:noise`, seed: 11})
    );

    return el.mul(env, el.mul(velClamp, body));
}

// -----------------------------------------------------------------------
// Demo graph
// -----------------------------------------------------------------------

export type ExciterKind = "hammer" | "rain";
export type ClipMode = "soft" | "limiter";

export interface ResonatorBankParams {
    /** Exciter source. */
    exciter: ExciterKind;

    // --- Bank controls (all live signals in the graph) ----------------
    /** Fundamental frequency in Hz. */
    f0: number;
    /** Inharmonicity coefficient B. Stiff-string stretch, ~0..0.01. */
    inharmonicity: number;
    /** Strike position 0..1 (exclusive). ~0.12–0.18 is piano-like. */
    strikePos: number;
    /** Increase to modulate the strike position at smaple rate with latched random on every strike. */
    strikePosJitter: number;
    /** Upper-mode tilt 0..1. 0 = flat, 1 = brighter high partials. */
    brightness: number;
    /** Stereo widening 0..1. */
    stereoSpread: number;
    /** Macro decay 0..1. Longer when higher. */
    decay: number;
    /** Number of modes in the bank. 1..64. */
    modes: number;

    // --- Hammer exciter -----------------------------------------------
    /** Repeat rate for the hammer trigger in Hz. */
    strikeRate: number;
    /** Strike velocity 0..1. */
    velocity: number;
    /** Hammer hardness 0..1. */
    hardness: number;

    // --- Rain exciter (for A/B) ---------------------------------------
    /** Rain density in impulses/sec. */
    rainDensity: number;
    /** Rain release in ms. */
    rainReleaseMs: number;
    /** Rain amp jitter 0..1. */
    rainJitter: number;

    // --- Output --------------------------------------------------------
    /** Final output gain 0..1. */
    gain: number;
    /** Output clipping flavour. */
    clipMode: ClipMode;
    /** Silence flag. */
    isStopped?: boolean;
}

/**
 * Build the full demo graph: exciter → resonator bank → clip → stereo.
 */
export function buildGraph(p: ResonatorBankParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({value: 0}), el.const({value: 0})];
    }

    // --- Build exciter -----------------------------------------------

    let exciter: NodeRepr_t;
    let rng = el.rand();
    const wrap01 = (x: NodeRepr_t): NodeRepr_t => el.mod(x, 1);
    const strikePos = el.const({key: "rb:strikePos", value: p.strikePos});
    const strikePosJitter = el.const({key: "rb:strikePosJitter", value: p.strikePosJitter});

    let rain: NodeRepr_t =
        el.extra.rain(
            {key: "rb:rain", seed: 137, jitter: p.rainJitter},
            el.const({key: "rb:rainDensity", value: p.rainDensity}),
            el.const({key: "rb:rainRelease", value: p.rainReleaseMs / 1000})
        );

    if (p.exciter === "hammer") {
        const trig = el.train(el.const({key: "rb:strikeRate", value: p.strikeRate}));
        exciter = hammerStrikeReference(
            {key: "rb:hammer"},
            trig,
            el.const({key: "rb:velocity", value: p.velocity}),
            el.const({key: "rb:hardness", value: p.hardness})
        );
    } else {
        // Rain path for A/B comparison against the hammer.
        const hardness = el.const({key: "rb:hardness", value: p.hardness});
        exciter =
            el.mul(el.const({
                key: "rb:velocity",
                value: p.velocity
            }), el.select(hardness, el.mul(rain, el.db2gain(-6.0), rng), rain));
    }

    const strikePosWithJitter: NodeRepr_t = wrap01(el.add( strikePos,
        el.select(strikePosJitter,
             el.abs( el.latch( el.ge(exciter, 0.1), el.extra.foldback( {thresh: 0.5, amp: 1.0}, el.cycle(0.0137) )) ),
            0
        )));
    // --- Build bank ---------------------------------------------------
    const [bankL, bankR] = resonatorBank(
        {modes: p.modes, key: "rb"},
        el.sm(el.const({key: "rb:f0", value: p.f0})),
        el.const({key: "rb:inharm", value: p.inharmonicity}),
        strikePosWithJitter,
        el.const({key: "rb:brightness", value: p.brightness}),
        el.const({key: "rb:spread", value: p.stereoSpread}),
        el.const({key: "rb:decay", value: p.decay}),
        exciter
    );

    const preL = el.mul(el.const({key: "rb:gain:l", value: p.gain}), bankL);
    const preR = el.mul(el.const({key: "rb:gain:r", value: p.gain}), bankR);

    // --- Output clipping ---------------------------------------------
    const [outL, outR] =
        p.clipMode === "limiter"
            ? el.extra.stereoLimiter(
                {
                    key: "rb:limiter",
                    outputLimit: 0.95,
                    attackMs: 1,
                    holdMs: 0,
                    releaseMs: 20
                },
                preL,
                preR
            )
            : [el.tanh(preL), el.tanh(preR)];

    // Scope the hammer exciter before the bank.
    const scopeHammer = el.scope(
        {name: SCOPE_HAMMER, size: TIME_SCALE, channels: 1},
        exciter
    );

    // Scope the mono output without altering the audible signal.
    const scopeOutput = el.scope(
        {name: SCOPE_OUTPUT, size: TIME_SCALE, channels: 1},
        el.mul(0.5, el.add(outL, outR))
    );

    // Duplicate to stereo and absorb both scope inserts (multiplied by 0)
    // so they stay in the graph without affecting the audible signal.
    const l = el.add(outL, el.mul(0, scopeHammer, scopeOutput));
    const r = outR;
    return [l, r];
}
