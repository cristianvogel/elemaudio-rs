/**
 * Rain signal utility demo — scope-only DSP graph.
 *
 * Shows sparse impulses from `el.extra.rain` for visualization.
 * No audio output — the graph is rendered (so rain ticks) but output is muted.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import { TIME_SCALE } from "../components/Oscilloscope";

export const SCOPE_NAME = "rain-scope";

export interface RainParams {
  /** Rain trigger rate in impulses/sec. */
  density: number;
  /** Rain release in ms — 0 = single-sample impulse, larger = soft pulse. */
  releaseMs: number;
  /** Per-impulse amplitude jitter 0.0–1.0. */
  jitter: number;
  /** Silence flag — mutes output when true. */
  isStopped?: boolean;
}

/**
 * Build the rain visualization graph.
 *
 * Returns stereo silence so no audio is heard, but the scope tap shows
 * the rain impulses directly. This lets the user explore the impulse
 * generator's behavior without sound.
 */
export function buildGraph(p: RainParams): NodeRepr_t[] {
  const rain = el.extra.rain(
    {
      key: "rain:gen",
      seed: 7,
      jitter: p.jitter,
    },
    el.const({ key: "rain:density", value: p.density }),
    el.const({ key: "rain:release", value: p.releaseMs / 1000 }),
  );

  // Scope tap on the rain signal itself.
  const scopeInsert = el.scope(
    { name: SCOPE_NAME, size: TIME_SCALE, channels: 1 },
    rain,
  );

  // Return stereo silence. The scope tap is kept alive via multiplication by 0
  // so rain still ticks even though we output silence.
  const silence = el.const({ value: 0 });
  const left = el.add(silence, el.mul(0, scopeInsert));
  const right = silence;

  return [left, right];
}
