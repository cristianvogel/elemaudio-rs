/**
 * Waveshaper DSP graph — foldback shaper with dry/wet mix and scope insert.
 * Supports oscillator or sample-based source selection.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import {TIME_SCALE} from "../components/Oscilloscope";

export const SCOPE_NAME = "waveshaper-scope";

export type SourceMode = "oscillator" | "sample";

export interface WaveshaperParams {
  source: SourceMode;
  freq: number;
  cutOff: number;
  /** Continuous filter order [1.0, 6.0] mapped to 12–72 dB/oct. */
  slope: number;
  filterType: "highpass" | "lowpass";
  drive: number;
  thresh: number;
  amp: number;
  mix: number;
  /** Required when a source is "sample". VFS path registered by the demo. */
  samplePath?: string;
  isStopped?: boolean;
}

export function buildGraph(p: WaveshaperParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }
  let raw: NodeRepr_t;

  if (p.source === "sample" && p.samplePath) {
    raw = el.sample(
      { key: "waveshaper:sample", path: p.samplePath, mode: "loop" },
      1,
      el.const({ key: "waveshaper:rate", value: 1 })
    );
  } else {
    raw = el.cycle(el.const({ key: "waveshaper:freq", value: p.freq }));
  }

  const drive = el.const({ key: "waveshaper:drive", value: p.drive });

  const cutoff = el.const({ key: "waveshaper:cutoff", value: p.cutOff });

  const mix = el.const({ key: "waveshaper:mix", value: p.mix });

  const source = el.mul(drive, raw);

  const shaped = el.extra.foldback({ key: "foldback:0", thresh: p.thresh, amp: p.amp }, source);

  // variSlopeSvf: slope is a continuous signal [1.0, 6.0]. Q is fixed at
  // Butterworth internally — not exposed.
  const slope = el.const({ key: "waveshaper:slope", value: Math.max(1, Math.min(6, p.slope)) });
  const filtered = el.extra.variSlopeSvf({ filterType: p.filterType }, cutoff, shaped, slope);

  const mixed = el.mul(0.25, el.select( mix, filtered, source));

  const scopeInsert = el.scope({ name: SCOPE_NAME, size: TIME_SCALE, channels: 1 }, shaped);

  const left = mixed;
  const right = el.add(mixed, el.mul(0, scopeInsert));

  return [left, right];
}
