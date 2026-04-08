import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import WebRenderer from "./WebRenderer";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

const root = app;

function mustQuery<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing control: ${selector}`);
  }

  return element;
}

app.innerHTML = `
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>box-sum modulation demo</h3>
    <p>Uses <code>el.extra.boxSum(...)</code> to smooth white noise, then turns that moving sum into an audible filter sweep.</p>
    <p class="demo-link"><a href="/index.html">Back to the graph demo</a></p>
    <div class="controls">
      <button id="start" class="start-button">Start audio</button>
      <div class="row">
        <label for="window-hz">
          <span>Window</span>
          <span id="window-hz-value">0 Hz</span>
        </label>
        <input id="window-hz" type="range" min="0" max="60" value="0.1" step="0.001" />
      </div>
      <div class="row">
        <label for="center-hz">
          <span>Center cutoff</span>
          <span id="center-hz-value">900 Hz</span>
        </label>
        <input id="center-hz" type="range" min="80" max="5000" value="900" step="1" />
      </div>

      <div class="row">
        <label for="tone-hz">
          <span>Tone</span>
          <span id="tone-hz-value">180 Hz</span>
        </label>
        <input id="tone-hz" type="range" min="60" max="900" value="180" step="1" />
      </div>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

const startButton = mustQuery<HTMLButtonElement>("#start");
const windowHzSlider = mustQuery<HTMLInputElement>("#window-hz");
const centerHzSlider = mustQuery<HTMLInputElement>("#center-hz");
const toneHzSlider = mustQuery<HTMLInputElement>("#tone-hz");
const windowHzValue = mustQuery<HTMLSpanElement>("#window-hz-value");
const centerHzValue = mustQuery<HTMLSpanElement>("#center-hz-value");
const toneHzValue = mustQuery<HTMLSpanElement>("#tone-hz-value");
const status = mustQuery<HTMLDivElement>("#status");

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;

function updateSliderValues() {
  windowHzValue.textContent = `${Number(windowHzSlider.value)} Hz`;
  centerHzValue.textContent = `${Number(centerHzSlider.value)} Hz`;
  toneHzValue.textContent = `${Number(toneHzSlider.value)} Hz`;
}

function buildGraph(): NodeRepr_t[] {
  const noise = el.noise({ key: "boxsum:noise", seed: 7 }) ;
  const box = el.extra.boxSum({ key: "boxsum:filt", windowHz: Number(windowHzSlider.value) }, noise);
  const center = el.const({ key:'center', value: Number(centerHzSlider.value) });
  const low = el.const({ value: 303 });
  const high = el.const({ value: 8000 });
  const cutoff = el.max(
    low,
    el.min(high, el.add(center, el.mul( box, 202))),
  );

  const left = el.mul(
    0.32,
    el.lowpass(cutoff, 1, el.blepsaw(el.const({ key: 'blep:0', value: Number(toneHzSlider.value) }))),
  );

  const right = el.mul(
    0.32,
    el.lowpass(cutoff, 1, el.blepsaw(el.const({ key: 'blep:1', value: Number(toneHzSlider.value) * 1.01 }))),
  );

  return [left, right];
}

async function renderCurrentGraph() {
  if (!renderer || !audioContext) {
    return;
  }

  await audioContext.resume();
  await renderer.render(...buildGraph());
  updateSliderValues();
  status.textContent = "Playing box-sum demo";
}

async function ensureAudio() {
  if (audioContext && renderer) {
    return;
  }

  audioContext = new AudioContext();
  renderer = new WebRenderer();

  const worklet = await renderer.initialize(audioContext);
  worklet.connect(audioContext.destination);
}

const controls = [windowHzSlider, centerHzSlider, toneHzSlider];

controls.forEach((control) => {
  control.addEventListener("input", () => {
    updateSliderValues();

    if (renderer && audioContext?.state === "running") {
      void renderCurrentGraph();
    }
  });
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "Starting audio...";

  try {
    await ensureAudio();
    await renderCurrentGraph();
    status.textContent = "Audio running";
  } catch (error) {
    status.textContent = `Failed to start audio: ${error instanceof Error ? error.message : String(error)}`;
    startButton.disabled = false;
  }
});

updateSliderValues();
