/**
 * Preset-synth DSP demo graph.
 *
 * Authors a small subtractive synth whose parameters live inside a native
 * preset RAM bank built with `el.extra.presetWrite` / `el.extra.presetRead` /
 * `el.extra.presetMorph`.
 *
 * Lane layout (one lane per sample inside a slot frame):
 *   0  freq    (norm 0..1, mapped exp 40..2000 Hz)
 *   1  cutoff  (norm 0..1, mapped exp 80..16000 Hz)
 *   2  q       (norm 0..1, mapped linear 0.1..6)
 *   3  attack  (norm 0..1, mapped exp 0.001..2 s)
 *   4  decay   (norm 0..1, mapped exp 0.001..2 s)
 *   5  sustain (norm 0..1, mapped linear 0..1)
 *   6  release (norm 0..1, mapped exp 0.01..4 s)
 *   7  gain    (norm 0..1, mapped linear 0..1)
 */

import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";

export const FRAME_LENGTH = 8;
export const NUM_SLOTS = 4;
export const BANK_PATH = "preset-synth:bank";

export const LANE = {
  FREQ: 0,
  CUTOFF: 1,
  Q: 2,
  ATTACK: 3,
  DECAY: 4,
  SUSTAIN: 5,
  RELEASE: 6,
  GAIN: 7,
} as const;

export const BANK_METADATA = {
  schema: "preset-synth-mvp",
  version: 1,
  lanes: [
    { index: LANE.FREQ, name: "freqHz", min: 40, max: 2000, taper: "exp", unit: "Hz" },
    { index: LANE.CUTOFF, name: "cutoffHz", min: 80, max: 16000, taper: "exp", unit: "Hz" },
    { index: LANE.Q, name: "q", min: 0.1, max: 6, taper: "linear" },
    { index: LANE.ATTACK, name: "attackS", min: 0.001, max: 2, taper: "exp", unit: "s" },
    { index: LANE.DECAY, name: "decayS", min: 0.001, max: 2, taper: "exp", unit: "s" },
    { index: LANE.SUSTAIN, name: "sustain", min: 0, max: 1, taper: "linear" },
    { index: LANE.RELEASE, name: "releaseS", min: 0.01, max: 4, taper: "exp", unit: "s" },
    { index: LANE.GAIN, name: "gain", min: 0, max: 1, taper: "linear" },
  ],
  slotNames: ["slot 0", "slot 1", "slot 2", "slot 3"],
} as const;

export const BANK_PROPS = {
  path: BANK_PATH,
  framelength: FRAME_LENGTH,
  slots: NUM_SLOTS,
  metadata: BANK_METADATA,
};

export interface PresetSynthParams {
  /** Normalized 8-lane edit buffer the UI is currently editing. */
  editFrame: number[];
  /** Which slot the write path targets. */
  writeSlot: number;
  /** Morph source slot. */
  slotA: number;
  /** Morph destination slot. */
  slotB: number;
  /** Morph mix in [0, 1]. */
  morphMix: number;
  /** Monotonic counter that increments when the user clicks "Save". */
  writeCounter: number;
  /** Gate used to trigger the ADSR envelope. */
  gate: number;
  /** Musical base frequency in Hz (before preset frequency modulation). */
  baseFreq: number;
  /** Master output level in 0..1. */
  masterLevel: number;
  /** Whether audio is stopped. */
  isStopped?: boolean;
}

// ---------------------------------------------------------------------------
// helpers (graph-level denormalisers matching BANK_METADATA)
// ---------------------------------------------------------------------------

function denormExp(norm: NodeRepr_t, min: number, max: number): NodeRepr_t {
  // value = min * (max / min)^norm
  return el.mul(min, el.pow(max / min, norm));
}

function denormLin(norm: NodeRepr_t, min: number, max: number): NodeRepr_t {
  return el.add(min, el.mul(max - min, norm));
}

function lanePhase(laneIndex: number): NodeRepr_t {
  // Each lane sits at `lane / (framelength - 1)` as a normalized phase.
  const phase = laneIndex / (FRAME_LENGTH - 1);
  return el.const({ value: phase });
}

// ---------------------------------------------------------------------------
// build a mono frame where sample `lane` == editFrame[lane]
// ---------------------------------------------------------------------------

function buildEditFrame(editFrame: number[]): NodeRepr_t {
  // Walk lane indices 0..FRAME_LENGTH-1 once per frame using absolute sample
  // time. `el.time()` returns the runtime sample counter and `el.mod(..., L)`
  // cycles 0..L-1 exactly in lockstep with the native preset writer, which
  // drives its own frame boundaries from the same `ctx.userData` sample time.
  const laneIndex = el.mod(el.time(), FRAME_LENGTH);

  // Build a nested select that emits editFrame[floor(laneIndex)].
  //
  // Each lane value is carried on a keyed const so slider moves update the
  // const value in place during re-render instead of creating new anonymous
  // nodes each time. That keeps the captured frame in sync with the UI at
  // interactive rates.
  let value: NodeRepr_t = el.const({
    key: `preset-synth:edit:${FRAME_LENGTH - 1}`,
    value: editFrame[FRAME_LENGTH - 1] ?? 0,
  });
  for (let lane = FRAME_LENGTH - 2; lane >= 0; lane -= 1) {
    value = el.select(
      el.le(laneIndex, el.const({ value: lane + 0.5 })),
      el.const({ key: `preset-synth:edit:${lane}`, value: editFrame[lane] ?? 0 }),
      value,
    );
  }

  return value;
}

