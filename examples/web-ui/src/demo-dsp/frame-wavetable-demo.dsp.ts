import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const RAM_PATH = "wf/ram/frame-wavetable";
export const FRAME_SCOPE_EVENT = "frame-wavetable:scope";

export interface FrameWavetableDemoParams {
  modulate: number;
  shift: number;
  tilt: number;
  zoom: number;
  scale: number;
  wave: number;
  frequency: number;
  level: number;
  isStopped?: boolean;
}

export function buildGraph(p: FrameWavetableDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const frameShaper = el.extra.frameShaper(
    { key: "fwt:shaper", framelength: FRAME_LENGTH },
    el.const({ key: "fwt:offset", value: 0 }),
    el.const({ key: "fwt:shift", value: p.shift }),
    el.const({ key: "fwt:tilt", value: p.tilt }),
    el.const({ key: "fwt:zoom", value: p.zoom }),
    el.const({ key: "fwt:scale", value: p.scale }),
    el.const({ key: "fwt:wave", value: p.wave }),
  );

  const rampShaper = el.extra.framePhasor(
    { key: "fwt:rwRamp", framelength: FRAME_LENGTH },
    -1,
    0,
    0,
    2,
  );

  const randomWalks = el.extra.frameRandomWalks(
    {
      key: "fwt:randomWalks",
      framelength: FRAME_LENGTH,
      seed: 17,
      interpolation: true,
      startingfrom: 0,
      initialdeviation: 0.1,
    },
    0.08,
    0.12,
    el.mul(0.45, rampShaper),
    el.mul(0.35, el.mul(-1, rampShaper)),
  );

  const frame = el.min(
    1,
    el.max(
      -1,
      el.add(
        frameShaper,
        el.mul(el.const({ key: "fwt:modulate", value: p.modulate }), randomWalks),
      ),
    ),
  );

  const writer = el.extra.frameWriteRAM(
    { key: "fwt:writer", framelength: FRAME_LENGTH, path: RAM_PATH },
    frame,
  );

  const frameScope = el.extra.frameScope(
    { key: "fwt:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT },
    frame,
  );

  const phase = el.phasor(el.const({ key: "fwt:freq", value: p.frequency }));
  const osc = el.mul(
    el.const({ key: "fwt:level", value: p.level }),
    el.table({ path: RAM_PATH }, phase),
  );

  const left = el.add(el.mul(0, writer, frameScope), osc);
  return [left, osc];
}
