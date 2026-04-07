import { createNode, resolve, unpack } from "./vendor";
import type { ElemNode, NodeRepr_t } from "./vendor";

/**
 * Reflect modes for `freqshift`.
 *
 * These values match the native processor's integer `reflect` prop.
 */
export type FreqShiftReflectMode = 0 | 1 | 2 | 3;

/**
 * Props for `el.extra.freqshift(...)`.
 */
export interface FreqShiftProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Frequency shift amount in Hz. */
  shiftHz: number;
  /** Wet mix in the range `0.0..=1.0`. */
  mix?: number;
  /** Negative-frequency handling mode. */
  reflect?: FreqShiftReflectMode;
}

/**
 * Props for `el.extra.crunch(...)`.
 */
export interface CrunchProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Number of output channels to unpack. */
  channels: number;
  /** Pre-distortion input gain. */
  drive?: number;
  /** Amplitude-independent distortion amount. */
  fuzz?: number;
  /** Tone control frequency in Hz. */
  toneHz?: number;
  /** Pre-distortion high-pass cutoff in Hz. */
  cutHz?: number;
  /** Final output gain. */
  outGain?: number;
  /** Enables auto-gain compensation. */
  autoGain?: boolean;
}

/**
 * Native frequency shifter helper.
 *
 * Returns two outputs in order: down-shifted, then up-shifted.
 */
export function freqshift(
  props: FreqShiftProps,
  x: ElemNode,
): Array<NodeRepr_t> {
  return unpack(createNode("freqshift", props, [resolve(x)]), 2);
}

/**
 * Native crunch distortion helper.
 *
 * Returns one root per output channel.
 */
export function crunch(
  props: CrunchProps,
  x: ElemNode,
): Array<NodeRepr_t> {
  const { channels, ...other } = props;

  if (!Number.isFinite(channels) || channels <= 0) {
    throw new Error("crunch requires a positive channels prop");
  }

  return unpack(createNode("crunch", other, [resolve(x)]), channels);
}
