import { createNode, resolve, unpack } from "./vendor";
import type { ElemNode, NodeRepr_t } from "./vendor";

/**
 * Reflect modes for `freqshift`.
 *
 * These values match the native processor's integer `reflect` prop and only
 * affect negative `shiftHz` values.
 *
 * - `0`: no reflection, no output swap
 * - `1`: reflect negative shift to positive magnitude
 * - `2`: swap lower/upper outputs for negative shift
 * - `3`: reflect negative shift and swap outputs
 */
export type FreqShiftReflectMode = 0 | 1 | 2 | 3;

/** Selects which split band feeds the optional internal feedback loop. */
export type FreqShiftFeedbackSource = "lower" | "upper";

/**
 * Props for `el.extra.freqshift(...)`.
 */
export interface FreqShiftProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Negative-frequency handling mode. */
  reflect?: FreqShiftReflectMode;
  /** Which semantic output band feeds the internal feedback loop. Default: `"lower"`. */
  fbSource?: FreqShiftFeedbackSource;
}

/**
 * Props for `el.extra.convolve(...)`.
 */
export interface ExtraConvolveProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Shared resource id for the impulse response. */
  path: string;
  /** Optional normalized IR start position in `[0, 1]`. */
  start?: number;
  /** Optional normalized IR end position in `[0, 1]`. */
  end?: number;
  /** Optional positive IR playback-rate multiplier. Values above 1 shorten the response; values below 1 stretch it. */
  rate?: number;
  /** Optional wet-output attenuation in dB. Uses positive dB values, applied as attenuation. */
  irAttenuationDb?: number;
  /** Enables realtime input normalization based on the loaded IR gain estimate. */
  normalize?: boolean;
}

/**
 * Props for `el.extra.convolveSpectral(...)`.
 */
export interface ConvolveSpectralProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Shared resource id for the impulse response. */
  path: string;
  /** Optional power-of-two IR edit partition size. Non-powers are rounded up natively. */
  partitionSize?: number;
  /** Optional tail block size for the internal convolver. Non-powers are rounded up natively. */
  tailBlockSize?: number;
  /** Optional global spectral magnitude gain in dB. */
  magnitudeGainDb?: number;
  /** Optional fallback spectral tilt in dB/octave, referenced to Nyquist. */
  tiltDbPerOct?: number;
  /** Optional fallback partition-to-partition magnitude smoothing in [0, 1). */
  blur?: number;
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
 * Props for {@link vocoder}.
 */
export interface VocoderProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** FFT window length in ms (1–100, default 10). */
  windowMs?: number;
  /** Energy envelope smoothing in ms (0–2000, default 5). High values produce sustained spectral blur. */
  smoothingMs?: number;
  /** Per-band gain ceiling in dB (0–100, default 40). */
  maxGainDb?: number;
}

/**
 * Filter mode for {@link variSlopeSvf}.
 */
export type VariSlopeFilterType = "highpass" | "lowpass";

/**
 * Props for {@link variSlopeSvf}.
 *
 * Q is fixed internally at Butterworth and is not exposed.
 */
export interface VariSlopeSvfProps extends Record<string, unknown> {
  /** Filter mode: "lowpass" / "lp" or "highpass" / "hp". Default: "lowpass". */
  filterType?: VariSlopeFilterType;
}

/**
 * Native frequency shifter helper.
 *
 * Returns two outputs in fixed order: lower sideband, then upper sideband.
 *
 * Props:
 * - `reflect`: negative shift handling mode (default: `0`)
 * - `fbSource`: which output band feeds the internal feedback loop (default: `"lower"`)
 *
 * Child order:
 * - `shiftHz`: audio-rate shift amount in Hz
 * - `feedback`: audio-rate feedback amount (clamped per-sample to [0, 0.999])
 * - `x`: audio input
 */
export function freqshift(
  props: FreqShiftProps,
  shiftHz: ElemNode,
  feedback: ElemNode,
  x: ElemNode,
): Array<NodeRepr_t> {
  return unpack(createNode("freqshift", props, [resolve(shiftHz), resolve(feedback), resolve(x)]), 2);
}

/**
 * Extended convolution helper.
 *
 * Props:
 * - `path`: shared resource id for the impulse response
 * - `start`: optional normalized IR start position in `[0, 1]`
 * - `end`: optional normalized IR end position in `[0, 1]`
 * - `rate`: optional positive IR playback-rate multiplier
 * - `irAttenuationDb`: optional wet-output attenuation in dB
 * - `normalize`: optional realtime input normalization toggle
 *
 * Child order:
 * - `x`: audio input
 */
export function convolve(
  props: ExtraConvolveProps,
  x: ElemNode,
): NodeRepr_t {
  return createNode("extra.convolve", props, [resolve(x)]);
}

/**
 * Prototype convolution helper with fixed-size magnitude-only spectral IR edits.
 *
 * Props:
 * - `path`: shared resource id for the impulse response
 * - `partitionSize`: optional power-of-two IR edit partition size
 * - `tailBlockSize`: optional tail block size for the internal convolver
 * - `magnitudeGainDb`: optional global spectral magnitude gain in dB
 * - `tiltDbPerOct`: optional fallback spectral tilt applied around Nyquist
 * - `blur`: optional fallback partition-to-partition magnitude smoothing in [0, 1)
 *
 * Child order:
 * - `tiltDbPerOct`: frame-latched spectral tilt signal in dB/octave
 * - `blur`: frame-latched partition-to-partition magnitude smoothing signal in [0, 1)
 * - `x`: audio input
 */
