
import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const RANDOM_WALKS_SCOPE_EVENT = "frame-random-walks:scope";
export const RANDOM_WALKS_SHAPER_EVENT = "frame-random-walks:shaper";

export interface FrameRandomWalksDemoParams {
  stepSize: number;
  timeConstant: number;
  stepShape: number;
  timeShape: number;
  startingFrom: number;
  initialDeviation: number;
  absolute: boolean;
  interpolation: boolean;
  isStopped?: boolean;
}

export function buildGraph(p: FrameRandomWalksDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const stepSize = el.const({ key: "frw:stepSize", value: p.stepSize });
  const timeConstant = el.const({ key: "frw:timeConstant", value: p.timeConstant });
  const stepShape = el.const({ key: "frw:stepShape", value: p.stepShape });
  const timeShape = el.const({ key: "frw:timeShape", value: p.timeShape });

  const rampShaper = el.extra.framePhasor(
    { key: "frw:rampShaper", framelength: FRAME_LENGTH },
    -1,
    0,
    0,
    2,
  );

  const stepSizeFrameShaper = el.mul(stepShape, rampShaper);
  const timeConstantFrameShaper = el.mul(timeShape, el.mul(-1, rampShaper));

  const frameRandomWalks = el.extra.frameRandomWalks(
    {
      key: "frw:randomWalks",
      framelength: FRAME_LENGTH,
      seed: 7,
      absolute: p.absolute,
      interpolation: p.interpolation,
      startingfrom: p.startingFrom,
      initialdeviation: p.initialDeviation,
    },
    stepSize,
    timeConstant,
    stepSizeFrameShaper,
    timeConstantFrameShaper,
  );

  const randomWalkScope = el.extra.frameScope(
    { key: "frw:scope", framelength: FRAME_LENGTH, name: RANDOM_WALKS_SCOPE_EVENT },
    frameRandomWalks,
  );

  const shaperScope = el.extra.frameScope(
    { key: "frw:shaperScope", framelength: FRAME_LENGTH, name: RANDOM_WALKS_SHAPER_EVENT },
    rampShaper,
  );

  const kept = el.add(0, el.mul(0, randomWalkScope, shaperScope));
  return [kept, el.const({ value: 0 })];
}
/**
 * Copyright (c) 2026 NeverEngineLabs (www.neverenginelabs.com)
 * All rights reserved.
 *
 * Web UI composition source.
 * Not licensed for commercial derivatives or embedding in commercial products.
 */
