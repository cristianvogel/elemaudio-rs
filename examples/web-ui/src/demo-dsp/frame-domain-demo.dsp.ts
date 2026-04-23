
/**
 * Copyright (c) 2026 NeverEngineLabs (www.neverenginelabs.com)
 * All rights reserved.
 *
 * Web UI composition source.
 * Not licensed for commercial derivatives or embedding in commercial products.
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";

export const FRAME_LENGTH = 128;
export const FRAME_SCOPE_EVENT = "frame-domain:scope";

export interface FrameDomainDemoParams {
  offset: number;
  shift: number;
  curvature: number;
  scale: number;
  isStopped?: boolean;
}

export function buildGraph(p: FrameDomainDemoParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const offset = el.const({ key: "fdp:offset", value: p.offset });
  const curvature = el.const({ key: "fdp:curvature", value: p.curvature });
  const scale = el.const({ key: "fdp:scale", value: p.scale });
  const shift = el.const({ key: "fdp:shift", value: p.shift });

  const framePhasor = el.extra.framePhasor(
    { key: "fdp:phasor", framelength: FRAME_LENGTH },
    offset,
    shift,
    curvature,
    scale,
  );

  const frameScope = el.extra.frameScope(
    { key: "fdp:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT },
    framePhasor,
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
