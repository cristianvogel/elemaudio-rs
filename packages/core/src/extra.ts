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
 * Props for `el.extra.foldback(...)`.
 *
 * Supports the fast-path keying system for parameter updates:
 * - `key`: Optional prefix for stable node identity
 * - Derived keys: `{key}_thresh`, `{key}_amp`
 * - Fast-path updates: `mounted.node_with_key("{key}_thresh")`
 */
export interface FoldbackProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity (enables fast-path updates). */
  key?: string;
  /** Fold threshold. Must be positive. */
  thresh: number;
  /** Post amplification. Defaults to `1 / thresh`. */
  amp?: number;
}

/**
 * Props for `el.extra.boxSum(...)`.
 *
 * Supports the fast-path keying system for parameter updates:
 * - `key`: Optional prefix for stable node identity
 * - Derived keys: `{key}_window`
 * - Fast-path updates: `mounted.node_with_key("{key}_window")`
 */
export interface BoxSumProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity (enables fast-path updates). */
  key?: string;
  /** Window length in samples. Must be positive. */
  window: number;
}

/**
 * Props for `el.extra.boxAverage(...)`.
 *
 * Supports the fast-path keying system for parameter updates:
 * - `key`: Optional prefix for stable node identity
 * - Derived keys: `{key}_window`
 * - Fast-path updates: `mounted.node_with_key("{key}_window")`
 */
export interface BoxAverageProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity (enables fast-path updates). */
  key?: string;
  /** Window length in samples. Must be positive. */
  window: number;
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
 * Recursive foldback shaper helper.
 *
 * Supports the fast-path keying system for parameter updates without graph rebuild.
 *
 * @example
 * ```typescript
 * const graph = el.Graph().render(
 *   el.extra.foldback(
 *     { key: "shaper", thresh: 0.5, amp: 2.0 },
 *     el.cycle(el.const_(440))
 *   )
 * );
 *
 * const mounted = graph.mount();
 * runtime.execute(mounted.batch());
 *
 * // Later, update threshold without graph rebuild
 * const threshNode = mounted.node_with_key("shaper_thresh");
 * if (threshNode) {
 *   runtime.execute(threshNode.set_const_value(0.7));
 * }
 * ```
 */
