import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const RAM_PATH = "wf/ram/frame-wavetable";
export const FRAME_SCOPE_EVENT = "frame-wavetable:scope";

export interface FrameWavetableDemoParams {
  modulate: number;
  smooth: number;
  smoothShape: number;
  bidiSmooth: boolean;
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

  const smoothedFrame = el.extra.frameSmooth(
    { key: "fwt:smooth", framelength: FRAME_LENGTH },
    el.const({ key: "fwt:smoothTime", value: p.smooth }),
    el.mul(el.const({ key: "fwt:smoothShape", value: p.smoothShape }), rampShaper),
    frame,
  );

  const bidiSmoothedFrame = el.extra.frameBiDiSmooth(
    { key: "fwt:bidiSmooth", framelength: FRAME_LENGTH },
    el.const({ key: "fwt:attackTime", value: p.smooth * 0.5 }),
    el.const({ key: "fwt:releaseTime", value: p.smooth * 2.0 }),
    el.mul(el.const({ key: "fwt:attackShape", value: p.smoothShape }), rampShaper),
    el.mul(el.const({ key: "fwt:releaseShape", value: p.smoothShape }), rampShaper),
    frame,
  );

  const finalFrame = el.select(
    el.const({ key: "fwt:abMode", value: p.bidiSmooth ? 1 : 0 }),
    bidiSmoothedFrame,
    smoothedFrame,
  );

  const writer = el.extra.frameWriteRAM(
    { key: "fwt:writer", framelength: FRAME_LENGTH, path: RAM_PATH },
    finalFrame,
  );

  const frameScope = el.extra.frameScope(
    { key: "fwt:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT },
    finalFrame,
  );

  const chordClock = el.train(0.045);
  const reset = 0;

  const chordVoices = [
    [0, -3, -5, -2],
    [4, 0, 2, 5],
    [7, 9, 10, 9],
    [11, 14, 12, 16],
  ];
  const pans = [-0.82, -0.28, 0.24, 0.78];
  const detunes = [0.997, 1.002, 1.006, 0.994];
  const motionRates = [0.031, 0.041, 0.053, 0.067];
  const voiceLevels = [0.32, 0.27, 0.24, 0.21];

  const root = el.const({ key: "fwt:root", value: p.frequency });
  const voices = chordVoices.map((intervals, index) => {
    const hz = el.seq({ key: `fwt:voice:${index}:seq`, seq: intervals.map((semi) => p.frequency * Math.pow(2, semi / 12)), hold: true }, chordClock, reset);
    const drift = el.mul(0.0035 * (index + 1), el.cycle(motionRates[index]));
    const freq = el.mul(detunes[index], el.add(hz, el.mul(root, drift)));
    const phase = el.phasor(freq);
    const amp = el.mul(p.level, voiceLevels[index], el.table({ path: RAM_PATH }, phase));
    const leftGain = (1 - pans[index]) * 0.5;
    const rightGain = (1 + pans[index]) * 0.5;
    return [el.mul(leftGain, amp), el.mul(rightGain, amp)];
  });

  const left = el.add(el.mul(0, writer, frameScope), ...voices.map((voice) => voice[0]));
  const right = el.add(...voices.map((voice) => voice[1]));
  return [left, right];
}
