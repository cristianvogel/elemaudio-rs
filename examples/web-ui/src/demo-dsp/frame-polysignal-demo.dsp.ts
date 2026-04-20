import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";

export const FRAME_LENGTH = 128;
export const FRAME_SCOPE_EVENT = "frame-polysignal:scope";

export interface FramePolySignalDemoParams {
  rate: number;
  phaseSpread: number;
  rateSpread: number;
  resetCounter: number;
  isStopped?: boolean;
}

export function buildGraph(p: FramePolySignalDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const poly = el.extra.framePolySignal(
    {
        key: "fps:poly",
        framelength: FRAME_LENGTH,
        bpm: p.rate,
        // path: "fps:multi_lfo",
        resetcounter: p.resetCounter
    },
    el.const({ key: "fps:phaseSpread", value: p.phaseSpread }),
    el.const({ key: "fps:rateSpread", value: p.rateSpread }),
    0,
  );

  const makeOscillator = el.extra.frameWriteRAM( {framelength: FRAME_LENGTH, path: "fps:wtOscFromPoly"}, poly)

  const polyWtOsc = el.add( el.table( {path: 'fps:wtOscFromPoly' }, el.phasor(110)) , el.table( {path: 'fps:wtOscFromPoly' }, el.phasor(-110.5)));

  const scope = el.extra.frameScope(
    { key: "fps:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT },
    makeOscillator,
  );

  const left = el.add(el.mul(0, scope), el.mul(el.db2gain(-30)  , polyWtOsc));
  return [left, el.const({ value: 0 })];
}
