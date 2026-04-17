/**
 * Sample playback DSP graph — sample + freq shift + convolution with dry/wet.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export interface SampleParams {
  samplePath: string;
  sampleChannels: number;
  rate: number;
  blend: number;
  leftIrPath: string;
  rightIrPath: string;
  isStopped?: boolean;
}

export function buildGraph(p: SampleParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }
  const trigger = el.train(0.1);
  const blendNode = el.const({ value: p.blend });

  if (p.sampleChannels > 1) {
    const source = el.mc.sample(
      { path: p.samplePath, playbackRate: p.rate, channels: p.sampleChannels },
      trigger
    );
    const leftSource = source[0];
    const rightSource = source[1] ?? source[0];
    const leftShiftDown = el.extra.freqshift({ shiftHz: 100, mix: 1.0, key: "fshift_Left", reflect: 3 }, leftSource)[0];
    const rightShiftDown = el.extra.freqshift({ shiftHz: 300, mix: 1.0, key: "fshift_Right", reflect: 3 }, rightSource)[0];
    const leftWet = el.convolve({ key: "ir-left", path: p.leftIrPath }, el.mul(1.0e-3, leftShiftDown));
    const rightWet = el.convolve({ key: "ir-right", path: p.rightIrPath }, el.mul(1.0e-3, rightShiftDown));

    return [
      el.mul(0.5, el.select(blendNode, leftWet, leftShiftDown)),
      el.mul(0.5, el.select(blendNode, rightWet, rightShiftDown)),
    ];
  }

  const source = el.sample({ path: p.samplePath }, trigger, el.const({ value: p.rate }));
  const shiftDown = el.extra.freqshift({ shiftHz: 100, mix: 1.0, key: "mono_fshift_down", reflect: 3 }, source)[0];
  const shiftUp = el.extra.freqshift({ shiftHz: 100, mix: 1.0, key: "mono_fshift_up", reflect: 3 }, source)[1];
  const leftWet = el.convolve({ key: "ir-left", path: p.leftIrPath }, el.mul(1.0e-3, shiftDown));
  const rightWet = el.convolve({ key: "ir-right", path: p.rightIrPath }, el.mul(1.0e-3, shiftUp));

  return [
    el.mul(0.5, el.select(blendNode, leftWet, shiftDown)),
    el.mul(0.5, el.select(blendNode, rightWet, shiftUp)),
  ];
}
