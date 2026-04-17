import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import sampleUrl from "../../../demo-resources/115bpm_808_Beat_mono.wav?url";
import irUrl from "../../../demo-resources/DEEPNESS.wav?url";
import { buildGraph as dspBuildGraph, type SampleParams } from "../demo-dsp/sample-demo.dsp";
import WebRenderer from "../WebRenderer";
import "../style.css";

const bundledSamplePath = "demo-resources/115bpm_808_Beat_mono.wav";
const bundledIrBasePath = "demo-resources/DEEPNESS";
let samplePath = bundledSamplePath;
let sampleChannels = 1;
let irChannelPaths: string[] = [];
let activeIrPairStart = 0;

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
    <h1>elemaudio-rs</h1> <h3>sample, frequency shifter and convolver</h3>
    <p>Loads a sample and a four-channel IR from <code>demo-resources/</code> 
    then processes the audio through 
    <code>el.extra.freqShift(...)</code> into <code>el.convolve(...)</code>. 
    The four-channel IR has been pre-prepared, so that channel 3 and 4 are reversed versions of the IR. 
    This makes it trivial to swap the IR flavour, as demonstrated by the UI button.</p>

    <div class="controls">
      <div class="row">
        <label for="rate">
          <span>Playback rate</span>
          <span id="rate-value">1.00x</span>
        </label>
        <input id="rate" type="range" min="0.5" max="1.5" value="1" step="0.01" />
      </div>
      <div class="row">
        <label for="blend">
          <span>Dry / wet blend</span>
          <span id="blend-value">50%</span>
        </label>
        <input id="blend" type="range" min="0" max="100" value="50" step="1" />
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
      <button id="toggle-ir" class="secondary">Use IR pair 1/2</button>
      <div class="status" id="status">Idle</div>
      <div class="resource-status" id="resource-status">Sample not loaded</div>
    </div>
  </div>
