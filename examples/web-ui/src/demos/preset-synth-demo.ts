/**
 * elemaudio-rs preset synth demo
 *
 * Exercises `el.extra.presetWrite`, `el.extra.presetRead`, and
 * `el.extra.presetMorph` end-to-end by driving a small subtractive synth
 * whose parameters live inside a multi-slot preset RAM bank.
 */

import { el } from "@elem-rs/core";
import {
  BANK_METADATA,
  NUM_SLOTS,
  type PresetSynthParams,
  buildGraph as dspBuildGraph,
} from "../demo-dsp/preset-synth-demo.dsp";
import { initDemo } from "./demo-harness";

const denormalisePresetLane = el.extra.denormalisePresetLane;

// Lane schema is mirrored from BANK_METADATA so the UI and DSP agree on
// lane ordering and decoding.
const LANES = BANK_METADATA.lanes;

interface LaneControl {
  laneIndex: number;
  slider: HTMLInputElement;
  readout: HTMLSpanElement;
  name: string;
  unit?: string;
  min: number;
  max: number;
  taper: "linear" | "exp" | "quantize";
  defaultNorm: number;
}

// Per-slot default presets give users something musical to compare on load.
const DEFAULT_FRAMES: number[][] = [
  // slot 0: low bass, short pluck
  [0.15, 0.22, 0.4, 0.02, 0.3, 0.3, 0.3, 0.8],
  // slot 1: mid lead, bright
  [0.55, 0.75, 0.55, 0.1, 0.5, 0.55, 0.45, 0.7],
  // slot 2: pad, slow
  [0.35, 0.45, 0.35, 0.7, 0.6, 0.75, 0.85, 0.6],
  // slot 3: fat mid, ducking filter
  [0.45, 0.6, 0.75, 0.05, 0.7, 0.4, 0.55, 0.9],
];

const layout = `
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>preset synth demo</h3>
    <p>
      A subtractive synth whose parameters live inside a native preset RAM
      bank. <code>el.extra.presetWrite</code> commits the current edit frame
      into the selected slot on the next frame boundary.
      <code>el.extra.presetMorph</code> blends two slots at sample rate.
    </p>

    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>

      </div>

      <div class="row">
        <label for="base-freq">
          <span>Note Hz (musical root)</span>
          <span id="base-freq-value">220 Hz</span>
        </label>
        <input id="base-freq" type="range" min="55" max="880" value="220" step="1" />
      </div>

      <div class="row">
        <label for="master-level">
          <span>Master level</span>
          <span id="master-level-value">50%</span>
        </label>
        <input id="master-level" type="range" min="0" max="1" value="0.5" step="0.01" />
      </div>

      <div class="dial-strip" aria-label="Edit frame lanes">
        ${LANES.map(
          (lane) => `
            <div class="dial">
              <label for="lane-${lane.index}">
                <span>${lane.name}</span>
                <span id="lane-${lane.index}-value">—</span>
              </label>
              <input id="lane-${lane.index}" type="range" min="0" max="1" value="0.5" step="0.001" />
            </div>
          `,
        ).join("")}
      </div>

      <div class="row toggle-row">
        <label class="toggle-label" for="write-slot">
          <span>Edit target slot</span>
          <span id="write-slot-value">0</span>
        </label>
        <select id="write-slot" class="toggle-select">
          ${Array.from({ length: NUM_SLOTS }, (_, index) => `<option value="${index}">slot ${index}</option>`).join("")}
        </select>
      </div>

      <div class="button-row">
        <button id="save-preset" class="secondary">Save edit frame to slot</button>
        <button id="load-preset" class="secondary">Load slot into edit frame</button>
      </div>

      <div class="row toggle-row">
        <label class="toggle-label" for="slot-a">
          <span>Morph slot A</span>
          <span id="slot-a-value">0</span>
        </label>
        <select id="slot-a" class="toggle-select">
          ${Array.from({ length: NUM_SLOTS }, (_, index) => `<option value="${index}">slot ${index}</option>`).join("")}
        </select>
      </div>

      <div class="row toggle-row">
        <label class="toggle-label" for="slot-b">
          <span>Morph slot B</span>
          <span id="slot-b-value">1</span>
        </label>
        <select id="slot-b" class="toggle-select">
          ${Array.from({ length: NUM_SLOTS }, (_, index) => `<option value="${index}">slot ${index}</option>`).join("")}
        </select>
      </div>

      <div class="row">
        <label for="morph-mix">
          <span>Morph A→B</span>
          <span id="morph-mix-value">0%</span>
        </label>
        <input id="morph-mix" type="range" min="0" max="1" value="0" step="0.001" />
      </div>

      <div class="status" id="status">Idle</div>
      <div class="resource-status" id="preset-status">No preset loaded yet</div>
    </div>
  </div>
`;

