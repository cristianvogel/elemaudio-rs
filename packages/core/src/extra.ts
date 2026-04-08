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
 * Props for `el.extra.limiter(...)`.
 */
export interface LimiterProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Optional constructor arg on the native effect; defaults to 100. */
  maxDelayMs?: number;
  /** pre-gain, amplifies the input before limiting */
  inputGain?: number;
  /** limit, maximum output amplitude */
  outputLimit?: number;
  /** attack, envelope smoothing time */
  attackMs?: number;
  /** hold, hold constant after peaks */
  holdMs?: number;
  /** release, extra release time (in addition to attack + hold) */
  releaseMs?: number;
  /** smoothing, smoothing filter(s) used for attack-smoothing */
  smoothingStages?: number;
  /** link, link channel gains together */
  linkChannels?: number;
}

/**
 * Props for `el.extra.boxSum(...)`.
 */
export interface BoxSumProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Box window width in Hz. */
  windowHz: number;
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

/**
 * Native lookahead limiter helper for a mono source node.
 */
export function limiter(props: LimiterProps, x: ElemNode): NodeRepr_t;
/**
 * Stereo alias for `el.extra.limiter(...)`.
 */
export function limiter(
  props: LimiterProps,
  left: ElemNode,
  right: ElemNode,
): Array<NodeRepr_t>;
/**
 * Native lookahead limiter helper.
 *
 * Use the mono overload for `el` nodes, or the stereo overload for left/right
 * pairs.
 */
export function limiter(
  props: LimiterProps,
  x: ElemNode,
  right?: ElemNode,
): NodeRepr_t | Array<NodeRepr_t> {
  const {
    maxDelayMs = 100,
    inputGain = 1,
    outputLimit = Math.pow(10, -3 / 20),
    attackMs = 20,
    holdMs = 0,
    releaseMs = 0,
    smoothingStages = 1,
    linkChannels = 0.5,
    ...other
  } = props;

  const resolvedProps = {
    ...other,
    maxDelayMs,
    inputGain,
    outputLimit,
    attackMs,
    holdMs,
    releaseMs,
    smoothingStages,
    linkChannels,
  };

  if (right === undefined) {
    return createNode("limiter", resolvedProps, [resolve(x)]);
  }

  return unpack(
    createNode("limiter", resolvedProps, [resolve(x), resolve(right)]),
    2,
  );
}

/**
 * Stereo alias for `el.extra.limiter(...)`.
 */
export function stereoLimiter(
  props: LimiterProps,
  left: ElemNode,
  right: ElemNode,
): Array<NodeRepr_t> {
  return limiter(props, left, right) as Array<NodeRepr_t>;
}

/**
 * Raw variable-width box sum for a mono source node.
 */
export function boxSum(props: BoxSumProps, x: ElemNode): NodeRepr_t {
  return createNode("boxsum", props, [resolve(x)]);
}

/**
 * Modes for `el.extra.strideDelay(...)`.
 */
export type StrideDelayMode = "linear" | "dualStride" | "step";

/**
 * Props for `el.extra.strideDelay(...)`.
 */
export interface StrideDelayProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Maximum delay buffer length in milliseconds. */
  maxDelayMs?: number;
  /** Target delay time in milliseconds. */
  delayMs: number;
  /** Feedback amount. */
  fb?: number;
  /** Crossfade length in milliseconds. */
  transitionMs?: number;
  /** Large-jump interpolation mode. */
  mode?: StrideDelayMode;
}

/**
 * Stride-interpolated delay for a mono source node.
 */
export function strideDelay(props: StrideDelayProps, x: ElemNode): NodeRepr_t;
/**
 * Stereo alias for `el.extra.strideDelay(...)`.
 */
export function strideDelay(
  props: StrideDelayProps,
  left: ElemNode,
  right: ElemNode,
): Array<NodeRepr_t>;
/**
 * Stride-interpolated delay.
 *
 * The mono overload accepts a single `el` node. The stereo overload accepts
 * explicit left/right inputs.
 */
export function strideDelay(
  props: StrideDelayProps,
  x: ElemNode,
  right?: ElemNode,
): NodeRepr_t | Array<NodeRepr_t> {
  const {
    maxDelayMs = 1000,
    delayMs,
    fb = 0,
    transitionMs = 100,
    mode = "dualStride",
    ...other
  } = props;

  const resolvedProps = {
    ...other,
    maxDelayMs,
    delayMs,
    fb,
    transitionMs,
    mode,
  };

  if (right === undefined) {
    return createNode("stridedelay", resolvedProps, [resolve(x)]);
  }

  return unpack(
    createNode("stridedelay", resolvedProps, [resolve(x), resolve(right)]),
    2,
  );
}

/**
 * Stereo alias for `el.extra.strideDelay(...)`.
 */
export function stereoStrideDelay(
  props: StrideDelayProps,
  left: ElemNode,
  right: ElemNode,
): Array<NodeRepr_t> {
  return strideDelay(props, left, right) as Array<NodeRepr_t>;
}
