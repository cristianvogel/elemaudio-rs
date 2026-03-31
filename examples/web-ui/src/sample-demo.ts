import { el } from "@elem-rs/core";
import type { NodeRepr_t } from "@elem-rs/core";
import WebRenderer from "./WebRenderer";
import sampleUrl from "../../demo-resources/115bpm_808_Beat_mono.wav?url";
import "./style.css";

const bundledSamplePath = "demo-resources/115bpm_808_Beat_mono.wav";
let samplePath = bundledSamplePath;

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
    <h1>elemaudio-rs sample demo</h1>
    <p>Loads a sample from <code>demo-resources/</code> and plays it through <code>el.sample(...)</code>.</p>
    <p class="demo-link"><a href="/index.html">Back to the graph demo</a></p>
    <p class="demo-link"><a href="/resource-manager.html">Open the Rust resource manager demo</a></p>
    <div class="controls">
      <div class="row">
        <label for="rate">
          <span>Playback rate</span>
          <span id="rate-value">1.00x</span>
        </label>
        <input id="rate" type="range" min="0.5" max="1.5" value="1" step="0.01" />
      </div>
      <div class="row">
        <label for="sample-file">
          <span>Browser file</span>
          <span id="sample-file-name">Built-in sample</span>
        </label>
        <input id="sample-file" type="file" accept="audio/*" />
      </div>
      <button id="start">Start audio</button>
      <button id="reload" class="secondary">Reload sample</button>
      <div class="status" id="status">Idle</div>
      <div class="resource-status" id="resource-status">Sample not loaded</div>
    </div>
  </div>
`;

const startButton = mustQuery<HTMLButtonElement>("#start");
const reloadButton = mustQuery<HTMLButtonElement>("#reload");
const rateSlider = mustQuery<HTMLInputElement>("#rate");
const sampleFileInput = mustQuery<HTMLInputElement>("#sample-file");
const rateValue = mustQuery<HTMLSpanElement>("#rate-value");
const sampleFileName = mustQuery<HTMLSpanElement>("#sample-file-name");
const resourceStatus = mustQuery<HTMLDivElement>("#resource-status");
const status = mustQuery<HTMLDivElement>("#status");

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;
let sampleLoaded = false;

async function loadSampleResource() {
  if (!audioContext || !renderer) {
    return;
  }

  const response = await fetch(sampleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sample: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(bytes);
  const mono = buffer.getChannelData(0);

  await renderer.updateVirtualFileSystem({
    [samplePath]: new Float32Array(mono),
  });

  sampleLoaded = true;
  resourceStatus.textContent = `Loaded ${samplePath} (${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate} Hz)`;
}

async function loadBrowserSample(file: File) {
  if (!audioContext || !renderer) {
    return;
  }

  const bytes = await file.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(bytes);
  const mono = buffer.getChannelData(0);

  samplePath = `browser/${file.name}`;
  sampleFileName.textContent = file.name;

  await renderer.updateVirtualFileSystem({
    [samplePath]: new Float32Array(mono),
  });

  sampleLoaded = true;
  resourceStatus.textContent = `Loaded ${file.name} from the browser (${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate} Hz)`;
}

function buildGraph(rate: number): NodeRepr_t[] {
  const trigger = el.train(1);
  const playbackRate = el.const({ value: rate });

  return [
    el.mul(el.const({ value: 0.5 }), el.sample({ path: samplePath }, trigger, playbackRate)),
    el.mul(el.const({ value: 0.5 }), el.sample({ path: samplePath }, trigger, playbackRate)),
  ];
}

async function ensureAudio() {
  if (audioContext && renderer) {
    return;
  }

  audioContext = new AudioContext();
  renderer = new WebRenderer();

  const worklet = await renderer.initialize(audioContext);
  worklet.connect(audioContext.destination);

  await loadSampleResource();
}

async function renderCurrentGraph() {
  if (!renderer) {
    return;
  }

  const rate = Number(rateSlider.value);
  rateValue.textContent = `${rate.toFixed(2)}x`;
  status.textContent = sampleLoaded ? "Playing sample" : "Loading sample";

  await renderer.render(...buildGraph(rate));
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "Starting audio...";

  try {
    await ensureAudio();
    await audioContext?.resume();
    await renderCurrentGraph();
  } catch (error) {
    status.textContent = `Failed to start audio: ${error instanceof Error ? error.message : String(error)}`;
    startButton.disabled = false;
  }
});

reloadButton.addEventListener("click", async () => {
  try {
    await ensureAudio();
    samplePath = bundledSamplePath;
    sampleFileName.textContent = "Built-in sample";
    await loadSampleResource();
    await renderCurrentGraph();
  } catch (error) {
    status.textContent = `Failed to reload sample: ${error instanceof Error ? error.message : String(error)}`;
  }
});

sampleFileInput.addEventListener("change", async () => {
  const file = sampleFileInput.files?.[0];

  if (!file) {
    return;
  }

  try {
    await ensureAudio();
    await loadBrowserSample(file);
    await renderCurrentGraph();
  } catch (error) {
    status.textContent = `Failed to load browser file: ${error instanceof Error ? error.message : String(error)}`;
  }
});

rateSlider.addEventListener("input", () => {
  rateValue.textContent = `${Number(rateSlider.value).toFixed(2)}x`;

  if (renderer && audioContext?.state === "running") {
    void renderCurrentGraph();
  }
});