`;

const startButton = mustQuery<HTMLButtonElement>("#start");
const reloadButton = mustQuery<HTMLButtonElement>("#reload");
const rateSlider = mustQuery<HTMLInputElement>("#rate");
const blendSlider = mustQuery<HTMLInputElement>("#blend");
const sampleFileInput = mustQuery<HTMLInputElement>("#sample-file");
const rateValue = mustQuery<HTMLSpanElement>("#rate-value");
const blendValue = mustQuery<HTMLSpanElement>("#blend-value");
const sampleFileName = mustQuery<HTMLSpanElement>("#sample-file-name");
const toggleIrButton = mustQuery<HTMLButtonElement>("#toggle-ir");
const resourceStatus = mustQuery<HTMLDivElement>("#resource-status");
const status = mustQuery<HTMLDivElement>("#status");

updateIrToggleLabel();

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;
let sampleLoaded = false;

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function updateIrToggleLabel() {
  if (irChannelPaths.length < 2) {
    toggleIrButton.disabled = true;
    toggleIrButton.textContent = "IR pair unavailable";
    return;
  }

  toggleIrButton.disabled = irChannelPaths.length < 4;
  toggleIrButton.textContent = activeIrPairStart === 0 ? "Use IR pair 1/2" : "Use IR pair 3/4";
}

async function updateBlend() {
  const blend = Number(blendSlider.value) / 100;
  blendValue.textContent = `${Math.round(blend * 100)}%`;

  if (renderer && audioContext?.state === "running") {
    await renderCurrentGraph();
  }
}

async function loadBundledResources() {
  if (!audioContext || !renderer) {
    return;
  }

  const [sampleResponse, irResponse] = await Promise.all([fetch(sampleUrl), fetch(irUrl)]);

  if (!sampleResponse.ok) {
    throw new Error(`Failed to fetch sample: ${sampleResponse.status} ${sampleResponse.statusText}`);
  }

  if (!irResponse.ok) {
    throw new Error(`Failed to fetch IR: ${irResponse.status} ${irResponse.statusText}`);
  }

  const [sampleBytes, irBytes] = await Promise.all([sampleResponse.arrayBuffer(), irResponse.arrayBuffer()]);
  const [sampleBuffer, irBuffer] = await Promise.all([
    audioContext.decodeAudioData(sampleBytes),
    audioContext.decodeAudioData(irBytes),
  ]);

  sampleChannels = sampleBuffer.numberOfChannels;
  const sampleData = sampleBuffer.numberOfChannels > 1
    ? Array.from({ length: sampleBuffer.numberOfChannels }, (_, index) =>
        new Float32Array(sampleBuffer.getChannelData(index)),
      )
    : new Float32Array(sampleBuffer.getChannelData(0));

  const irData = Array.from({ length: irBuffer.numberOfChannels }, (_, index) =>
    new Float32Array(irBuffer.getChannelData(index)),
  );

  irChannelPaths = irData.map((_, index) => `${bundledIrBasePath}_ch${index + 1}.wav`);

  const vfs: Record<string, Float32Array | Float32Array[]> = {
    [samplePath]: sampleData,
  };

  irChannelPaths.forEach((path, index) => {
    vfs[path] = irData[index];
  });

  await renderer.updateVirtualFileSystem(vfs);

  sampleLoaded = true;
  activeIrPairStart = 0;
  updateIrToggleLabel();
  resourceStatus.textContent = `Loaded ${samplePath} and ${irChannelPaths.length} IR channels (${sampleBuffer.numberOfChannels} ch + ${irBuffer.numberOfChannels} ch @ ${sampleBuffer.sampleRate} Hz)`;
}

async function loadBrowserSample(file: File) {
  if (!audioContext || !renderer) {
    return;
  }

  const bytes = await file.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(bytes);

  samplePath = `browser/${file.name}`;
  sampleFileName.textContent = file.name;
  sampleChannels = buffer.numberOfChannels;

  const sampleData = buffer.numberOfChannels > 1
    ? Array.from({ length: buffer.numberOfChannels }, (_, index) =>
        new Float32Array(buffer.getChannelData(index)),
      )
    : new Float32Array(buffer.getChannelData(0));

  await renderer.updateVirtualFileSystem({
    [samplePath]: sampleData,
  });

  sampleLoaded = true;
  resourceStatus.textContent = `Loaded ${file.name} from the browser (${buffer.numberOfChannels} ch @ ${buffer.sampleRate} Hz)`;
}

function buildGraph(rate: number): NodeRepr_t[] {
  const leftIrPath = irChannelPaths[activeIrPairStart] ?? `${bundledIrBasePath}_ch1.wav`;
  const rightIrPath = irChannelPaths[activeIrPairStart + 1] ?? leftIrPath;

  return dspBuildGraph({
    samplePath,
    sampleChannels,
    rate,
    blend: Number(blendSlider.value) / 100,
    leftIrPath,
    rightIrPath,
  });
}

async function ensureAudio() {
  if (audioContext && renderer) {
    return;
  }

  audioContext = new AudioContext();
  renderer = new WebRenderer();

  const worklet = await renderer.initialize(audioContext);
  worklet.connect(audioContext.destination);

  await loadBundledResources();
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
    status.textContent = `Failed to start audio: ${formatError(error)}`;
    startButton.disabled = false;
  }
});

reloadButton.addEventListener("click", async () => {
  try {
    await ensureAudio();
    samplePath = bundledSamplePath;
    sampleChannels = 1;
    irChannelPaths = [];
    activeIrPairStart = 0;
    sampleFileName.textContent = "Built-in sample";
    await loadBundledResources();
    await renderCurrentGraph();
  } catch (error) {
    status.textContent = `Failed to reload sample: ${formatError(error)}`;
  }
});

toggleIrButton.addEventListener("click", async () => {
  if (irChannelPaths.length < 4) {
    return;
  }

  activeIrPairStart = activeIrPairStart === 0 ? 2 : 0;
  updateIrToggleLabel();

  if (renderer && audioContext?.state === "running") {
    await renderCurrentGraph();
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
    status.textContent = `Failed to load browser file: ${formatError(error)}`;
  }
});

rateSlider.addEventListener("input", () => {
  rateValue.textContent = `${Number(rateSlider.value).toFixed(2)}x`;

  if (renderer && audioContext?.state === "running") {
    void renderCurrentGraph();
  }
});

blendSlider.addEventListener("input", () => {
  void updateBlend();
});