// ---------------------------------------------------------------------------
// main graph
// ---------------------------------------------------------------------------

export function buildGraph(p: PresetSynthParams): NodeRepr_t[] {
  if (p.isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  // 1. Edit frame -> preset writer. writeSlot and writeCounter are
  //    smoothed constants. When writeCounter changes, the UI has staged a
  //    save; the writer latches the slot and commits the current frame on
  //    the next frame boundary.
  const editFrame = buildEditFrame(p.editFrame);
  const writeSlotSignal = el.const({
    key: "preset-synth:writeSlot",
    value: Math.max(0, Math.min(NUM_SLOTS - 1, Math.floor(p.writeSlot))),
  });

  const writer = el.extra.presetWrite(
    { ...BANK_PROPS, key: "preset-synth:writer" },
    writeSlotSignal,
    editFrame,
  );

  // 2. Morph read for each lane. Per-lane phases are constants pointing at
  //    the sample offset for that lane; the reader linearly interpolates
  //    inside a slot, so using the exact lane phase returns that lane's
  //    stored value.
  const slotASignal = el.const({
    key: "preset-synth:slotA",
    value: Math.max(0, Math.min(NUM_SLOTS - 1, Math.floor(p.slotA))),
  });
  const slotBSignal = el.const({
    key: "preset-synth:slotB",
    value: Math.max(0, Math.min(NUM_SLOTS - 1, Math.floor(p.slotB))),
  });
  const morphMix = el.sm(
    el.const({ key: "preset-synth:morphMix", value: Math.max(0, Math.min(1, p.morphMix)) }),
  );

  function readLane(laneIndex: number, laneKey: string): NodeRepr_t {
    return el.sm(
      el.extra.presetMorph(
        { ...BANK_PROPS, key: `preset-synth:morph:${laneKey}` },
        slotASignal,
        slotBSignal,
        morphMix,
        lanePhase(laneIndex),
      ),
    );
  }

  const freqNorm = readLane(LANE.FREQ, "freq");
  const cutoffNorm = readLane(LANE.CUTOFF, "cutoff");
  const qNorm = readLane(LANE.Q, "q");
  const attackNorm = readLane(LANE.ATTACK, "attack");
  const decayNorm = readLane(LANE.DECAY, "decay");
  const sustainNorm = readLane(LANE.SUSTAIN, "sustain");
  const releaseNorm = readLane(LANE.RELEASE, "release");
  const gainNorm = readLane(LANE.GAIN, "gain");

  // 3. Denormalise lanes into real DSP parameters.
  const freqScale = denormExp(freqNorm, 40, 2000);
  const cutoffHz = denormExp(cutoffNorm, 80, 16000);
  const q = denormLin(qNorm, 0.1, 6);
  const attackS = denormExp(attackNorm, 0.001, 2);
  const decayS = denormExp(decayNorm, 0.001, 2);
  const sustain = denormLin(sustainNorm, 0, 1);
  const releaseS = denormExp(releaseNorm, 0.01, 4);
  const presetGain = denormLin(gainNorm, 0, 1);

  // 4. Musical synth: saw oscillator through a resonant lowpass,
  //    shaped by an ADSR driven by a slow 1 Hz 50% duty-cycle gate so the
  //    envelope actually reaches sustain and parameter edits are audible
  //    continuously. The "Hold note" button also sets the user gate high.
  const baseHz = el.const({ key: "preset-synth:baseHz", value: p.baseFreq });
  const oscHz = el.mul(baseHz, freqScale, 1 / 220); // `freqScale` (40..2000) normalised against 220 Hz reference

    const gateNode = el.square(1);

  const osc = el.saw(oscHz);
  const filtered = el.lowpass(cutoffHz, q, osc);

  const envelope = el.adsr(attackS, decayS, sustain, releaseS, gateNode);

  const voice = el.mul(filtered, envelope, presetGain);

  const masterLevel = el.sm(
    el.const({ key: "preset-synth:masterLevel", value: Math.max(0, Math.min(1, p.masterLevel)) }),
  );

  // Keep the writer alive in the graph without audible signal, same pattern
  // as `frameWriteRAM` demos. `writeCounter` is unused on the audio side
  // directly — the UI writes the edit frame contents continuously, and each
  // slot change re-triggers frame capture at the next boundary.
  const silentWriterTap = el.mul(writer, 0);
  const mono = el.mul(voice, masterLevel);

  return [mono, el.add(silentWriterTap, mono)];
}