export function foldback(props: FoldbackProps, x: ElemNode): NodeRepr_t {
  const { key, thresh, amp = 1 / thresh, ...other } = props;

  if (!Number.isFinite(thresh) || thresh <= 0) {
    throw new Error("foldback requires a positive thresh prop");
  }

  // Create keyed or unnamed const nodes based on whether a key prefix was supplied
  const threshNode = key
    ? createNode("const", { key: `${key}_thresh`, value: thresh }, [])
    : createNode("const", { value: thresh }, []);

  const ampNode = key
    ? createNode("const", { key: `${key}_amp`, value: amp }, [])
    : createNode("const", { value: amp }, []);

  const one = createNode("const", { value: 1 }, []);
  const folded = createNode("sub", {}, [
    createNode("abs", {}, [
      createNode("sub", {}, [
        createNode("abs", {}, [
          createNode("mod", {}, [
            createNode("sub", {}, [resolve(x), threshNode]),
            createNode("mul", {}, [createNode("const", { value: 4 }, []), threshNode]),
          ]),
        ]),
        createNode("mul", {}, [createNode("const", { value: 2 }, []), threshNode]),
      ]),
    ]),
    threshNode,
  ]);
  const shouldFold = createNode("ge", {}, [createNode("abs", {}, [resolve(x)]), threshNode]);

  // select(g, a, b) = add(mul(g, a), mul(sub(1, g), b))
  const selected = createNode("add", {}, [
    createNode("mul", {}, [shouldFold, folded]),
    createNode("mul", {}, [createNode("sub", {}, [one, shouldFold]), resolve(x)]),
  ]);

  return createNode("mul", other, [ampNode, selected]);
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
 * Raw variable-width box sum helper with static window (keying support).
 */
export function boxSum(props: BoxSumProps, x: ElemNode): NodeRepr_t;
/**
 * Raw variable-width box sum helper with dynamic window signal.
 */
export function boxSum(window: ElemNode, x: ElemNode): NodeRepr_t;
/**
 * Raw variable-width box sum helper.
 *
 * Computes a box-filter sum over a configurable window length.
 *
 * Supports two usage patterns:
 * 1. **Static window with keying**: Pass props with `window` and `key` for fast-path updates
 * 2. **Dynamic window signal**: Pass a signal node for sample-rate accurate modulation
 *
 * @example
 * ```typescript
 * // Static window with keying
 * const graph = el.Graph().render(
 *   el.extra.boxSum(
 *     { key: "filter", window: 256 },
 *     el.cycle(el.const_(440))
 *   )
 * );
 *
 * const mounted = graph.mount();
 * runtime.execute(mounted.batch());
 *
 * // Later, update window size without graph rebuild
 * const windowNode = mounted.node_with_key("filter_window");
 * if (windowNode) {
 *   runtime.execute(windowNode.set_const_value(512));
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Dynamic window signal for sample-rate modulation
 * const windowLfo = el.mul(
 *   el.add(el.const_(256), el.const_(128)),
 *   el.cycle(el.const_(0.5))  // 0.5 Hz LFO
 * );
 *
 * const graph = el.Graph().render(
 *   el.extra.boxSum(windowLfo, el.white())
 * );
 *
 * const mounted = graph.mount();
 * runtime.execute(mounted.batch());
 * ```
 */
export function boxSum(
  windowOrProps: BoxSumProps | ElemNode,
  x: ElemNode
): NodeRepr_t {
  // Handle props (keying support)
  if (
    windowOrProps !== null &&
    typeof windowOrProps === "object" &&
    "window" in windowOrProps
  ) {
    const props = windowOrProps as BoxSumProps;
    const { key, window, ...other } = props;

    if (!Number.isFinite(window) || window <= 0) {
      throw new Error("boxSum requires a positive window prop");
    }

    // Create keyed or unnamed const node based on whether a key prefix was supplied
    const windowNode = key
      ? createNode("const", { key: `${key}_window`, value: window }, [])
      : createNode("const", { value: window }, []);

    return createNode("boxsum", other, [windowNode, resolve(x)]);
  }

  // Handle signal (no keying support)
  return createNode("boxsum", {}, [resolve(windowOrProps), resolve(x)]);
}

/**
 * Raw variable-width box average helper with static window (keying support).
 */
export function boxAverage(props: BoxAverageProps, x: ElemNode): NodeRepr_t;
/**
 * Raw variable-width box average helper with dynamic window signal.
 */
export function boxAverage(window: ElemNode, x: ElemNode): NodeRepr_t;
/**
 * Raw variable-width box average helper.
 *
 * Computes a box-filter average over a configurable window length.
 *
 * Supports two usage patterns:
 * 1. **Static window with keying**: Pass props with `window` and `key` for fast-path updates
 * 2. **Dynamic window signal**: Pass a signal node for sample-rate accurate modulation
 *
 * @example
 * ```typescript
 * // Static window with keying
 * const graph = el.Graph().render(
 *   el.extra.boxAverage(
 *     { key: "avg", window: 256 },
 *     el.cycle(el.const_(440))
 *   )
 * );
 *
 * const mounted = graph.mount();
 * runtime.execute(mounted.batch());
 *
 * // Later, update window size without graph rebuild
 * const windowNode = mounted.node_with_key("avg_window");
 * if (windowNode) {
 *   runtime.execute(windowNode.set_const_value(512));
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Dynamic window signal for sample-rate modulation
 * const windowEnvelope = el.mul(
 *   el.const_(512),
 *   el.ad(el.const_(100), el.const_(500), el.const_(0))
 * );
 *
 * const graph = el.Graph().render(
 *   el.extra.boxAverage(windowEnvelope, el.white())
 * );
 *
 * const mounted = graph.mount();
 * runtime.execute(mounted.batch());
 * ```
 */
export function boxAverage(
  windowOrProps: BoxAverageProps | ElemNode,
  x: ElemNode
): NodeRepr_t {
  // Handle props (keying support)
  if (
    windowOrProps !== null &&
    typeof windowOrProps === "object" &&
    "window" in windowOrProps
  ) {
    const props = windowOrProps as BoxAverageProps;
    const { key, window, ...other } = props;

    if (!Number.isFinite(window) || window <= 0) {
      throw new Error("boxAverage requires a positive window prop");
    }

    // Create keyed or unnamed const node based on whether a key prefix was supplied
    const windowNode = key
      ? createNode("const", { key: `${key}_window`, value: window }, [])
      : createNode("const", { value: window }, []);

    return createNode("boxaverage", other, [windowNode, resolve(x)]);
  }

  // Handle signal (no keying support)
  return createNode("boxaverage", {}, [resolve(windowOrProps), resolve(x)]);
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
