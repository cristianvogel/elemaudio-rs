/**
 * elemaudiors preset synth demo
 *
 * Exercises `el.extra.presetWrite`, `el.extra.presetRead`, and
 * `el.extra.presetMorph` end-to-end by driving a small subtractive synth
 * whose parameters live inside a multi-slot preset RAM bank.
 */

import { el } from "@elem-rs/core";
import {
    BANK_METADATA,
    EDIT_FRAME_SCOPE_EVENT,
    FRAME_LENGTH,
    NUM_SLOTS,
    type PresetSynthParams,
    buildGraph as dspBuildGraph, ACTIVE_FRAME_SCOPE_EVENT
} from "../demo-dsp/preset-synth-demo.dsp";
import { initDemo } from "./demo-harness";

const denormalisePresetLane = el.extra.denormalisePresetLane;
const PRESET_SYNTH_STORAGE_KEY = "elemaudiors:preset-synth-demo:v1";

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

const INITIAL_EDIT_FRAME = [0.25, 0.35, 0.4, 0.03, 0.3, 0.5, 0.35, 0.75];

const layout = `
  <div class="panel">
    <h1>elemaudiors</h1>
    <h3>preset synth demo</h3>
      <p>
        A subtractive synth whose parameters live inside a native preset RAM
        bank. The sliders update the synth live; <code>el.extra.presetWrite</code>
        commits the current edit frame into the selected slot.
        <code>el.extra.presetMorph</code> blends edit slot with a target preset at frame rate.
      </p>

    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>
      </div>

      <div class="preset-scope-wrap">
        <div class="preset-scope-title">
          <span>Settings</span>
          <div id="preset-badges" class="preset-badges">
            ${Array.from({ length: NUM_SLOTS }, (_, index) => `
              <button id="preset-badge-${index}" class="preset-badge" type="button">Preset${String(index).padStart(2, "0")}</button>
            `).join("")}
          </div>
          <span id="scope-legend">
            <span class="preset-scope-legend edit">edit</span>
            <span class="preset-scope-legend active">morph</span>
          </span>
        </div>
        <canvas id="preset-scope" class="preset-scope" width="640" height="160"></canvas>
        <div class="resource-status">Drag the blue edit bars on the canvas to shape the live frame. Purple bars represent the current morph.</div>
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

      <div class="dial-strip" aria-label="Edit frame lanes" style="display:none">
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

      <div class="button-row">
        <button id="save-preset" class="secondary">Save to selected preset</button>
      </div>

      <div class="row toggle-row">
        <label class="toggle-label" for="slot-b">
          <span>Morph target slot</span>
          <span id="slot-b-value">1</span>
        </label>
        <select id="slot-b" class="toggle-select">
          ${Array.from({ length: NUM_SLOTS }, (_, index) => `<option value="${index}">slot ${index}</option>`).join("")}
        </select>
      </div>

      <div class="row">
        <label for="morph-mix">
          <span>Morph Live → Target</span>
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

const editFrame = INITIAL_EDIT_FRAME.slice();
const savedFrames: Array<number[] | null> = Array.from({ length: NUM_SLOTS }, () => null);
let writeSlot = 0;
let slotB = 1;
let morphMix = 0;
let writeCounter = 0;
let gate = 0;
let baseFreq = 220;
let masterLevel = 0.5;
let isStopped = false;

let lastEditFrameSample: number[] = new Array(FRAME_LENGTH).fill(0);
let lastActiveFrameSample: number[] = new Array(FRAME_LENGTH).fill(0);

// ---- bindings (filled after initDemo) --------------------------------------

let laneControls: LaneControl[] = [];
let slotBSelect: HTMLSelectElement;
let slotBValue: HTMLSpanElement;
let morphMixSlider: HTMLInputElement;
let morphMixValue: HTMLSpanElement;
let baseFreqSlider: HTMLInputElement;
let baseFreqValue: HTMLSpanElement;
let masterLevelSlider: HTMLInputElement;
let masterLevelValue: HTMLSpanElement;
let saveButton: HTMLButtonElement;
let stopButton: HTMLButtonElement;
let startButton: HTMLButtonElement;
let presetStatus: HTMLDivElement;
let activePointerId: number | null = null;
let presetBadgeButtons: HTMLButtonElement[] = [];

type PersistedPresetSynthState = {
  editFrame: number[];
  savedFrames: Array<number[] | null>;
  writeSlot: number;
  slotB: number;
  morphMix: number;
  baseFreq: number;
  masterLevel: number;
};

function presetName(index: number): string {
  return `Preset${String(index).padStart(2, "0")}`;
}

function cloneSavedFrames(frames: Array<number[] | null>): Array<number[] | null> {
  return frames.map((frame) => (frame ? frame.slice() : null));
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(PRESET_SYNTH_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedPresetSynthState> | null;
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (Array.isArray(parsed.editFrame)) {
      for (let i = 0; i < FRAME_LENGTH; i += 1) {
        const value = Number(parsed.editFrame[i]);
        editFrame[i] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : editFrame[i];
      }
    }

    if (Array.isArray(parsed.savedFrames)) {
      for (let i = 0; i < NUM_SLOTS; i += 1) {
        const frame = parsed.savedFrames[i];
        if (Array.isArray(frame)) {
          savedFrames[i] = frame.slice(0, FRAME_LENGTH).map((value) => {
            const num = Number(value);
            return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : 0;
          });
          while ((savedFrames[i]?.length ?? 0) < FRAME_LENGTH) {
            savedFrames[i]?.push(0);
          }
        } else {
          savedFrames[i] = null;
        }
      }
    }

    if (Number.isFinite(parsed.writeSlot)) {
      writeSlot = Math.max(0, Math.min(NUM_SLOTS - 1, Math.floor(parsed.writeSlot as number)));
    }
    if (Number.isFinite(parsed.slotB)) {
      slotB = Math.max(0, Math.min(NUM_SLOTS - 1, Math.floor(parsed.slotB as number)));
    }
    if (Number.isFinite(parsed.morphMix)) {
      morphMix = Math.max(0, Math.min(1, parsed.morphMix as number));
    }
    if (Number.isFinite(parsed.baseFreq)) {
      baseFreq = Math.max(55, Math.min(880, parsed.baseFreq as number));
    }
    if (Number.isFinite(parsed.masterLevel)) {
      masterLevel = Math.max(0, Math.min(1, parsed.masterLevel as number));
    }
  } catch {
    // Ignore malformed persisted state during development.
  }
}

function persistState() {
  const state: PersistedPresetSynthState = {
    editFrame: editFrame.slice(),
    savedFrames: cloneSavedFrames(savedFrames),
    writeSlot,
    slotB,
    morphMix,
    baseFreq,
    masterLevel,
  };

  try {
    localStorage.setItem(PRESET_SYNTH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures during development.
  }
}

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
  slotBValue.textContent = String(slotB);
  morphMixValue.textContent = `${Math.round(morphMix * 100)}%`;
  baseFreqValue.textContent = `${baseFreq.toFixed(0)} Hz`;
  masterLevelValue.textContent = `${Math.round(masterLevel * 100)}%`;
}

function refreshPresetBadges() {
  presetBadgeButtons.forEach((button, index) => {
    const isSelected = index === writeSlot;
    const isSaved = savedFrames[index] !== null;
    button.dataset.selected = isSelected ? "true" : "false";
    button.dataset.saved = isSaved ? "true" : "false";
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
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

function refreshEditFrameView() {
  syncSlidersFromEditFrame();
  updateReadouts();
  lastEditFrameSample = editFrame.slice();
  drawScope();
}

loadPersistedState();

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
  drawScope();
}

const { mustQuery: q, renderCurrentGraph } = initDemo({
  layout,
  buildGraph: () => dspBuildGraph(params()),
  updateReadouts,
  onScopeEvent: handleScopeEvent,
  onAudioReady: () => {
    window.setTimeout(() => {
      void seedBankFromSavedFrames();
    }, 50);
  },
});

// ---- wire controls ---------------------------------------------------------

slotBSelect = q<HTMLSelectElement>("#slot-b");
slotBValue = q<HTMLSpanElement>("#slot-b-value");
morphMixSlider = q<HTMLInputElement>("#morph-mix");
morphMixValue = q<HTMLSpanElement>("#morph-mix-value");
baseFreqSlider = q<HTMLInputElement>("#base-freq");
baseFreqValue = q<HTMLSpanElement>("#base-freq-value");
masterLevelSlider = q<HTMLInputElement>("#master-level");
masterLevelValue = q<HTMLSpanElement>("#master-level-value");
saveButton = q<HTMLButtonElement>("#save-preset");
startButton = q<HTMLButtonElement>("#start");
stopButton = q<HTMLButtonElement>("#stop");
presetStatus = q<HTMLDivElement>("#preset-status");
const scopeCanvas = q<HTMLCanvasElement>("#preset-scope");
const presetBadgesHost = q<HTMLDivElement>("#preset-badges");
presetBadgeButtons = Array.from(presetBadgesHost.querySelectorAll<HTMLButtonElement>(".preset-badge"));
scopeCanvas.style.cursor = "crosshair";
scopeCanvas.style.touchAction = "none";

// ---- scope drawing --------------------------------------------------------

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

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

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
    const editVal = lastEditFrameSample[lane] ?? 0;
    const activeVal = lastActiveFrameSample[lane] ?? 0;

    const editH = editVal * (cssHeight - padding * 2);
    const activeH = activeVal * (cssHeight - padding * 2);

    // Edit (ghosted left half of the lane)
    ctx.fillStyle = "rgb(34,52,255)";
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
}

async function seedBankFromSavedFrames() {
  const originalEditFrame = editFrame.slice();
  const originalWriteSlot = writeSlot;
  const originalWriteCounter = writeCounter;

  let wroteAny = false;
  for (let slot = 0; slot < NUM_SLOTS; slot += 1) {
    const saved = savedFrames[slot];
    if (!saved) {
      continue;
    }

    wroteAny = true;
    cloneIntoEditFrame(saved);
    writeSlot = slot;
    writeCounter += 1;
    await renderCurrentGraph();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  cloneIntoEditFrame(originalEditFrame);
  writeSlot = originalWriteSlot;
  writeCounter = originalWriteCounter;
  refreshEditFrameView();

  if (wroteAny) {
    await renderCurrentGraph();
  }
}


window.addEventListener("resize", () => {
  drawScope();
});

function updateEditFrameFromCanvas(clientX: number, clientY: number): boolean {
  const rect = scopeCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const padding = 8;
  const usableWidth = rect.width - padding * 2;
  const usableHeight = rect.height - padding * 2;
  if (usableWidth <= 0 || usableHeight <= 0) {
    return false;
  }

  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const laneWidth = usableWidth / FRAME_LENGTH;
  const lane = Math.max(0, Math.min(FRAME_LENGTH - 1, Math.floor((localX - padding) / laneWidth)));
  const norm = Math.max(0, Math.min(1, 1 - ((localY - padding) / usableHeight)));

  if (!Number.isFinite(norm) || editFrame[lane] === norm) {
    return false;
  }

  editFrame[lane] = norm;
  refreshEditFrameView();
  persistState();
  return true;
}

scopeCanvas.addEventListener("pointerdown", (event) => {
  activePointerId = event.pointerId;
  scopeCanvas.setPointerCapture(event.pointerId);
  if (updateEditFrameFromCanvas(event.clientX, event.clientY)) {
    void renderCurrentGraph();
  }
});

scopeCanvas.addEventListener("pointermove", (event) => {
  if (activePointerId !== event.pointerId) {
    return;
  }

  if (updateEditFrameFromCanvas(event.clientX, event.clientY)) {
    void renderCurrentGraph();
  }
});

function endCanvasEdit(event: PointerEvent) {
  if (activePointerId !== event.pointerId) {
    return;
  }

  activePointerId = null;
  if (scopeCanvas.hasPointerCapture(event.pointerId)) {
    scopeCanvas.releasePointerCapture(event.pointerId);
  }
}

scopeCanvas.addEventListener("pointerup", endCanvasEdit);
scopeCanvas.addEventListener("pointercancel", endCanvasEdit);

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
    refreshEditFrameView();
    void renderCurrentGraph();
  });

  slider.addEventListener("dblclick", (event) => {
    event.preventDefault();
    slider.value = String(control.defaultNorm);
    editFrame[lane.index] = control.defaultNorm;
    refreshEditFrameView();
    void renderCurrentGraph();
  });

  return control;
});

presetBadgeButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    writeSlot = index;
    slotB = index;
    slotBSelect.value = String(index);
    refreshPresetBadges();
    const saved = savedFrames[index];
    if (saved) {
      cloneIntoEditFrame(saved);
      refreshEditFrameView();
      presetStatus.textContent = `Loaded ${presetName(index)} into the edit frame`;
    } else {
      presetStatus.textContent = `${presetName(index)} selected for saving`;
    }
    updateReadouts();
    persistState();
    void renderCurrentGraph();
  });
});

slotBSelect.addEventListener("change", () => {
  slotB = Number(slotBSelect.value);
  updateReadouts();
  persistState();
  void renderCurrentGraph();
});

morphMixSlider.addEventListener("input", () => {
  morphMix = Number(morphMixSlider.value);
  updateReadouts();
  persistState();
  void renderCurrentGraph();
});

baseFreqSlider.addEventListener("input", () => {
  baseFreq = Number(baseFreqSlider.value);
  updateReadouts();
  persistState();
  void renderCurrentGraph();
});

masterLevelSlider.addEventListener("input", () => {
  masterLevel = Number(masterLevelSlider.value);
  updateReadouts();
  persistState();
  void renderCurrentGraph();
});



saveButton.addEventListener("click", async () => {
  syncEditFrameFromSliders();
  savedFrames[writeSlot] = editFrame.slice();
  writeCounter += 1;
  refreshPresetBadges();
  presetStatus.textContent = `Saved edit frame into ${presetName(writeSlot)} (write #${writeCounter})`;
  drawScope();
  persistState();
  await renderCurrentGraph();
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  // Use stopAudio from harness if we want a clean fade,
});

startButton.addEventListener("click", async () => {
  isStopped = false;
  // harness ensures audio and then calls renderCurrentGraph
});

// Draw the default edit frame immediately so the scope is not blank before
// the first scope event arrives from the audio thread.
lastEditFrameSample = editFrame.slice();
lastActiveFrameSample = new Array(FRAME_LENGTH).fill(0);

syncSlidersFromEditFrame();
slotBSelect.value = String(slotB);
morphMixSlider.value = String(morphMix);
baseFreqSlider.value = String(baseFreq);
masterLevelSlider.value = String(masterLevel);
updateReadouts();
refreshPresetBadges();
drawScope();
