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

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import { TIME_SCALE } from "../components/Oscilloscope";

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
  /** Bandpass Q (resonance sharpness) at the fundamental. */
  q: number;
  /**
   * Self-resonance amount 0.0–1.0. Mapped internally to loop-gain
   * `fb_eff = fb * α / Q` where α≈0.95. At fb=1.0 the filter is right at
   * its self-oscillation threshold regardless of Q — below that it rings
   * without running away, above it would run away (clipped by tanh).
   */
  fb: number;
  /** Number of partials in the bank. */
  partials: number;
  /** Per-partial detune percent. */
  spreadPct: number;
  /** Final output gain 0.0–1.0. */
  gain: number;
  /** Stop flag — returns silent roots when true. */
  isStopped?: boolean;
}

/**
 * Build one self-resonating partial.
 *
 * ```
 * exciter ──┐
 *           │
 *   tapIn ──► * fb ──┐
 *                     ├──► + ──► bandpass(fc, Q) ──► tanh ──► tapOut ──► out
 * exciter ────────────┘
 * ```
 * Feedback path has 1-block latency (tapIn/tapOut).
 */
function resonator(
  tag: string,
  exciter: NodeRepr_t,
  fc: number,
  q: number,
  fb: number,
  outGain: number,
): NodeRepr_t {
  const tapName = `bank:res:${tag}`;
  const fbReturn = el.tapIn({ name: tapName });

  const input = el.add(
    exciter,
    el.mul(el.const({ key: `bank:fb:${tag}`, value: fb }), fbReturn),
  );

  const voice = el.bandpass(
    el.const({ key: `bank:fc:${tag}`, value: fc }),
    el.const({ key: `bank:q:${tag}`, value: q }),
    input,
  );

  // Soft clip the feedback return so self-oscillation doesn't explode.
  const limited = el.tanh(el.mul(1.2, voice));
  const tapped = el.tapOut({ name: tapName }, limited);

  return el.mul(el.const({ key: `bank:g:${tag}`, value: outGain }), tapped);
}

/**
 * Build the full resonator bank, panned alternately L/R by partial index.
 */
function buildBank(
  exciter: NodeRepr_t,
  p: DustBankParams,
): [NodeRepr_t, NodeRepr_t] {
  const leftVoices: NodeRepr_t[] = [];
  const rightVoices: NodeRepr_t[] = [];

  // Nyquist stability: loop gain at resonance = fb * Q, so fb = α/Q
  // keeps the system just below the self-oscillation threshold.
  // α < 1 leaves a small safety margin so fb=1.0 rings very long but
  // does not actually run away.
  const STABILITY_MARGIN = 0.95;

  for (let i = 0; i < p.partials; i++) {
    const harmonic = i + 1;
    const detuneSign = i % 2 === 0 ? 1 : -1;
    const detune = 1 + detuneSign * (p.spreadPct / 100) * Math.log2(harmonic + 1) * 0.5;
    const fc = p.fundamental * harmonic * detune;

    // Frequency-dependent damping: higher partials need more damping.
    // At 20 kHz we want roughly 0.25× the Q of the fundamental so the
    // resonator stays tame. Use a 1/(1 + fc/dampStart) rolloff.
    const DAMP_START_HZ = 2000;
    const freqDamping = 1 / (1 + fc / DAMP_START_HZ);
    const qScaled = p.q * freqDamping;

    // Couple the user-facing fb knob to Q so the oscillation threshold
    // lands at fb=1.0 regardless of the final effective Q:
    //   fb_eff = fb * STABILITY_MARGIN / Q
    const fbEff = (p.fb * STABILITY_MARGIN) / qScaled;

    // Per-partial output gain compensation.
    const outGain = 1 / Math.sqrt(harmonic);

    const voice = resonator(String(i), exciter, fc, qScaled, fbEff, outGain);

    if (i % 2 === 0) {
      leftVoices.push(voice);
    } else {
      rightVoices.push(voice);
    }
  }

  const sumSide = (voices: NodeRepr_t[]): NodeRepr_t =>
    voices.length > 0
      ? voices.reduce((acc, v) => el.add(acc, v))
      : el.const({ value: 0 });

  return [sumSide(leftVoices), sumSide(rightVoices)];
}

export function buildGraph(p: DustBankParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const exciter = el.extra.dust(
    { key: "bank:exciter", seed: 7, bipolar: true, jitter: p.jitter },
    el.const({ key: "bank:density", value: p.density }),
    el.const({ key: "bank:trails", value: p.trailsMs / 1000 }),
  );

  const [bankL, bankR] = buildBank(exciter, p);

  // Soft limiter on output — high Q can produce large peaks.
  const outL = el.tanh(el.mul(el.const({ key: "bank:gain:l", value: p.gain }), bankL));
  const outR = el.tanh(el.mul(el.const({ key: "bank:gain:r", value: p.gain }), bankR));

  // Scope the summed output without affecting the audio path.
  const scopeInsert = el.scope(
    { name: SCOPE_NAME, size: TIME_SCALE, channels: 1 },
    el.mul(0.5, el.add(outL, outR)),
  );

  return [el.add(outL, el.mul(0, scopeInsert)), outR];
}
