import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const FRAME_SCOPE_EVENT = "frame-polysignal:scope";

export interface FramePolySignalDemoParams {
  rate: number;
  phaseSpread: number;
  rateSpread: number;
  isStopped?: boolean;
}

export function buildGraph(p: FramePolySignalDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const poly = el.extra.framePolySignal(
    { key: "fps:poly", framelength: FRAME_LENGTH, bpm: p.rate, path: "fps:multi_lfo" },
    el.const({ key: "fps:phaseSpread", value: p.phaseSpread }),
    el.const({ key: "fps:rateSpread", value: p.rateSpread }),
    0,
  );

  const scope = el.extra.frameScope(
    { key: "fps:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT },
    poly,
  );

  const kept = el.add(0, el.mul(0, scope));
  return [kept, el.const({ value: 0 })];
}
