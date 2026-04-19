import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const X_EVENT = "frame-domain:x";
export const Y_EVENT = "frame-domain:y";
export const PULSE_EVENT = "frame-domain:pulse";

export interface FrameDomainDemoParams {
  shift: number;
  tilt: number;
  scale: number;
  xIndex: number;
  yIndex: number;
  pulseIndex: number;
  isStopped?: boolean;
}

export function buildGraph(p: FrameDomainDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const shift = el.const({ key: "fdp:shift", value: p.shift });
  const tilt = el.const({ key: "fdp:tilt", value: p.tilt });
  const scale = el.const({ key: "fdp:scale", value: p.scale });

  const xIndex = el.const({ key: "fdp:xIndex", value: p.xIndex });
  const yIndex = el.const({ key: "fdp:yIndex", value: p.yIndex });
  const pulseIndex = el.const({ key: "fdp:pulseIndex", value: p.pulseIndex });

  const xSignal = el.extra.framePhasor({ key: "fdp:x", framelength: FRAME_LENGTH }, shift, tilt, scale);
  const ySignal = el.extra.framePhasor(
    { key: "fdp:y", framelength: FRAME_LENGTH },
    el.add(shift, 0.37),
    el.mul(tilt, -0.75),
    el.max(0.25, el.mul(scale, 0.92)),
  );
  const pulseSignal = el.extra.framePhasor(
    { key: "fdp:pulse", framelength: FRAME_LENGTH },
    el.add(shift, 0.63),
    el.mul(tilt, 0.5),
    el.min(1, el.mul(scale, 1.1)),
  );

  const xReadout = el.extra.frameValue(
    { key: "fdp:xReadout", framelength: FRAME_LENGTH, name: X_EVENT },
    xIndex,
    xSignal,
  );
  const yReadout = el.extra.frameValue(
    { key: "fdp:yReadout", framelength: FRAME_LENGTH, name: Y_EVENT },
    yIndex,
    ySignal,
  );
  const pulseReadout = el.extra.frameValue(
    { key: "fdp:pulseReadout", framelength: FRAME_LENGTH, name: PULSE_EVENT },
    pulseIndex,
    pulseSignal,
  );

  const silent = el.add(el.mul(0, xReadout), el.mul(0, yReadout), el.mul(0, pulseReadout));
  return [silent, silent];
}
