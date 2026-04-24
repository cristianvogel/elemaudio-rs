
import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const FRAME_SCOPE_EVENT = "frame-shaper:scope";

export interface FrameShaperDemoParams {
  offset: number;
  shift: number;
  tilt: number;
  zoom: number;
  scale: number;
  wave: number;
  isStopped?: boolean;
}

export function buildGraph(p: FrameShaperDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const offset = el.const({ key: "fsd:offset", value: p.offset });
  const tilt = el.const({ key: "fsd:tilt", value: p.tilt });
  const zoom = el.const({ key: "fsd:zoom", value: p.zoom });
  const scale = el.const({ key: "fsd:scale", value: p.scale });
  const wave = el.const({ key: "fsd:wave", value: p.wave });
  const shift = el.const({ key: "fsd:shift", value: p.shift });

  const frameShaper = el.extra.frameShaper(
    { key: "fsd:shaper", framelength: FRAME_LENGTH },
    offset,
    shift,
    tilt,
    zoom,
    scale,
    wave,
  );

  const frameScope = el.extra.frameScope(
    { key: "fsd:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT },
    frameShaper,
  );

  const kept = el.add(0, el.mul(0, frameScope));
  return [kept, el.const({ value: 0 })];
}
/**
 * Copyright (c) 2026 NeverEngineLabs (www.neverenginelabs.com)
 * All rights reserved.
 *
 * Web UI composition source.
 * Not licensed for commercial derivatives or embedding in commercial products.
 */
