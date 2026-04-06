// Building extra nodes is quite involved
// it currently requires having the massive EMSDK on the global path
// example:
// source ~/toolchains/emsdk/emsdk_env.sh
// this is needed to rebuild the vendor WASM core


import { createNode, resolve, unpack } from "./vendor";
import type { ElemNode, NodeRepr_t } from "./vendor";

export type FreqShiftReflectMode = 0 | 1 | 2 | 3;

export interface FreqShiftProps {
  key?: string;
  shiftHz: number;
  mix?: number;
  reflect?: FreqShiftReflectMode;
}

export function freqshift(
  props: FreqShiftProps,
  x: ElemNode,
): Array<NodeRepr_t> {
  return unpack(createNode("freqshift", props, [resolve(x)]), 2);
}