export function convolveSpectral(
  props: ConvolveSpectralProps,
  tiltDbPerOct: ElemNode,
  blur: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  return createNode("extra.convolveSpectral", props, [resolve(tiltDbPerOct), resolve(blur), resolve(x)]);
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
 * VariSlope SVF — cascaded Butterworth SVF with Rossum-style continuous slope morphing.
 *
 * @remarks
 * Defining feature: `slope` is a continuous per-sample audio signal in
 * [1.0, 6.0] that blends smoothly between 1–6 cascaded second-order Butterworth
 * SVF stages (12–72 dB/oct) inspired by Dave Rossum's analog cascade designs.
 * All six stages run every sample so their integrator states remain warm;
 * the output crossfades between adjacent integer-order outputs so the filter
 * order morphs without clicks or dropout.
 *
 * Q is fixed internally at Butterworth (sqrt(2), maximally flat magnitude) and
 * is not exposed. The slope is the sole tonal control.
 *
 * Per-stage gain correction (matched magnitude at cutoff) prevents the BLT
 * passband droop from compounding across stages.
 *
 * Contrast with the vendor `el.svf`: that node is a single-stage Simper SVF
 * with an exposed Q. `variSlopeSvf` removes Q and adds continuous Butterworth
 * slope morphing as its defining feature.
 *
 * @param props      - `{ filterType?: "lowpass" | "lp" | "highpass" | "hp" }`
 * @param cutoff_hz  - per-sample cutoff frequency in Hz (required)
 * @param audio      - per-sample audio input signal (required)
 * @param slope      - per-sample continuous order [1.0, 6.0] (optional; default 1.0)
 *
 * @example
 * ```typescript
 * // Static 24 dB/oct lowpass at 800 Hz.
 * const node = el.extra.variSlopeSvf(
 *   { filterType: "lowpass" },
 *   el.const({ value: 800 }),   // cutoff
 *   source,                      // audio
 *   el.const({ value: 2.0 }),    // slope = 24 dB/oct
 * );
 *
 * // Slope swept by an LFO for a continuous order morph.
 * const slopeLfo = el.add(3.5, el.mul(2.5, el.cycle(0.1)));
 * const node = el.extra.variSlopeSvf(
 *   { filterType: "lowpass" },
 *   cutoff, source, slopeLfo,
 * );
 * ```
 */
export function variSlopeSvf(
  props: VariSlopeSvfProps,
  cutoff_hz: ElemNode,
  audio: ElemNode,
  slope?: ElemNode,
): NodeRepr_t {
  const children: NodeRepr_t[] = [resolve(cutoff_hz), resolve(audio)];
  if (slope !== undefined) children.push(resolve(slope));
  return createNode("variSlopeSvf", props, children);
}

/**
 * STFT-based channel vocoder.
 *
 * @remarks
 * Port of Geraint Luff's JSFX Vocoder. Imposes the spectral envelope of the
 * modulator signal onto the carrier signal using per-bin energy envelope
 * following and overlap-add STFT reconstruction.
 *
 * Takes 4 inputs (carrier L, carrier R, modulator L, modulator R) and
 * returns 2 outputs (vocoded L, vocoded R).
 *
 * @param props        - vocoder properties (windowMs, smoothingMs, maxGainDb, swapInputs)
 * @param carrierL     - left carrier channel
 * @param carrierR     - right carrier channel
 * @param modulatorL   - left modulator channel
 * @param modulatorR   - right modulator channel
 *
 * @example
 * ```typescript
 * const [outL, outR] = el.extra.vocoder(
 *   { windowMs: 10, smoothingMs: 5, maxGainDb: 40 },
 *   carrierL, carrierR,
 *   modulatorL, modulatorR,
 * );
 * ```
 */
export function vocoder(
  props: VocoderProps,
  carrierL: ElemNode,
  carrierR: ElemNode,
  modulatorL: ElemNode,
  modulatorR: ElemNode,
): Array<NodeRepr_t> {
  return unpack(
    createNode("vocoder", props, [
      resolve(carrierL),
      resolve(carrierR),
      resolve(modulatorL),
      resolve(modulatorR),
    ]),
    2,
  );
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
 * Big leap modes for `el.extra.strideDelay(...)`.
 */
export type StrideDelayBigLeapMode = "linear" | "step";

/**
 * Props for `el.extra.strideDelay(...)`.
 */
export interface StrideDelayProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Maximum delay buffer length in milliseconds. */
  maxDelayMs?: number;
  /** Crossfade length in milliseconds. */
  transitionMs?: number;
  /** Big leap interpolation mode. */
  bigLeapMode?: StrideDelayBigLeapMode;
  /**
   * Feedback tap name for `strideDelayWithInsert`.
   * When set, names the tapIn/tapOut pair used for the external feedback loop.
   */
  fbtap?: string;
}

/**
 * Stride-interpolated delay for a mono source node.
 *
 * @param props    - stride delay properties (key, maxDelayMs, transitionMs, bigLeapMode)
 * @param delayMs  - per-sample delay time signal in milliseconds
 * @param fb       - per-sample feedback amount signal
 * @param x        - mono audio input
 */
export function strideDelay(props: StrideDelayProps, delayMs: ElemNode, fb: ElemNode, x: ElemNode): NodeRepr_t;
/**
 * Stereo alias for `el.extra.strideDelay(...)`.
 *
 * @param props    - stride delay properties (key, maxDelayMs, transitionMs, bigLeapMode)
 * @param delayMs  - per-sample delay time signal in milliseconds
 * @param fb       - per-sample feedback amount signal
 * @param left     - left audio input
 * @param right    - right audio input
 */
export function strideDelay(
  props: StrideDelayProps,
  delayMs: ElemNode,
  fb: ElemNode,
  left: ElemNode,
  right: ElemNode,
): Array<NodeRepr_t>;
/**
 * Stride-interpolated delay.
 *
 * `delayMs` and `fb` are node arguments (children), not props.
 * The mono overload accepts a single audio input. The stereo overload accepts
 * explicit left/right inputs.
 */
export function strideDelay(
  props: StrideDelayProps,
  delayMs: ElemNode,
  fb: ElemNode,
  x: ElemNode,
  right?: ElemNode,
): NodeRepr_t | Array<NodeRepr_t> {
  const {
    maxDelayMs = 1000,
    transitionMs = 100,
    bigLeapMode = "linear",
    ...other
  } = props;

  const resolvedProps = {
    ...other,
    maxDelayMs,
    transitionMs,
    bigLeapMode,
  };

  if (right === undefined) {
    return createNode("stridedelay", resolvedProps, [resolve(delayMs), resolve(fb), resolve(x)]);
  }

  return unpack(
    createNode("stridedelay", resolvedProps, [resolve(delayMs), resolve(fb), resolve(x), resolve(right)]),
    2,
  );
}

/**
 * Stereo alias for `el.extra.strideDelay(...)`.
 */
export function stereoStrideDelay(
  props: StrideDelayProps,
  delayMs: ElemNode,
  fb: ElemNode,
  left: ElemNode,
  right: ElemNode,
): Array<NodeRepr_t> {
  return strideDelay(props, delayMs, fb, left, right) as Array<NodeRepr_t>;
}

/**
 * Stride delay with a feedback insert loop (mono).
 *
 * The `insert` callback receives the **feedback audio signal** — the
 * actual delayed audio coming back through the tap — and returns a
 * processed version (e.g., filtered, pitch-shifted). The `fb` argument
 * is the **feedback amount** (a gain coefficient, typically 0–1) applied
 * to the insert return before it is summed back into the delay input.
 *
 * Requires `props.fbtap` — a unique name for the tapIn/tapOut pair.
 *
 * **Feedback path has 1-block latency** (inherent to tapIn/tapOut).
 *
 * @param props    - stride delay props; must include `fbtap` name
 * @param delayMs  - per-sample delay time signal
 * @param fb       - feedback amount (gain applied to insert return)
 * @param insert   - callback: receives feedback audio, returns processed audio
 * @param x        - audio input
 *
 * @example
 * ```ts
 * // Delay with a lowpass filter darkening each repeat
 * const delayed = el.extra.strideDelayWithInsert(
 *   { maxDelayMs: 1500, transitionMs: 60, fbtap: "fb_loop" },
 *   el.const({ value: 250, key: "delay" }),   // delay time
 *   el.const({ value: 0.5, key: "fb_amt" }),  // feedback amount
 *   (fbAudio) => {
 *     // fbAudio is the delayed signal coming back through the loop.
 *     // Filter it so each repeat gets darker.
 *     return el.lowpass(
 *       el.const({ value: 2000 }),
 *       el.const({ value: 0.707 }),
 *       fbAudio,
 *     );
 *   },
 *   input,                                     // audio input
 * );
 * ```
 *
 * Signal flow:
 * ```
 *                    ┌─── insert(fbAudio) ◄── tapIn(fbtap)
 *                    ▼
 * fb_amount * insert_return ──┐
 *                              ▼
 * audio_input ────────── add ──► stridedelay(internal fb=0)
 *                                       │
 *                               tapOut(fbtap) ──► output
 * ```
 */
export function strideDelayWithInsert(
  props: StrideDelayProps,
  delayMs: ElemNode,
  fb: ElemNode,
  insert: (fbAudio: NodeRepr_t) => NodeRepr_t,
  x: ElemNode,
): NodeRepr_t {
  const {
    fbtap,
    maxDelayMs = 1000,
    transitionMs = 100,
    bigLeapMode = "linear",
    ...other
  } = props;

  if (!fbtap) {
    throw new Error("strideDelayWithInsert requires props.fbtap (tap name for feedback loop)");
  }

  const resolvedProps = { ...other, maxDelayMs, transitionMs, bigLeapMode };

  // Tap the feedback audio from the previous block.
  const fbAudio = createNode("tapIn", { name: fbtap }, []);

  // User processes the feedback audio (filter, pitch shift, etc.).
  const processed = insert(fbAudio);

  // Apply feedback amount to the processed return, sum with input.
  const feedbackMix = createNode("mul", {}, [resolve(fb), resolve(processed)]);
  const summedInput = createNode("add", {}, [resolve(x), feedbackMix]);

  // Run delay with internal fb=0 (external loop handles feedback).
  const delayed = createNode("stridedelay", resolvedProps, [
    resolve(delayMs),
    resolve(0),
    summedInput,
  ]);

  // Tap the output for next block's feedback.
  return createNode("tapOut", { name: fbtap }, [delayed]);
}

/**
 * Stereo stride delay with feedback insert loops.
 *
 * Builds two independent mono insert delays (L/R) with per-channel
 * tap names derived from `props.fbtap`: `"{fbtap}:L"` and `"{fbtap}:R"`.
 *
 * The `insert` callback is called twice — once per channel — with the
 * feedback audio and a channel tag (`"L"` or `"R"`) so the user can
 * create per-channel keyed nodes inside the insert chain.
 *
 * @param props    - stride delay props; must include `fbtap` name
 * @param delayMs  - per-sample delay time signal
 * @param fb       - feedback amount (gain applied to insert return)
 * @param insert   - callback: `(fbAudio, tag) => processedAudio`
 * @param left     - left audio input
 * @param right    - right audio input
 *
 * @example
 * ```ts
 * const [delayL, delayR] = el.extra.stereoStrideDelayWithInsert(
 *   { maxDelayMs: 1500, transitionMs: 60, fbtap: "fb" },
 *   el.const({ value: 250, key: "delay" }),
 *   el.const({ value: 0.5, key: "fb_amt" }),
 *   (fbAudio, tag) => el.lowpass(
 *     el.const({ value: 2000, key: `insert_fc:${tag}` }),
 *     el.const({ value: 0.707 }),
 *     fbAudio,
 *   ),
 *   inputL,
 *   inputR,
 * );
 * ```
 */
export function stereoStrideDelayWithInsert(
  props: StrideDelayProps,
  delayMs: ElemNode,
  fb: ElemNode,
  insert: (fbAudio: NodeRepr_t, tag: string) => NodeRepr_t,
  left: ElemNode,
  right: ElemNode,
): [NodeRepr_t, NodeRepr_t] {
  const {
    fbtap,
    maxDelayMs = 1000,
    transitionMs = 100,
    bigLeapMode = "linear",
    ...other
  } = props;

  if (!fbtap) {
    throw new Error("stereoStrideDelayWithInsert requires props.fbtap");
  }

  const resolvedProps = { ...other, maxDelayMs, transitionMs, bigLeapMode };

  function buildChannel(input: ElemNode, tag: string): NodeRepr_t {
    const tapName = `${fbtap}:${tag}`;
    const fbAudio = createNode("tapIn", { name: tapName }, []);
    const processed = insert(fbAudio, tag);
    const feedbackMix = createNode("mul", {}, [resolve(fb), resolve(processed)]);
    const summedInput = createNode("add", {}, [resolve(input), feedbackMix]);
    const delayed = createNode("stridedelay", resolvedProps, [
      resolve(delayMs),
      resolve(0),
      summedInput,
    ]);
    return createNode("tapOut", { name: tapName }, [delayed]);
  }

  return [buildChannel(left, "L"), buildChannel(right, "R")];
}

// ---- interpolateN (energy-preserving N-way crossfade) -----------------

export interface InterpolateNProps extends Record<string, unknown> {
  /** Wrap the interpolator circularly (barberpole). Default: false. */
  barberpole?: boolean;
}

/**
 * Energy-preserving N-way crossfading mixer.
 *
 * Crossfades between N mono signal nodes using a normalised interpolator.
 *
 * **Without `barberpole`** (default): interpolator clamped to [0, 1].
 * `0` = first node, `1` = last node. Linear path.
 *
 * **With `barberpole: true`**: nodes on a circular ring. `0` and `1`
 * both map to the first node. The last node crossfades back into the
 * first. Values outside [0, 1] wrap seamlessly.
 *
 * Uses the Signalsmith cheap energy-preserving crossfade curve:
 * `smoothstep(x) = 3x² − 2x³` passed through `sqrt` for equal-power.
 * See https://signalsmith-audio.co.uk/writing/2021/cheap-energy-crossfade/
 *
 * @param props        - `{ barberpole?: boolean }`
 * @param interpolator - position signal
 * @param nodes        - array of mono signal nodes to crossfade between
 *
 * @example
 * ```ts
 * // Linear (clamped) crossfade
 * el.extra.interpolateN({}, el.const({ value: 0.5 }), [oscA, oscB, oscC]);
 *
 * // Barberpole: wraps around, bipolar LFO is fine
 * el.extra.interpolateN({ barberpole: true }, el.cycle(0.1), [oscA, oscB, oscC]);
 * ```
 */
export function interpolateN(
  props: InterpolateNProps,
  interpolator: ElemNode,
  nodes: ElemNode[],
): NodeRepr_t {
  const n = nodes.length;
  if (n < 2) {
    console.error("interpolateN: requires at least 2 nodes, got", n);
    return n === 1 ? resolve(nodes[0]) : resolve(0);
  }

  const barberpole = props.barberpole === true;
  const interp = resolve(interpolator);

  if (barberpole) {
    return interpolateNBarberpole(interp, nodes, n);
  } else {
    return interpolateNClamped(interp, nodes, n);
  }
}

function interpolateNClamped(
  interp: NodeRepr_t,
  nodes: ElemNode[],
  n: number,
): NodeRepr_t {
  const clamped = createNode("min", {}, [
    resolve(1),
    createNode("max", {}, [resolve(0), interp]),
  ]);
  const pos = createNode("mul", {}, [clamped, resolve(n - 1)]);

  const weighted: NodeRepr_t[] = nodes.map((node, i) => {
    const dist = createNode("abs", {}, [
      createNode("sub", {}, [pos, resolve(i)]),
    ]);
    const proximity = createNode("max", {}, [
      resolve(0),
      createNode("sub", {}, [resolve(1), dist]),
    ]);
    const ss = createNode("mul", {}, [
      createNode("mul", {}, [proximity, proximity]),
      createNode("sub", {}, [
        resolve(3),
        createNode("mul", {}, [resolve(2), proximity]),
      ]),
    ]);
    const gain = createNode("sqrt", {}, [ss]);
    return createNode("mul", {}, [resolve(node), gain]);
  });

  return weighted.reduce((acc, x) => createNode("add", {}, [acc, x]));
}

function interpolateNBarberpole(
  interp: NodeRepr_t,
  nodes: ElemNode[],
  n: number,
): NodeRepr_t {
  const fract = createNode("sub", {}, [
    interp,
    createNode("floor", {}, [interp]),
  ]);
  const pos = createNode("mul", {}, [fract, resolve(n)]);

  const weighted: NodeRepr_t[] = nodes.map((node, i) => {
    const linearDist = createNode("abs", {}, [
      createNode("sub", {}, [pos, resolve(i)]),
    ]);
    const circularDist = createNode("min", {}, [
      linearDist,
      createNode("sub", {}, [resolve(n), linearDist]),
    ]);
    const proximity = createNode("max", {}, [
      resolve(0),
      createNode("sub", {}, [resolve(1), circularDist]),
    ]);
    const ss = createNode("mul", {}, [
      createNode("mul", {}, [proximity, proximity]),
      createNode("sub", {}, [
        resolve(3),
        createNode("mul", {}, [resolve(2), proximity]),
      ]),
    ]);
    const gain = createNode("sqrt", {}, [ss]);
    return createNode("mul", {}, [resolve(node), gain]);
  });

  return weighted.reduce((acc, x) => createNode("add", {}, [acc, x]));
}

// ---------------------------------------------------------------------------
// sampleCount
// ---------------------------------------------------------------------------

export type SampleCountUnit = "samp" | "ms" | "hz";

/** Props for `el.extra.sampleCount(...)`. */
export interface SampleCountProps extends Record<string, unknown> {
  key?: string;
  path: string;
  unit?: SampleCountUnit;
}

/**
 * Emit VFS resource length as constant signal.
 *
 * - `"samp"` raw per-channel sample count
 * - `"ms"` duration in milliseconds
 * - `"hz"` reciprocal duration frequency (`sr / len`)
 */
export function sampleCount(props: SampleCountProps): NodeRepr_t {
  return createNode("sampleCount", props, []);
}

/**
 * Fixed-period frame clock anchored to absolute sample time.
 *
 * Emits a one-sample pulse at absolute sample indices
 * `0, period, 2*period, ...` regardless of backend block size.
 */
export function frameClock(period: number): NodeRepr_t {
  return createNode("frameClock", { period }, []);
}

/** Backward-compatible alias for `frameClock(...)`. */
export function frameclock(period: number): NodeRepr_t {
  return frameClock(period);
}

/** Props for `el.extra.framePhasor(...)`. */
export interface FrameDelayProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
  /** Maximum supported delay in whole frames. Must be a non-negative integer. */
  maxframes: number;
}

