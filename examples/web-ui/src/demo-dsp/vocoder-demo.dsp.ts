
/**
 * Vocoder DSP graph — STFT multichannel vocoder
 *
 * Three scope inserts for visualizsing carrier, modulator, and output.
 */

import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import {TIME_SCALE} from "../components/Oscilloscope";

export const SCOPE_CARRIER = "vocoder-scope-carrier";
export const SCOPE_MOD     = "vocoder-scope-mod";
export const SCOPE_OUTPUT  = "vocoder-scope-output";

export type ModulatorSource = "noise" | "sample";

export interface VocoderParams {
  windowMs: number;
  smoothingMs: number;
  maxGainDb: number;
  modulatorSource: ModulatorSource;
  mix: number;
  /** Stride delay time in ms (applied to vocoded output). */
  delayTimeMs: number;
  /** Stride delay feedback amount (0–1). */
  delayFeedback: number;
  /** Feedback insert filter cutoff in Hz. */
  delayInsertCutoff: number;
  /** Delay dry/wet mix (0 = vocoded only, 1 = fully delayed). */
  delayMix: number;
  /** VFS path for the carrier sample (mc-test.wav). */
  carrierPath?: string;
  /** VFS path for the modulator sample. */
  modPath?: string;
  isStopped?: boolean;
}

export function buildGraph(p: VocoderParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  let carrierL: NodeRepr_t;
  let carrierR: NodeRepr_t;

  if (p.carrierPath) {
    const carrier = el.mc.sample(
      { key: "vocoder:carrier", channels:2, path: p.carrierPath, mode: "loop" },
      1
    );
    carrierL = carrier[0];
    carrierR = carrier[1];
  } else {
    const tone = el.cycle(el.const({ key: "vocoder:tone", value: 220 }));
    carrierL = tone;
    carrierR = tone;
  }

  // ---- Modulator: noise or 808 beat ----
  let modL: NodeRepr_t;
  let modR: NodeRepr_t;

  if (p.modulatorSource === "sample" && p.modPath) {
    const altSource = el.mc.sample(
      { key: "vocoder:mod-beat", path: p.modPath, mode: "loop", channels: 2 },
      1
    );
    modL = altSource[0];
    modR = altSource[1];
  } else {
    modL = el.noise({seed: 0.137});
    modR = el.noise({seed: 0.55});
  }

  // ---- Vocoder ----
  const [vocodedL, vocodedR] = el.extra.vocoder(
    {
        key: "vocoder:params",
      windowMs: p.windowMs,
      smoothingMs: p.smoothingMs,
      maxGainDb: p.maxGainDb,
      swapInputs: 1,
    },
    carrierL, carrierR,
    modL, modR,
  );

  // ---- Stereo stride delay with feedback filter insert ----
  const [delayedL, delayedR] = el.extra.stereoStrideDelayWithInsert(
    {
      key: "vocoder:delay",
      fbtap: "vocoder-fb",
      maxDelayMs: 1000,
      transitionMs: 40,
      bigLeapMode: "step",
    },
    el.const({ value: p.delayTimeMs, key: "vocoder:delay-ms" }),
    el.const({ value: p.delayFeedback, key: "vocoder:delay-fb" }),
    (fbAudio: NodeRepr_t, tag: string) => {
      // Lowpass in the feedback loop — each repeat gets darker.
      return el.lowpass(
        el.const({ value: p.delayInsertCutoff, key: `vocoder:insert-fc:${tag}` }),
        el.const({ value: 0.707 }),
        fbAudio,
      );
    },
      vocodedL,
      vocodedR,
  );

  // ---- Delay dry/wet (vocoded vs delayed-vocoded) ----
  const delayMix = el.const({ key: "vocoder:delay-mix", value: p.delayMix });
  const delayBlendL = el.select(delayMix, delayedL, vocodedL);
  const delayBlendR = el.select(delayMix, delayedR, vocodedR);

  // ---- Mix (dry carrier / wet vocoded+delay) ----
  const mix = el.const({ key: "vocoder:mix", value: p.mix });
  const leftSelector =   el.select(mix, delayBlendL, carrierL);
  const rightSelector =  el.select(mix, delayBlendR, carrierR);

  // ---- Scope inserts (carrier, modulator, output) ----
  const scopeCarrier = el.scope({ name: SCOPE_CARRIER, size: TIME_SCALE, channels: 1 }, carrierL);
  const scopeMod     = el.scope({ name: SCOPE_MOD,     size: TIME_SCALE, channels: 1 }, modL);
  const scopeOutput  = el.scope({ name: SCOPE_OUTPUT,  size: TIME_SCALE, channels: 1 }, leftSelector);

  // Scope nodes must be connected to the output graph to tick.
  const outLeft  = el.mul(0.5, el.add(leftSelector, el.mul(0, scopeCarrier, scopeMod, scopeOutput)));
  const outRight = el.mul(0.5, rightSelector);
  return [outLeft, outRight];
}
/**
 * Copyright (c) 2026 NeverEngineLabs (www.neverenginelabs.com)
 * All rights reserved.
 *
 * Web UI composition source.
 * Not licensed for commercial derivatives or embedding in commercial products.
 */
