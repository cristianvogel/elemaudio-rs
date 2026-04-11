/**
 * Box-sum modulation DSP graph — smoothed noise modulating oscillator frequency.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import {TIME_SCALE} from "../components/Oscilloscope";

export const SCOPE_NAME = "boxsum-scope";

export interface BoxsumParams {
  mode: "sum" | "average";
  windowLength: number;
  toneHz: number;
  modRange: number;
  attenuation: number;
}

export function buildGraph(p: BoxsumParams): NodeRepr_t[] {
  const noise = el.noise({ key: "boxsum:noise", seed: 7 });
  const windowLength = el.const({ key: "boxsum:window", value: p.windowLength });
  const toneBaseFreq = el.const({ key: "oscFreq:0", value: p.toneHz });
  const modRange = el.const({ key: "boxModRange", value: p.modRange });
  const boxsumAttenuation = el.const({ key: "boxsum:attenuation", value: p.attenuation });

  const boxedNoise = el.select(
    p.mode === "average" ? 1 : 0,
    el.extra.boxAverage(windowLength, noise),
    el.mul(boxsumAttenuation, el.extra.boxSum(windowLength, noise))
  );

  const scaledBoxedNoise = el.mul(modRange, boxedNoise);
  const scopeInsert = el.scope({ name: SCOPE_NAME, size: TIME_SCALE, channels: 1 }, boxedNoise);

  const left = el.mul(0.25, el.blepsaw(el.abs(el.add(toneBaseFreq, scaledBoxedNoise))));
  const right = el.mul(0.25, el.blepsaw(el.abs(el.sub(toneBaseFreq, scaledBoxedNoise))));

  return [left, el.add(right, el.mul(0, scopeInsert))];
}
