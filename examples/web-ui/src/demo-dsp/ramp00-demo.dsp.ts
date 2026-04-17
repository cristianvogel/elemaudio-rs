/**
 * ramp00 one-shot + blocked-retrigger DSP graph.
 *
 * Demonstrates `el.extra.ramp00` as a sample-accurate one-shot envelope that
 * deliberately ignores retriggers while running. A random trigger source
 * (latch of `el.rand` clocked by `el.train`) fires rapidly; many of those
 * attempted retriggers land mid-ramp and are suppressed by the `blocking`
 * prop. Authors can toggle blocking off to visually compare.
 *
 * No audio: the graph is silenced on both stereo returns; the scope tap is
 * kept alive via a `mul(0, …)` reference so the renderer does not prune it.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import { TIME_SCALE } from "../components/Oscilloscope";

export const SCOPE_NAME = "ramp00-scope";

export interface Ramp00DemoParams {
  /** Ramp duration in milliseconds (converted internally to samples). */
  durMs: number;
  /** Clock rate in Hz at which new random values are latched. */
  clockHz: number;
  /** Random threshold in [0, 1]: higher = fewer trigger attempts. */
  threshold: number;
  /** When true, mid-ramp retrigger attempts are ignored (blocking=true). */
  blocking: boolean;
}

export function buildGraph(p: Ramp00DemoParams): NodeRepr_t[] {
  // --- control knobs (keyed consts → fast-path parameter updates) ---
  const clockHz = el.const({ key: "ramp00:clockHz", value: p.clockHz });
  const threshold = el.const({ key: "ramp00:threshold", value: p.threshold });
  const durMs = el.const({ key: "ramp00:durMs", value: p.durMs });

  // --- random trigger source ---
  //
  //   rand           : uniform [0, 1), new value every sample
  //   train(clockHz) : square wave, rising edge every 1/clockHz seconds
  //   latch(t, x)    : sample-and-hold — snapshot `x` whenever `t` rises
  //   ge(latched, T) : gate goes high when latched value >= threshold
  //
  // Net effect: at each clock tick, roll a fresh die. If it lands above
  // threshold, raise the gate; otherwise keep it low. This drives the ramp
  // at a stochastic, visually irregular rate that exercises retrigger
  // behavior — which is exactly the point of the `blocking` prop.
  const clock = el.train(clockHz);
  const sampled = el.latch(clock, el.rand({ key: "ramp00:rand", seed: 1 }));
  const triggerGate = el.ge(sampled, threshold);

  // --- the ramp ---
  //
  // dur arrives as a per-sample signal (ms2samps is a div-by-sr node), so
  // the user can drag the ms slider while the ramp is running and the
  // slope updates continuously without restarting the ramp.
  const ramp = el.extra.ramp00(
    { key: "ramp00:main", blocking: p.blocking },
    el.ms2samps(durMs),
    triggerGate,
  );

  // --- scope tap ---
  //
  // `el.scope(...)` emits Float32Array blocks back to the renderer via
  // `renderer.on("scope", ...)`. We show the ramp itself (channel 0).
  const scopeInsert = el.scope(
    { name: SCOPE_NAME, size: TIME_SCALE, channels: 1 },
    ramp,
  );

  // --- silenced stereo return ---
  //
  // Harness always connects the worklet to destination. Multiplying by 0
  // keeps the scope node alive in the dependency graph while producing no
  // audio. Both channels reference `scopeInsert` so the renderer cannot
  // prune either branch.
  const silent = el.mul(0, scopeInsert);
  return [silent, silent];
}
