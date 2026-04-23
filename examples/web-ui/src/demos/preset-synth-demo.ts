/**
 * elemaudiors preset synth demo
 *
 * Exercises `el.extra.presetWrite`, `el.extra.presetRead`, and
 * `el.extra.presetMorph` end-to-end by driving a small subtractive synth
 * whose parameters live inside a multi-slot preset RAM bank.
 */

import { el } from "@elem-rs/core";
import {
  ACTIVE_FRAME_SCOPE_EVENT,
  BANK_METADATA,
  EDIT_FRAME_SCOPE_EVENT,
  FRAME_LENGTH,
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
    <h1>elemaudiors</h1>
    <h3>preset synth demo</h3>
      <p>
        A subtractive synth whose parameters live inside a native preset RAM
        bank. The sliders update the synth live; <code>el.extra.presetWrite</code>
        commits the current edit frame into the selected slot on the next frame
        boundary.
        <code>el.extra.presetMorph</code> blends two slots at sample rate.
      </p>

    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>
      </div>

      <div class="preset-scope-wrap">
        <div class="preset-scope-title">
          <span>Preset frame scope</span>
          <span id="scope-legend">
            <span class="preset-scope-legend edit">edit</span>
            <span class="preset-scope-legend active">morph</span>
          </span>
        </div>
        <canvas id="preset-scope" class="preset-scope" width="640" height="160"></canvas>
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
const savedFrames = DEFAULT_FRAMES.map((frame) => frame.slice());
let writeSlot = 0;
let slotA = 0;
let slotB = 1;
let morphMix = 0;
let writeCounter = 0;
let gate = 0;
let baseFreq = 220;
let masterLevel = 0.5;
let isStopped = false;

let lastEditFrameSample: number[] = new Array(FRAME_LENGTH).fill(0);
let lastActiveFrameSample: number[] = new Array(FRAME_LENGTH).fill(0);
let bankSeeded = false;

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
let stopButton: HTMLButtonElement;
let startButton: HTMLButtonElement;
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
    baseFreq,
    masterLevel,
    isStopped,
  };
}