// ---- state -----------------------------------------------------------------

const editFrame = DEFAULT_FRAMES[0].slice();
let writeSlot = 0;
let slotA = 0;
let slotB = 1;
let morphMix = 0;
let writeCounter = 0;
let gate = 0;
let baseFreq = 220;
let masterLevel = 0.5;
let isStopped = false;

// ---- bindings (filled after initDemo) --------------------------------------

let laneControls: LaneControl[] = [];
let writeSlotSelect: HTMLSelectElement;
let writeSlotValue: HTMLSpanElement;
let slotASelect: HTMLSelectElement;
let slotAValue: HTMLSpanElement;
let slotBSelect: HTMLSelectElement;
let slotBValue: HTMLSpanElement;
let morphMixSlider: HTMLInputElement;
let morphMixValue: HTMLSpanElement;
let baseFreqSlider: HTMLInputElement;
let baseFreqValue: HTMLSpanElement;
let masterLevelSlider: HTMLInputElement;
let masterLevelValue: HTMLSpanElement;
let saveButton: HTMLButtonElement;
let loadButton: HTMLButtonElement;
let gateButton: HTMLButtonElement;
let stopButton: HTMLButtonElement;
let presetStatus: HTMLDivElement;

function formatLaneValue(control: LaneControl, value: number): string {
  const denorm = denormalisePresetLane(
    { index: control.laneIndex, name: control.name, min: control.min, max: control.max, taper: control.taper },
    value,
  );
  if (control.unit === "Hz") {
    return denorm >= 1000 ? `${(denorm / 1000).toFixed(2)} kHz` : `${denorm.toFixed(1)} Hz`;
  }
  if (control.unit === "s") {
    return `${denorm.toFixed(3)} s`;
  }
  if (control.taper === "linear" && control.min === 0 && control.max === 1) {
    return `${Math.round(denorm * 100)}%`;
  }
  return denorm.toFixed(2);
}

function params(): PresetSynthParams {
  return {
    editFrame: editFrame.slice(),
    writeSlot,
    slotA,
    slotB,
    morphMix,
    writeCounter,
    gate,
    baseFreq,
    masterLevel,
    isStopped,
  };
}

function updateReadouts() {
  laneControls.forEach((control) => {
    control.readout.textContent = formatLaneValue(control, Number(control.slider.value));
  });
  writeSlotValue.textContent = String(writeSlot);
  slotAValue.textContent = String(slotA);
  slotBValue.textContent = String(slotB);
  morphMixValue.textContent = `${Math.round(morphMix * 100)}%`;
  baseFreqValue.textContent = `${baseFreq.toFixed(0)} Hz`;
  masterLevelValue.textContent = `${Math.round(masterLevel * 100)}%`;
}

function syncEditFrameFromSliders() {
  laneControls.forEach((control) => {
    editFrame[control.laneIndex] = Number(control.slider.value);
  });
}

function syncSlidersFromEditFrame() {
  laneControls.forEach((control) => {
    control.slider.value = String(editFrame[control.laneIndex] ?? 0);
  });
}

// ---- initialise the demo through the shared harness ------------------------

const { mustQuery: q, renderCurrentGraph } = initDemo({
  layout,
  buildGraph: () => dspBuildGraph(params()),
  updateReadouts,
  persistKey: "no-persist",
});

// ---- wire controls ---------------------------------------------------------

writeSlotSelect = q<HTMLSelectElement>("#write-slot");
writeSlotValue = q<HTMLSpanElement>("#write-slot-value");
slotASelect = q<HTMLSelectElement>("#slot-a");
slotAValue = q<HTMLSpanElement>("#slot-a-value");
slotBSelect = q<HTMLSelectElement>("#slot-b");
slotBValue = q<HTMLSpanElement>("#slot-b-value");
morphMixSlider = q<HTMLInputElement>("#morph-mix");
morphMixValue = q<HTMLSpanElement>("#morph-mix-value");
baseFreqSlider = q<HTMLInputElement>("#base-freq");
baseFreqValue = q<HTMLSpanElement>("#base-freq-value");
masterLevelSlider = q<HTMLInputElement>("#master-level");
masterLevelValue = q<HTMLSpanElement>("#master-level-value");
saveButton = q<HTMLButtonElement>("#save-preset");
loadButton = q<HTMLButtonElement>("#load-preset");
stopButton = q<HTMLButtonElement>("#stop");
presetStatus = q<HTMLDivElement>("#preset-status");

