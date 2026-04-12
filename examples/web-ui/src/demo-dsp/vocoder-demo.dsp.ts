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
  /** VFS path for the carrier sample (mc-test.wav). */
  carrierPath?: string;
  /** VFS path for the modulator sample. */
  modPath?: string;
}

export function buildGraph(p: VocoderParams): NodeRepr_t[] {

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

  // ---- Mix (dry carrier / wet vocoded) ----
  const mix = el.const({ key: "vocoder:mix", value: p.mix });
  const leftSelector =   el.select(mix, vocodedL, carrierL);
  const rightSelector =  el.select(mix, vocodedR, carrierR);

  // ---- Scope inserts (carrier, modulator, output) ----
  const scopeCarrier = el.scope({ name: SCOPE_CARRIER, size: TIME_SCALE, channels: 1 }, carrierL);
  const scopeMod     = el.scope({ name: SCOPE_MOD,     size: TIME_SCALE, channels: 1 }, modL);
  const scopeOutput  = el.scope({ name: SCOPE_OUTPUT,  size: TIME_SCALE, channels: 1 }, leftSelector);

  // Scope nodes must be connected to the output graph to tick.
  const outLeft  = el.mul(0.5, el.add(leftSelector, el.mul(0, scopeCarrier, scopeMod, scopeOutput)));
  const outRight = el.mul(0.5, rightSelector);
  return [outLeft, outRight];
}