/** Props for `el.extra.frameDerivative(...)`. */
export interface FrameDerivativeProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.frameScope(...)`. */
export interface FrameScopeProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Event source name forwarded through scope events. */
  name: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.framePhasor(...)`. */
export interface FramePhasorProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.frameShaper(...)`. */
export interface FrameShaperProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.framePolySignal(...)`. */
export interface FramePolySignalProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
  /** Base low-rate dephasing speed in beats per minute. */
  bpm: number;
  /** Optional mono wavetable resource path. If omitted, uses an internal sine. */
  path?: string;
  /** Optional monotonic reset request counter for hard native resync between renders. */
  resetcounter?: number;
}

/** Props for `el.extra.frameSelect(...)`. */
export interface FrameSelectProps extends Record<string, unknown> {
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.frameSmooth(...)`. */
export interface FrameSmoothProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.frameBiDiSmooth(...)`. */
export interface FrameBiDiSmoothProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

/** Props for `el.extra.frameWriteRAM(...)`. */
export interface FrameWriteRAMProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
  /** RAM slot identifier shared with readers like `el.table(...)`. */
  path: string;
}

/** Props for `el.extra.frameRandomWalks(...)`. */
export interface FrameRandomWalksProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
  /** Optional deterministic RNG seed. Zero is treated as one. */
  seed?: number;
  /** Optional positive-only output mode. */
  absolute?: boolean;
  /** Optional cosine interpolation toggle. Defaults to true. */
  interpolation?: boolean;
  /** Optional reset starting value before initial deviation is applied. */
  startingfrom?: number;
  /** Optional reset deviation range around `startingfrom`. */
  initialdeviation?: number;
}