function cloneIntoEditFrame(frame: number[]) {
  for (let i = 0; i < FRAME_LENGTH; i += 1) {
    editFrame[i] = frame[i] ?? 0;
  }
  syncSlidersFromEditFrame();
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

type ScopePayload = {
  source?: string;
  data?: number[][];
};

function handleScopeEvent(event: unknown) {
  const payload = event as ScopePayload;
  if (!payload || typeof payload.source !== "string" || !Array.isArray(payload.data)) {
    return;
  }

  const channel = payload.data[0];
  if (!Array.isArray(channel) || channel.length === 0) {
    return;
  }

  const frame = channel.slice(0, FRAME_LENGTH);
  // Pad short frames so the renderer always has FRAME_LENGTH entries.
  while (frame.length < FRAME_LENGTH) {
    frame.push(0);
  }

  if (payload.source === EDIT_FRAME_SCOPE_EVENT) {
    lastEditFrameSample = frame;
  } else if (payload.source === ACTIVE_FRAME_SCOPE_EVENT) {
    lastActiveFrameSample = frame;
  } else {
    return;
  }
  scheduleScopeDraw();
}

const { mustQuery: q, renderCurrentGraph } = initDemo({
  layout,
  buildGraph: () => dspBuildGraph(params()),
  updateReadouts,
  onScopeEvent: handleScopeEvent,
  onAudioReady: () => {
    // Seed the preset bank once the worklet is live. A short timeout lets the
    // harness complete its initial render before the explicit save passes run.
    window.setTimeout(() => {
      if (!bankSeeded) {
        void seedBank();
      }
    }, 50);
  },
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
startButton = q<HTMLButtonElement>("#start");
stopButton = q<HTMLButtonElement>("#stop");
presetStatus = q<HTMLDivElement>("#preset-status");
const scopeCanvas = q<HTMLCanvasElement>("#preset-scope");

// ---- scope drawing --------------------------------------------------------

let scopeDrawScheduled = false;

function scheduleScopeDraw() {

  if (scopeDrawScheduled) return;
  scopeDrawScheduled = true;
  requestAnimationFrame(() => {
      drawScope();
    scopeDrawScheduled = false;
  });
}

function drawScope() {
  const ctx = scopeCanvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = scopeCanvas.clientWidth || scopeCanvas.width;
  const cssHeight = scopeCanvas.clientHeight || scopeCanvas.height;
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));

  if (scopeCanvas.width !== width || scopeCanvas.height !== height) {
    scopeCanvas.width = width;
    scopeCanvas.height = height;
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  // Background + grid
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let y = 0; y <= 4; y += 1) {
    const yy = (y / 4) * cssHeight;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(cssWidth, yy);
    ctx.stroke();
  }

  const padding = 8;
  const laneWidth = (cssWidth - padding * 2) / FRAME_LENGTH;
  const barInnerGap = Math.max(2, laneWidth * 0.1);
  const halfBarWidth = Math.max(4, laneWidth * 0.35);

  for (let lane = 0; lane < FRAME_LENGTH; lane += 1) {
    const laneX = padding + lane * laneWidth + laneWidth / 2;

    //bug: both of these are not being updated??
      const editVal = lastEditFrameSample[lane] ?? 0;
      const activeVal = lastActiveFrameSample[lane] ?? 0;

    const editH = editVal * (cssHeight - padding * 2);
    const activeH = activeVal * (cssHeight - padding * 2);

    // Edit (ghosted left half of the lane)
    ctx.fillStyle = "rgba(110, 168, 254, 0.45)";
    ctx.fillRect(laneX - halfBarWidth, cssHeight - padding - editH, halfBarWidth - barInnerGap / 2, editH);

    // Active / morph (solid right half)
    ctx.fillStyle = "rgba(139, 92, 246, 0.85)";
    ctx.fillRect(laneX + barInnerGap / 2, cssHeight - padding - activeH, halfBarWidth - barInnerGap / 2, activeH);

    // Lane label
    ctx.fillStyle = "#9fb0c3";
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    const laneMeta = BANK_METADATA.lanes[lane];
    const label = laneMeta ? laneMeta.name : `L${lane}`;
    ctx.fillText(label, laneX, cssHeight - 2);
  }

  ctx.restore();
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

window.addEventListener("resize", scheduleScopeDraw);


slotBSelect.value = String(slotB);

laneControls = LANES.map((lane) => {
  const slider = q<HTMLInputElement>(`#lane-${lane.index}`);
  const readout = q<HTMLSpanElement>(`#lane-${lane.index}-value`);
  const defaultNorm = editFrame[lane.index] ?? 0.5;
  slider.value = String(defaultNorm);


    const taper: "linear" | "exp" | "quantize" =
        // @ts-ignore
    lane.taper === "exp" || lane.taper === "quantize" ? lane.taper : "linear";

  const control: LaneControl = {
    laneIndex: lane.index,
    slider,
    readout,
    name: lane.name,
    min: lane.min ?? 0,
    max: lane.max ?? 1,
    taper,
    defaultNorm,
  };

  slider.addEventListener("input", () => {
    editFrame[lane.index] = Number(slider.value);
    updateReadouts();
    void renderCurrentGraph();
      scheduleScopeDraw();
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



saveButton.addEventListener("click", async () => {
  syncEditFrameFromSliders();
  savedFrames[writeSlot] = editFrame.slice();
  writeCounter += 1;
  presetStatus.textContent = `Saved edit frame into slot ${writeSlot} (write #${writeCounter})`;
  drawScope();
  await renderCurrentGraph();
});

loadButton.addEventListener("click", async () => {
  const saved = savedFrames[writeSlot];
  if (saved) {
    cloneIntoEditFrame(saved);
    updateReadouts();
    presetStatus.textContent = `Loaded saved slot ${writeSlot} into the edit frame`;
    drawScope();
    await renderCurrentGraph();
  }
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  // Use stopAudio from harness if we want a clean fade,
});

startButton.addEventListener("click", async () => {
  isStopped = false;
  // harness ensures audio and then calls renderCurrentGraph
});

// Seed all four slots by writing their defaults so morphing between slots is
// immediately meaningful. Each pass increments writeCounter, which arms the
// native writer for exactly one frame commit.
const seedBank = async () => {
  if (bankSeeded) {
    return;
  }

  for (let slot = 0; slot < NUM_SLOTS; slot += 1) {
    writeSlot = slot;
    const defaults = savedFrames[slot];
    if (!defaults) continue;
    cloneIntoEditFrame(defaults);
    writeCounter += 1;
    await renderCurrentGraph();
    // Give the audio thread enough time to cross at least one frame boundary.
    await new Promise(resolve => setTimeout(resolve, 40));
  }

  writeSlot = 0;
  cloneIntoEditFrame(savedFrames[0]);
  writeSlotSelect.value = "0";
  slotASelect.value = "0";
  slotBSelect.value = "1";
  updateReadouts();
  bankSeeded = true;
  presetStatus.textContent = `Seeded ${NUM_SLOTS} slots with demo presets`;
};

// Draw the default edit frame immediately so the scope is not blank before
// the first scope event arrives from the audio thread.
lastEditFrameSample = editFrame.slice();
lastActiveFrameSample = savedFrames[0].slice();

scheduleScopeDraw();