slotBSelect.value = String(slotB);

laneControls = LANES.map((lane) => {
  const slider = q<HTMLInputElement>(`#lane-${lane.index}`);
  const readout = q<HTMLSpanElement>(`#lane-${lane.index}-value`);
  const defaultNorm = editFrame[lane.index] ?? 0.5;
  slider.value = String(defaultNorm);

  const taper: "linear" | "exp" | "quantize" =
    lane.taper === "exp" || lane.taper === "quantize" ? lane.taper : "linear";

  const control: LaneControl = {
    laneIndex: lane.index,
    slider,
    readout,
    name: lane.name,
    unit: lane.unit,
    min: lane.min ?? 0,
    max: lane.max ?? 1,
    taper,
    defaultNorm,
  };

  slider.addEventListener("input", () => {
    editFrame[lane.index] = Number(slider.value);
    updateReadouts();
    void renderCurrentGraph();
  });

  slider.addEventListener("dblclick", (event) => {
    event.preventDefault();
    slider.value = String(control.defaultNorm);
    editFrame[lane.index] = control.defaultNorm;
    updateReadouts();
    void renderCurrentGraph();
  });

  return control;
});

writeSlotSelect.addEventListener("change", () => {
  writeSlot = Number(writeSlotSelect.value);
  updateReadouts();
  void renderCurrentGraph();
});

slotASelect.addEventListener("change", () => {
  slotA = Number(slotASelect.value);
  updateReadouts();
  void renderCurrentGraph();
});

slotBSelect.addEventListener("change", () => {
  slotB = Number(slotBSelect.value);
  updateReadouts();
  void renderCurrentGraph();
});

morphMixSlider.addEventListener("input", () => {
  morphMix = Number(morphMixSlider.value);
  updateReadouts();
  void renderCurrentGraph();
});

baseFreqSlider.addEventListener("input", () => {
  baseFreq = Number(baseFreqSlider.value);
  updateReadouts();
  void renderCurrentGraph();
});

masterLevelSlider.addEventListener("input", () => {
  masterLevel = Number(masterLevelSlider.value);
  updateReadouts();
  void renderCurrentGraph();
});


const releaseGate = () => {
  if (gate !== 0) {
    gate = 0;
    void renderCurrentGraph();
  }
};


saveButton.addEventListener("click", async () => {
  syncEditFrameFromSliders();
  writeCounter += 1;
  presetStatus.textContent = `Saved edit frame into slot ${writeSlot} (write #${writeCounter})`;
  await renderCurrentGraph();
});

loadButton.addEventListener("click", async () => {
  const defaults = DEFAULT_FRAMES[writeSlot];
  if (defaults) {
    for (let i = 0; i < editFrame.length; i += 1) {
      editFrame[i] = defaults[i] ?? 0;
    }
    syncSlidersFromEditFrame();
    updateReadouts();
    presetStatus.textContent = `Loaded preset defaults for slot ${writeSlot} into edit frame`;
    await renderCurrentGraph();
  }
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  await renderCurrentGraph();
});

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

// On first load, seed all four slots by writing their defaults so morphing
// between slots is immediately meaningful. Each call increments writeCounter
// to force the graph to rebuild, so the native writer sees the new frame.
(async () => {
  for (let slot = 0; slot < NUM_SLOTS; slot += 1) {
    writeSlot = slot;
    const defaults = DEFAULT_FRAMES[slot];
    if (!defaults) continue;
    for (let i = 0; i < editFrame.length; i += 1) {
      editFrame[i] = defaults[i] ?? 0;
    }
    writeCounter += 1;
  }

  writeSlot = 0;
  for (let i = 0; i < editFrame.length; i += 1) {
    editFrame[i] = DEFAULT_FRAMES[0][i] ?? 0;
  }
  syncSlidersFromEditFrame();
  writeSlotSelect.value = "0";
  slotASelect.value = "0";
  slotBSelect.value = "1";
  updateReadouts();
  presetStatus.textContent = `Seeded ${NUM_SLOTS} slots with demo presets`;
})();