/** Props for `el.extra.frameValue(...)`. */
export interface FrameValueProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Event source name forwarded through queued runtime events. */
  name?: string;
  /** Fixed frame length in samples. Must be a positive even integer. */
  framelength: number;
}

function assertEvenFrameLength(name: string, frameLength: number) {
  if (!Number.isInteger(frameLength) || frameLength <= 0 || frameLength % 2 !== 0) {
    throw new Error(`${name} requires a positive even framelength prop`);
  }
}

/**
 * Absolute-sample-aligned frame phasor with frame-latched shaping controls.
 *
 * All four controls are latched only on frame boundaries. The final output
 * is hard-clipped to the bipolar range [-1, 1]:
 *   - `offset`: vertical DC offset added after curvature/scale
 *   - `shift`:  horizontal phase rotation in integer samples, wrapped into the frame
 *   - `curvature`: bipolar phase curve warp
 *   - `scale`:  bipolar vertical amplitude scale applied to the curved phase;
 *               negative values mirror the phasor vertically
 */
export function framePhasor(
  props: FramePhasorProps,
  offset: ElemNode,
  shift: ElemNode,
  curvature: ElemNode,
  scale: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("framePhasor", props.framelength);

  return createNode("framePhasor", props, [
    resolve(offset),
    resolve(shift),
    resolve(curvature),
    resolve(scale),
  ]);
}

