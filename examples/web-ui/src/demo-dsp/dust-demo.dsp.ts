/**
 * Dust signal utility demo — scope-only DSP graph.
 *
 * Shows sparse impulses from `el.extra.dust` for visualization.
 * No audio output — the graph is rendered (so dust ticks) but output is muted.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import { TIME_SCALE } from "../components/Oscilloscope";

export const SCOPE_NAME = "dust-scope";

export interface DustParams {
  /** Dust trigger rate in impulses/sec. */
  density: number;
  /** Dust release in ms — 0 = single-sample impulse, larger = soft pulse. */
  releaseMs: number;
  /** Per-impulse amplitude jitter 0.0–1.0. */
  jitter: number;
  /** Silence flag — mutes output when true. */
  isStopped?: boolean;
}

/**
 * Build the dust visualization graph.
 *
 * Returns stereo silence so no audio is heard, but the scope tap shows
 * the dust impulses directly. This lets the user explore the impulse
 * generator's behavior without sound.
 */
export function buildGraph(p: DustParams): NodeRepr_t[] {
  const dust = el.extra.dust(
    {
      key: "dust:gen",
      seed: 7,
      jitter: p.jitter,
    },
    el.const({ key: "dust:density", value: p.density }),
    el.const({ key: "dust:release", value: p.releaseMs / 1000 }),
  );

  // Scope tap on the dust signal itself.
  const scopeInsert = el.scope(
    { name: SCOPE_NAME, size: TIME_SCALE, channels: 1 },
    dust,
  );

  // Return stereo silence. The scope tap is kept alive via multiplication by 0
  // so dust still ticks even though we output silence.
  const silence = el.const({ value: 0 });
  const left = el.add(silence, el.mul(0, scopeInsert));
  const right = silence;

  return [left, right];
}
