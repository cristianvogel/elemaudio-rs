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

import type { NodeRepr_t, ElemNode } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import { TIME_SCALE } from "../components/Oscilloscope";

export const SCOPE_NAME = "resonator-bank-scope";

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
 * Mono exciter in, mono resonant output. All control inputs are signals.
 */
export function resonatorBankReference(
  props: ResonatorBankProps,
  f0: ElemNode,
  inharmonicity: ElemNode,
  strikePos: ElemNode,
  brightness: ElemNode,
  decay: ElemNode,
  exciter: ElemNode,
): NodeRepr_t {
  const modes = Math.max(
    MODES_MIN,
    Math.min(MODES_MAX, Math.floor(props.modes ?? 24)),
  );
  const key = props.key ?? "rbank";

  const f0N = f0 as NodeRepr_t;
  const B = inharmonicity as NodeRepr_t;
  const sp = strikePos as NodeRepr_t;
  const br = brightness as NodeRepr_t;
  const dk = decay as NodeRepr_t;
  const ex = exciter as NodeRepr_t;

  // Clamp decay to (0, 1) softly to keep fb < 1. Map macro decay to a
  // feedback factor: fb_macro = FB_HEAD_ROOM * sqrt(decay). sqrt gives
  // a more linear feel than raw decay because ring-time is geometric.
  const decayClamped = el.max(0, el.min(1, dk));
  const fbMacro = el.mul(FB_HEAD_ROOM, el.sqrt(decayClamped));

  const modeOutputs: NodeRepr_t[] = [];

  for (let i = 0; i < modes; i++) {
    const n = i + 1;
    const tag = `${key}:m${i}`;

    // --- Frequency -------------------------------------------------
    // f_n = n * f0 * sqrt(1 + B * n^2)
    const nSq = n * n;
    const stretch = el.sqrt(el.add(1, el.mul(nSq, B)));
    const fn = el.mul(n, el.mul(f0N, stretch));

    // Clamp to audible range. Above Nyquist/0.4 the SVF-backed
    // bandpass becomes unstable anyway.
    const fnClamped = el.max(20, el.min(18000, fn));

    // Delay length in samples = sr / f_n.
    const period = el.div(el.sr(), fnClamped);

    // --- Excitation weight -----------------------------------------
    // sin(pi * n * strikePos) — struck-string modal amplitude.
    const spClamped = el.max(0.001, el.min(0.999, sp));
    const excArg = el.mul(Math.PI * n, spClamped);
    const posWeight = el.sin(excArg);

    // Brightness tilt: blend between flat response (brightness=0) and
    // 1/sqrt(n) upper-mode attenuation (brightness=1).
    const brClamped = el.max(0, el.min(1, br));
    const flatTerm = el.sub(1, brClamped);
    const tiltedTerm = el.mul(brClamped, 1 / Math.sqrt(n));
    const brightWeight = el.add(flatTerm, tiltedTerm);

    const weight = el.mul(posWeight, brightWeight);

    // --- Damping (per-mode fb) -------------------------------------
    // fb_n = fb_macro ^ (1 + log2(n) * 0.3)
    // Upper modes decay faster.
    const fbExponent = 1 + Math.log2(n) * 0.3;
    const fbPartial = el.pow(fbMacro, fbExponent);

    // --- Pre-shape the exciter at f_n ------------------------------
    const shaped = el.bandpass(fnClamped, el.const({ value: 160 }), ex);

    const drive = el.mul(weight, shaped);

    // --- Resonator core --------------------------------------------
    const rung = el.delay(
      { key: `${tag}:dly`, size: 8192 },
      period,
      fbPartial,
      drive,
    );

    // Per-mode output compensation — keeps low modes from dominating.
    const compGain = 1 / Math.sqrt(n);
    modeOutputs.push(el.mul(compGain, rung));
  }

  // Sum all modes. Start from a zero const so the reduce is stable
  // even for modes=1.
  const sum = modeOutputs.reduce<NodeRepr_t>(
    (acc, v) => el.add(acc, v),
    el.const({ value: 0 }) as NodeRepr_t,
  );

  // Loose normalization by sqrt(modes) so sweeping modes doesn't
  // cause big loudness jumps.
  const normGain = 1 / Math.sqrt(modes);
  return el.mul(normGain, sum);
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
  trigger: ElemNode,
  velocity: ElemNode,
  hardness: ElemNode,
): NodeRepr_t {
  const key = props.key ?? "hammer";
  const trig = trigger as NodeRepr_t;
  const vel = velocity as NodeRepr_t;
  const hard = hardness as NodeRepr_t;

  const velClamp = el.max(0, el.min(1, vel));
  const hardClamp = el.max(0, el.min(1, hard));

  // Attack time: 0.5 ms (hard) → 8 ms (soft felt).
  const attackMs = el.sub(8, el.mul(7.5, hardClamp));
  const attackSec = el.mul(attackMs, 1 / 1000);

  // Release time: 20 ms (soft) → 60 ms (hard). Hard hammers ring
  // slightly longer in the burst itself.
  const releaseMs = el.add(20, el.mul(40, hardClamp));
  const releaseSec = el.mul(releaseMs, 1 / 1000);

  // ADSR envelope: the burst shape (attack, release, sustain=0,
  // release-after-gate=very short, gate=trigger).
  const env = el.adsr(attackSec, releaseSec, 0, 0.001, trig);

  // Contact noise body, shaped by hardness. Soft hammers sound duller.
  // Cutoff maps 400 Hz (soft) → 7 kHz (hard).
  const cutoff = el.add(400, el.mul(6600, hardClamp));
  const body = el.lowpass(
    cutoff,
    el.const({ value: 0.707 }),
    el.noise({ key: `${key}:noise`, seed: 11 }),
  );

  return el.mul(env, el.mul(velClamp, body));
}