/**
 * Absolute-sample-aligned frame shaper oscillator with frame-latched controls.
 *
 * `wave` morphs the oscillator core by magnitude:
 * - `0.0`   -> flat DC zero
 * - `0.5`   -> full bipolar triangle
 * - `1.0`   -> full bipolar sine
 *
 * Negative `wave` values invert the oscillator core vertically.
 *
 * `tilt` skews the waveform around the center of the frame by remapping the
 * phase asymmetrically while preserving the endpoints.
 *
 * `zoom` narrows or widens the active rendering width around the frame center:
 * - `< 1` zooms inward and expands the wave around the center track
 * - `> 1` contracts the wave inward toward a narrow central selector
 */
export function frameShaper(
  props: FrameShaperProps,
  offset: ElemNode,
  shift: ElemNode,
  tilt: ElemNode,
  zoom: ElemNode,
  scale: ElemNode,
  wave: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameShaper", props.framelength);

  return createNode("frameShaper", props, [
    resolve(offset),
    resolve(shift),
    resolve(tilt),
    resolve(zoom),
    resolve(scale),
    resolve(wave),
  ]);
}

/**
 * Frame PolySignal / Frame MultiLFO primitive.
 *
 * Reads one source wavetable across the frame and de-correlates each track's
 * time path using built-in full-ramp shaping scaled by `shapePhases` and
 * `shapeFrequencies`. If `path` is omitted, the source defaults to an internal sine wave.
 *
 * Current reset behavior:
 * - the `reset` input performs a hard native reset on rising edge
 * - changing `props.resetcounter` between renders also performs a hard native reset
 */
