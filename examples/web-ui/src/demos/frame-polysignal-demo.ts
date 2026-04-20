import WebRenderer from "../WebRenderer";
import "../style.css";
import multiLfoUrl from "../../../demo-resources/multi-256-32f.wav?url";
import {
  buildGraph as dspBuildGraph,
  FRAME_LENGTH,
  FRAME_SCOPE_EVENT,
} from "../demo-dsp/frame-polysignal-demo.dsp";
import { initDemo } from "./demo-harness";

const layout = `
  <div class="frame-stage-wrap">
    <div class="frame-stage-label">Frame Domain Programming</div>
    <div class="frame-visual-row">
      <div class="frame-visual-card">
        <div class="frame-stage frame-bars-stage frame-overlay-stage">
          <div class="frame-bars-head">
            <div>
              <div class="scope-title">Frame MultiLFO</div>
              <div class="frame-bars-subtitle">WireFrames PolySignal output with source table overlay.</div>
            </div>
            <div class="frame-bars-badge">frameLength ${FRAME_LENGTH}</div>
          </div>
          <div class="frame-overlay-wrap">
            <canvas id="frame-bars-canvas" class="frame-bars-canvas"></canvas>
            <canvas id="frame-source-canvas" class="frame-mini-scope-canvas"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>Frame MultiLFO</h3>
    <p>
      This demo uses <code>framePolySignal</code>, a WireFrames-style PolySignal
      primitive that de-correlates a shared source waveform across the frame.
    </p>
    <p>
      The browser demo loads <code>demo-resources/multi-256-32f.wav</code> into the virtual file system at
      <code>fps:multi_lfo</code>. The embedded scope shows the current source table.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start</button>
        <button id="stop" class="state-button">Stop</button>
        <button id="reset-phase" class="secondary">Resync Phases</button>
      </div>
      <div class="dial-strip">
        <div class="dial"><label for="rate"><span>Rate</span><span id="rate-value">12.0 BPM</span></label><input id="rate" type="range" min="0" max="120" value="12" step="0.1" /></div>
        <div class="dial"><label for="phase-spread"><span>Phase Spread</span><span id="phase-spread-value">0.00</span></label><input id="phase-spread" type="range" min="-1" max="1" value="0" step="0.01" /></div>
        <div class="dial"><label for="rate-spread"><span>Rate Spread</span><span id="rate-spread-value">0.00</span></label><input id="rate-spread" type="range" min="-1" max="1" value="0" step="0.01" /></div>
      </div>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

let rateSlider: HTMLInputElement;
let rateValue: HTMLSpanElement;
let phaseSpreadSlider: HTMLInputElement;
let phaseSpreadValue: HTMLSpanElement;
let rateSpreadSlider: HTMLInputElement;
let rateSpreadValue: HTMLSpanElement;
let frameCanvas: HTMLCanvasElement;
let frameCtx: CanvasRenderingContext2D;
let sourceCanvas: HTMLCanvasElement;
let sourceCtx: CanvasRenderingContext2D;
let stopButton: HTMLButtonElement;
let resetButton: HTMLButtonElement;
let isStopped = false;
let resetArmed = false;
let currentFrame: number[] = [];
let currentSourceTable: Float32Array = new Float32Array();

function setupCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(bounds.width));
  const height = Math.max(1, Math.floor(bounds.height));
  const dpr = window.devicePixelRatio ?? 1;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  return { width, height, dpr };
}

function drawWaveLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: ArrayLike<number>, stroke: string) {
  const { width, height, dpr } = setupCanvas(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(6, 10, 18, 0.96)";
  ctx.fillRect(0, 0, width, height);
  const baseline = height * 0.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(0, baseline + 0.5);
  ctx.lineTo(width, baseline + 0.5);
  ctx.stroke();
  if (data.length === 0) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i += 1) {
    const x = (i / Math.max(1, data.length - 1)) * width;
    const y = baseline - Math.max(-1, Math.min(1, data[i])) * (height * 0.42);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawFrame(frame: number[]) {
  const { width, height, dpr } = setupCanvas(frameCanvas);
  frameCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  frameCtx.clearRect(0, 0, width, height);

  const gradient = frameCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(176, 10, 234, 0.52)");
  gradient.addColorStop(1, "rgba(250, 155, 72, 0.8)");

  const baseline = height * 0.5;
  frameCtx.fillStyle = "rgba(6, 10, 18, 0.96)";
  frameCtx.fillRect(0, 0, width, height);
  frameCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  frameCtx.beginPath();
  frameCtx.moveTo(0, baseline + 0.5);
  frameCtx.lineTo(width, baseline + 0.5);
  frameCtx.stroke();

  if (frame.length === 0) return;

  const barWidth = width / frame.length;
  const gap = Math.min(1.5, barWidth * 0.12);
  const drawWidth = Math.max(1, barWidth - gap);
  const amplitude = baseline - 14;
  frameCtx.fillStyle = gradient;
  for (let i = 0; i < frame.length; i += 1) {
    const value = Math.max(-1, Math.min(1, frame[i]));
    const x = i * barWidth + gap * 0.5;
    const barHeight = Math.abs(value) * amplitude;
    const y = value >= 0 ? baseline - barHeight : baseline;
    frameCtx.fillRect(x, y, drawWidth, barHeight);
  }
}

function drawSourceTable(data: ArrayLike<number>) {
  drawWaveLine(sourceCtx, sourceCanvas, data, "rgba(250, 155, 72, 0.92)");
}

async function loadBundledMultiLfo(renderer: WebRenderer) {
  const audioContext = renderer.context;
  if (!audioContext) {
    throw new Error("Missing audio context while loading frame polysignal resource");
  }

  const response = await fetch(multiLfoUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch multi_lfo resource: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(bytes);
  currentSourceTable = new Float32Array(buffer.getChannelData(0));
  await renderer.updateVirtualFileSystem({
    "fps:multi_lfo": currentSourceTable,
  });
}

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  persistKey: "no-persist",
  buildGraph: () => dspBuildGraph({
    rate: Number(rateSlider.value),
    phaseSpread: Number(phaseSpreadSlider.value),
    rateSpread: Number(rateSpreadSlider.value),
    resetArmed,
    isStopped,
  }),
  updateReadouts,
  onAudioReady: async (renderer: WebRenderer) => {
    renderer.on("scope", onScopeEvent);
    await loadBundledMultiLfo(renderer);
    drawSourceTable(currentSourceTable);
  },
});

rateSlider = q<HTMLInputElement>("#rate");
rateValue = q<HTMLSpanElement>("#rate-value");
phaseSpreadSlider = q<HTMLInputElement>("#phase-spread");
phaseSpreadValue = q<HTMLSpanElement>("#phase-spread-value");
rateSpreadSlider = q<HTMLInputElement>("#rate-spread");
rateSpreadValue = q<HTMLSpanElement>("#rate-spread-value");
frameCanvas = q<HTMLCanvasElement>("#frame-bars-canvas");
frameCtx = frameCanvas.getContext("2d") ?? (() => { throw new Error("Missing 2D canvas context"); })();
sourceCanvas = q<HTMLCanvasElement>("#frame-source-canvas");
sourceCtx = sourceCanvas.getContext("2d") ?? (() => { throw new Error("Missing 2D canvas context"); })();
stopButton = q<HTMLButtonElement>("#stop");
resetButton = q<HTMLButtonElement>("#reset-phase");

q<HTMLButtonElement>("#start").addEventListener("click", () => {
  isStopped = false;
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  currentFrame = [];
  drawFrame([]);
  await renderCurrentGraph();
});

resetButton.addEventListener("click", async () => {
  resetArmed = true;
  await renderCurrentGraph();
  resetArmed = false;
  if (!isStopped) {
    await renderCurrentGraph();
  }
});

wireControls([rateSlider, phaseSpreadSlider, rateSpreadSlider]);

updateReadouts();
drawFrame([]);
drawSourceTable(currentSourceTable);

type ScopePayload = { source?: string; data?: number[][] };

function onScopeEvent(event: unknown) {
  const payload = event as ScopePayload;
  if (payload?.source !== FRAME_SCOPE_EVENT || !Array.isArray(payload.data)) {
    return;
  }

  const channel = payload.data[0];
  if (!Array.isArray(channel) || channel.length === 0) {
    return;
  }

  currentFrame = channel.slice();
  drawFrame(currentFrame);
}

function updateReadouts() {
  rateValue.textContent = `${Number(rateSlider.value).toFixed(1)} BPM`;
  phaseSpreadValue.textContent = Number(phaseSpreadSlider.value).toFixed(2);
  rateSpreadValue.textContent = Number(rateSpreadSlider.value).toFixed(2);
}

window.addEventListener("resize", () => {
  drawFrame(currentFrame);
  drawSourceTable(currentSourceTable);
});

if (typeof ResizeObserver !== "undefined") {
  const observer = new ResizeObserver(() => {
    drawFrame(currentFrame);
    drawSourceTable(currentSourceTable);
  });
  observer.observe(frameCanvas);
  observer.observe(sourceCanvas);
}