// -----------------------------------------------------------------------
// Demo graph
// -----------------------------------------------------------------------

export type ExciterKind = "hammer" | "dust";
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
  /** Upper-mode tilt 0..1. 0 = flat, 1 = brighter high partials. */
  brightness: number;
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

  // --- Dust exciter (for A/B) ---------------------------------------
  /** Dust density in impulses/sec. */
  dustDensity: number;
  /** Dust tail ms. */
  dustTrailsMs: number;

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
 *
 * The bank is mono; stereo is derived by mild odd-partial L / even-partial R
 * phase offset via a pair of slightly detuned bank renders. For phase 1 the
 * simpler approach is: mono bank duplicated to both channels. Detail will
 * come when the native node lands and per-mode outputs are cheap.
 */
export function buildGraph(p: ResonatorBankParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  // --- Build exciter ------------------------------------------------
  let exciter: NodeRepr_t;

  if (p.exciter === "hammer") {
    const trig = el.train(el.const({ key: "rb:strikeRate", value: p.strikeRate }));
    exciter = hammerStrikeReference(
      { key: "rb:hammer" },
      trig,
      el.const({ key: "rb:velocity", value: p.velocity }),
      el.const({ key: "rb:hardness", value: p.hardness }),
    );
  } else {
    // Dust path for A/B comparison against the hammer.
    exciter = el.extra.dust(
      { key: "rb:dust", seed: 7, bipolar: true, jitter: 0 },
      el.const({ key: "rb:dustDensity", value: p.dustDensity }),
      el.const({ key: "rb:dustTrails", value: p.dustTrailsMs / 1000 }),
    );
  }

  // --- Build bank ---------------------------------------------------
  const bank = resonatorBankReference(
    { modes: p.modes, key: "rb" },
    el.const({ key: "rb:f0", value: p.f0 }),
    el.const({ key: "rb:inharm", value: p.inharmonicity }),
    el.const({ key: "rb:strikePos", value: p.strikePos }),
    el.const({ key: "rb:brightness", value: p.brightness }),
    el.const({ key: "rb:decay", value: p.decay }),
    exciter,
  );

  const pre = el.mul(el.const({ key: "rb:gain", value: p.gain }), bank);

  // --- Output clipping ---------------------------------------------
  const out =
    p.clipMode === "limiter"
      ? el.extra.limiter(
          {
            key: "rb:limiter",
            outputLimit: 0.95,
            attackMs: 1,
            holdMs: 0,
            releaseMs: 20,
          },
          pre,
        )
      : el.tanh(pre);

  // Scope the mono output for visualization without altering audio.
  const scopeInsert = el.scope(
    { name: SCOPE_NAME, size: TIME_SCALE, channels: 1 },
    out,
  );

  // Duplicate to stereo and absorb the scope insert (multiplied by 0)
  // so it stays in the graph without affecting the audible signal.
  const l = el.add(out, el.mul(0, scopeInsert));
  const r = out;
  return [l, r];
}