export function framePolySignal(
  props: FramePolySignalProps,
  shapePhases: ElemNode,
  shapeFrequencies: ElemNode,
  reset: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("framePolySignal", props.framelength);
  return createNode("framePolySignal", props, [
    resolve(shapePhases),
    resolve(shapeFrequencies),
    resolve(reset),
  ]);
}

/**
 * Frame-synchronised select helper.
 *
 * The condition is sampled only on frame boundaries and held for the whole
 * frame. The chosen branch still runs at sample rate.
 */
export function frameSelect(
  props: FrameSelectProps,
  condition: ElemNode,
  whenTrue: ElemNode,
  whenFalse: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameSelect", props.framelength);
  return createNode("frameSelect", props, [
    resolve(condition),
    resolve(whenTrue),
    resolve(whenFalse),
  ]);
}

/**
 * WireFrames-style frame-domain smoothing processor with per-track SR modulation.
 *
 * `timeConstantFrameShaper` uses the same inverse order-4 time scaling law as
 * `frameRandomWalks`: `0 -> default`, `1 -> 16x faster`, `-1 -> 16x slower`.
 */
export function frameSmooth(
  props: FrameSmoothProps,
  timeConstant: ElemNode,
  timeConstantFrameShaper: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameSmooth", props.framelength);
  return createNode("frameSmooth", props, [
    resolve(timeConstant),
    resolve(timeConstantFrameShaper),
    resolve(x),
  ]);
}

/**
 * WireFrames-style bidirectional frame-domain smoother with separate attack
 * and release times plus independent per-track shapers for both directions.
 */
export function frameBiDiSmooth(
  props: FrameBiDiSmoothProps,
  attackTime: ElemNode,
  releaseTime: ElemNode,
  attackFrameShaper: ElemNode,
  releaseFrameShaper: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameBiDiSmooth", props.framelength);
  return createNode("frameBiDiSmooth", props, [
    resolve(attackTime),
    resolve(releaseTime),
    resolve(attackFrameShaper),
    resolve(releaseFrameShaper),
    resolve(x),
  ]);
}

/**
 * WireFrames-style RAM writer for a live mono frame stream.
 *
 * Captures one complete frame from `x` and writes the coherent frame into the
 * runtime-owned RAM slot at `path` on the next frame boundary.
 */
export function frameWriteRAM(
  props: FrameWriteRAMProps,
  x: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameWriteRAM", props.framelength);
  return createNode("frameWriteRAM", props, [resolve(x)]);
}

/** Wrapping addition inside a runtime range `[min, max)`. */
export function wrapAdd(min: ElemNode, max: ElemNode, x: ElemNode, y: ElemNode): NodeRepr_t {
  return createNode("wrapAdd", {}, [resolve(min), resolve(max), resolve(x), resolve(y)]);
}

/** Mirror-reflected addition inside a runtime range `[min, max]`. */
export function mirrorAdd(min: ElemNode, max: ElemNode, x: ElemNode, y: ElemNode): NodeRepr_t {
  return createNode("mirrorAdd", {}, [resolve(min), resolve(max), resolve(x), resolve(y)]);
}

/**
 * Frame-synchronised packed random walks with per-track step/time shaping.
 *
 * `stepSizeFrameShaper` scales `stepSize` by an order-4 frame shaper law:
 * `-1 -> 1/16`, `0 -> 1`, `1 -> 16`.
 *
 * `timeConstantFrameShaper` applies the inverse order-4 law to `timeConstant`:
 * `-1 -> 16x slower`, `0 -> default`, `1 -> 16x faster`.
 */
export function frameRandomWalks(
  props: FrameRandomWalksProps,
  stepSize: ElemNode,
  timeConstant: ElemNode,
  stepSizeFrameShaper: ElemNode,
  timeConstantFrameShaper: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameRandomWalks", props.framelength);

  return createNode("frameRandomWalks", props, [
    resolve(stepSize),
    resolve(timeConstant),
    resolve(stepSizeFrameShaper),
    resolve(timeConstantFrameShaper),
  ]);
}

/**
 * Frame-synchronised integer delay line whose delay unit is whole frames.
 *
 * The `delayFrames` signal is sampled only on frame boundaries and held for
 * the full frame.
 */
export function frameDelay(
  props: FrameDelayProps,
  delayFrames: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameDelay", props.framelength);
  if (!Number.isInteger(props.maxframes) || props.maxframes < 0) {
    throw new Error("frameDelay requires a non-negative integer maxframes prop");
  }

  return createNode("frameDelay", props, [resolve(delayFrames), resolve(x)]);
}

/**
 * Frame-synchronised derivative against the previous frame at the same sample offset.
 *
 * Emits `x[n] - x[n - framelength]` with a fixed latency of one frame.
 */
export function frameDerivative(
  props: FrameDerivativeProps,
  x: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameDerivative", props.framelength);
  return createNode("frameDerivative", props, [resolve(x)]);
}

/**
 * Frame-synchronised scope that emits one exact frame of samples per event.
 */
export function frameScope(
  props: FrameScopeProps,
  ...args: ElemNode[]
): NodeRepr_t {
  assertEvenFrameLength("frameScope", props.framelength);

  return createNode("frameScope", props, args.map(resolve));
}

/**
 * Frame-synchronous single-value getter with queued event output.
 *
 * The `index` signal is sampled only on frame boundaries. The node passes `x`
 * through unchanged and emits the selected frame sample through queued runtime
 * events as `frameValue`.
 */
export function frameValue(
  props: FrameValueProps,
  index: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  assertEvenFrameLength("frameValue", props.framelength);

  return createNode("frameValue", props, [resolve(index), resolve(x)]);
}


// ---------------------------------------------------------------------------
// ramp00
// ---------------------------------------------------------------------------

/**
 * Props for `el.extra.ramp00(...)`.
 */
export interface Ramp00Props extends Record<string, unknown> {
  /** Optional authoring key for stable identity. */
  key?: string;
  /**
   * When `true` (default), triggers are ignored while the ramp is running —
   * i.e. until the output returns to exactly 0. When `false`, any rising edge
   * on the trigger restarts the ramp from 0.
   */
  blocking?: boolean;
}

/**
 * Props for `el.extra.threshold(...)`.
 */
export interface ThresholdProps extends Record<string, unknown> {
  /** Optional authoring key for stable identity. */
  key?: string;
  /** Hysteresis width applied around the threshold. Default: 0. */
  hysteresis?: number;
  /**
   * When `true`, output holds at `1` after a threshold crossing until the
   * `reset` signal rises. When `false` (default), `reset` is ignored and the
   * node emits one-sample threshold-gate pulses on rising crossings only.
   */
  latch?: boolean;
}

/**
 * Props for `el.extra.sample(...)`.
 */
export interface ExtraSampleProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** VFS path of the source asset. */
  path: string;
}

/**
 * Sample-accurate one-shot 0→1 ramp.
 *
 * On a rising edge of the trigger `x` (crossing 0.5 upward), the signal
 * increments linearly from 0 to 1 over `dur` samples, then drops instantly
 * back to 0 on the next sample — hence the `00` suffix: the output starts
 * at 0 and ends at 0. Ideal as a sample-accurate envelope gate, a percussive
 * modulator trigger, or a duration-controlled one-shot LFO.
 *
 * @param props - see {@link Ramp00Props}
 * @param dur   - ramp duration in **samples** (signal; may vary per-sample)
 * @param x     - trigger signal; a rising edge through 0.5 starts the ramp
 *
 * ### dur semantics
 * - `dur` is read every sample and the per-sample increment is `1 / dur`.
 * - If `dur` changes mid-ramp, the current value is preserved and only the
 *   slope updates (smooth continuation at the new rate).
 * - If `dur <= 0` at the moment of a would-be trigger, the trigger is ignored.
 * - If `dur <= 0` while the ramp is running, the ramp aborts and the output
 *   snaps to 0.
 *
 * @example
 * ```ts
 * // 100 ms ramp @ current SR, retriggered by a 2 Hz train, retriggers
 * // blocked while running.
 * const ramp = el.extra.ramp00(
 *   { blocking: true },
 *   el.ms2samps(100),
 *   el.train(2),
 * );
 * ```
 */
export function ramp00(
  props: Ramp00Props,
  dur: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  const { blocking = true, ...other } = props;
  const resolvedProps = { ...other, blocking };
  return createNode("ramp00", resolvedProps, [resolve(dur), resolve(x)]);
}

/**
 * Sample-accurate threshold gate with optional hold/reset behavior.
 *
 * Child order: `threshold`, `reset`, `x`.
 *
 * - `threshold` is a signal and may vary per-sample.
 * - `reset` is only used when `latch: true`.
 * - `x` is the observed signal.
 *
 * Vendor comparators already cover basic thresholding. This node is the
 * threshold-gate variant: it watches for upward crossings through a threshold
 * band and emits either one-sample pulses or a held gate, depending on `latch`.
 *
 * It rearms when `x <= threshold - hysteresis/2`, then fires when
 * `x > threshold + hysteresis/2`.
 */
export function threshold(
  props: ThresholdProps,
  threshold: ElemNode,
  reset: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  const { hysteresis = 0, latch = false, ...other } = props;
  const resolvedProps = { ...other, hysteresis, latch };
  return createNode("threshold", resolvedProps, [resolve(threshold), resolve(reset), resolve(x)]);
}

/**
 * Always-multichannel sample playback helper.
 *
 * Child order: `start`, `end`, `rate`, `gainDb`, `trigger`.
 *
 * The native node always produces a stereo pair. Mono sources are copied to
 * both channels. Looping is always enabled inside the normalized `[start, end]`
 * region. `gainDb` is an audio-rate stereo gain control shared by both outputs.
 * The native node converts dB to linear gain internally.
 *
 * Typical `gainDb` range is `0` down to silence, with optional positive headroom
 * such as `+6 dB` when desired by the caller.
 */
export function sample(
  props: ExtraSampleProps,
  start: ElemNode,
  end: ElemNode,
  rate: ElemNode,
  gainDb: ElemNode,
  trigger: ElemNode,
): Array<NodeRepr_t> {
  return unpack(
    createNode("extra.sample", props, [resolve(start), resolve(end), resolve(rate), resolve(gainDb), resolve(trigger)]),
    2,
  );
}

// ---------------------------------------------------------------------------
// rain
// ---------------------------------------------------------------------------

/**
 * Props for `el.extra.rain(...)`.
 */
export interface RainProps extends Record<string, unknown> {
  /** Optional authoring key for stable identity. */
  key?: string;
  /** Optional deterministic RNG seed (0 treated as 1). */
  seed?: number;
  /**
   * Per-impulse amplitude randomness, 0.0–1.0. Default 0.
   * - 0.0 = all impulses at amplitude 1 (constant)
   * - 0.5 = amplitude uniformly in [0.5, 1.0]
   * - 1.0 = amplitude uniformly in [0, 1]
   */
  jitter?: number;
}

/**
 * Sparse random impulses with optional decaying release.
 *
 * Inspired by SuperCollider's `Dust` with a twist: each impulse
 * can have a trailing exponential release instead of being a single-sample
 * spike. Releases overlap and sum (polyphonic voice pool of 64).
 *
 * ### Behaviour
 *
 * - Each sample runs a Bernoulli trial with probability `density / sr`.
 * - On trigger, a new voice spawns with amplitude 1.
 * - Voices decay exponentially at T60 = `release` seconds and sum at the output.
 * - If all 64 voice slots are busy, new triggers are dropped.
 * - `release <= 0` → single-sample impulse (voice expires immediately).
 * - `density <= 0` → no new triggers, existing releases keep decaying.
 *
 * ### Overlap handling
 *
 * New events use gap-filling spawn. When a trigger fires while the summed
 * envelope is at level `d`, the new voice is born at amplitude `(1 - d)` so
 * the envelope jumps back to exactly 1.0 rather than stacking on top.
 * A vendor-style `dcblock` poststage then recenters the output around 0.
 * Sonically this reads as a probabilistically-retriggered exponential
 * envelope whose decay tail shortens as density rises, without drifting DC.
 *
 * For the `release <= 0` impulse mode, voices expire on the next sample so
 * there is no overlap to manage.
 *
 * @param props   - see {@link RainProps}
 * @param density - impulses per second (Poisson rate, signal)
 * @param release - T60 decay time in seconds per impulse (signal, audio-rate)
 *
 * @example
 * ```ts
 * // Dense rain with 50ms release
 * const noise = el.extra.rain(
 *   { seed: 1 },
 *   el.const({ value: 200 }),
 *   el.const({ value: 0.05 }),
 * );
 *
 * // Single-sample impulses
 * const clicks = el.extra.rain(
 *   {},
 *   el.const({ value: 10 }),
 *   el.const({ value: 0 }),
 * );
 * ```
 */
export function rain(
  props: RainProps,
  density: ElemNode,
  release: ElemNode,
): NodeRepr_t {
  return createNode("rain", props, [resolve(density), resolve(release)]);
}

// ---------------------------------------------------------------------------
// preset bank (MVP)
// ---------------------------------------------------------------------------

/** Taper family used to denormalise a preset lane on read. */
export type PresetLaneTaper = "linear" | "exp" | "quantize";

/** Declarative description of one preset lane inside a bank. */
export interface PresetLaneMetadata {
  /** Lane index inside the frame (0..framelength-1). */
  index: number;
  /** Human-readable lane name, e.g. "cutoffHz". */
  name: string;
  /** Optional minimum value after denormalisation. */
  min?: number;
  /** Optional maximum value after denormalisation. */
  max?: number;
  /** Optional taper/curve family applied during denormalisation. */
  taper?: PresetLaneTaper;
  /** Optional default normalized value used when authoring presets. */
  default?: number;
  /** Optional unit label, informational only. */
  unit?: string;
}

/** Static descriptor attached to a preset bank. Not consulted at audio rate. */
export interface PresetBankMetadata extends Record<string, unknown> {
  /** Optional schema tag, useful for forward/backward compatibility. */
  schema?: string;
  /** Optional schema version. */
  version?: number;
  /** Declared lanes for this bank (by index). */
  lanes?: readonly PresetLaneMetadata[];
  /** Optional human-friendly slot names, parallel to slot indices. */
  slotNames?: readonly string[];
}

/** Props shared by preset bank nodes. */
export interface PresetBankProps extends Record<string, unknown> {
  /** Optional authoring key used for stable identity. */
  key?: string;
  /** Shared bank identifier. All nodes referring to the same bank share RAM. */
  path: string;
  /** Positive integer frame size in samples. One frame = one preset. */
  framelength: number;
  /** Positive integer number of presets stored in the bank. */
  slots: number;
  /** Optional descriptor object for lanes, tapers, slot names, etc. */
  metadata?: PresetBankMetadata;
}

/**
 * Multi-slot preset RAM writer (MVP).
 *
 * Captures one full frame of `x` and commits it into the chosen slot of a
 * runtime-owned preset bank on the next frame boundary. `slot` is latched at
 * frame boundaries and clamped to `[0, slots - 1]`.
 */
export function presetWrite(
  props: PresetBankProps,
  slot: ElemNode,
  x: ElemNode,
): NodeRepr_t {
  return createNode("presetWrite", props, [resolve(slot), resolve(x)]);
}

/**
 * Multi-slot preset RAM reader (MVP).
 *
 * Reads one preset slot as a mono lookup table with linear interpolation by a
 * normalized `phase` in `[0, 1]`. `slot` is clamped to `[0, slots - 1]`.
 */
export function presetRead(
  props: PresetBankProps,
  slot: ElemNode,
  phase: ElemNode,
): NodeRepr_t {
  return createNode("presetRead", props, [resolve(slot), resolve(phase)]);
}

/**
 * Multi-slot preset RAM morph (MVP).
 *
 * Reads two preset slots with the same normalized phase and linearly
 * crossfades between them by `mix` (clamped to `[0, 1]`). `mix = 0` picks
 * `slotA`, `mix = 1` picks `slotB`, so this same node also covers hard
 * slot selection.
 */
export function presetMorph(
  props: PresetBankProps,
  slotA: ElemNode,
  slotB: ElemNode,
  mix: ElemNode,
  phase: ElemNode,
): NodeRepr_t {
  return createNode("presetMorph", props, [
    resolve(slotA),
    resolve(slotB),
    resolve(mix),
    resolve(phase),
  ]);
}

/**
 * Host-side helper: denormalise a `[0, 1]` value to a real parameter value
 * using a lane's declared `min`/`max`/`taper`. Intended for UI-side decoding
 * of preset metadata. Not called on the audio thread.
 */
export function denormalisePresetLane(
  lane: PresetLaneMetadata,
  value: number,
): number {
  const min = typeof lane.min === "number" ? lane.min : 0;
  const max = typeof lane.max === "number" ? lane.max : 1;
  const clamped = Math.max(0, Math.min(1, value));

  if (lane.taper === "exp") {
    if (min <= 0 || max <= 0) {
      return min + clamped * (max - min);
    }
    return min * Math.pow(max / min, clamped);
  }

  if (lane.taper === "quantize") {
    const steps = Math.max(1, Math.round(max - min));
    const quantized = Math.round(clamped * steps);
    return min + quantized;
  }

  return min + clamped * (max - min);
}
