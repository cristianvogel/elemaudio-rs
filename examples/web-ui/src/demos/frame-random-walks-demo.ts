import WebRenderer from "../WebRenderer";
import "../style.css";
import {
  buildGraph as dspBuildGraph,
  FRAME_LENGTH,
  RANDOM_WALKS_SCOPE_EVENT,
  RANDOM_WALKS_SHAPER_EVENT,
} from "../demo-dsp/frame-random-walks-demo.dsp";
import { initDemo } from "./demo-harness";

const layout = `
  <div class="frame-stage-wrap">
    <div class="frame-stage-label">Frame Domain Programming</div>
    <div class="frame-visual-row">
      <div class="frame-visual-card">
        <div class="frame-stage frame-bars-stage frame-overlay-stage">
          <div class="frame-bars-head">
            <div>
              <div class="scope-title">Frame Random Walks</div>
              <div class="frame-bars-subtitle">Packed walks across one frame, with a live shaper scope overlay.</div>
            </div>
            <div class="frame-bars-badge">frameLength ${FRAME_LENGTH}</div>
          </div>
          <div class="frame-overlay-wrap">
            <canvas id="frame-bars-canvas" class="frame-bars-canvas"></canvas>
            <canvas id="frame-shaper-canvas" class="frame-mini-scope-canvas"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="panel">
    <h1>elemaudiors</h1>
    <h3>Frame Random Walks</h3>
    <p>
      This demo uses <code>el.extra.frameRandomWalks(...)</code> under
      <code>el.extra.frameScope(...)</code>. One packed random walk runs for each track in the frame.
    </p>
    <p>
      The main view shows the walks. The embedded scope in the top left shows the underlying
      <code>framePhasor</code> used as the frame shaper that scales step size and multi-frame convergence.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start</button>
        <button id="stop" class="state-button">Stop</button>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="step-size"><span>Step Size</span><span id="step-size-value">0.18</span></label>
          <input id="step-size" type="range" min="0" max="1" value="0.18" step="0.01" />
        </div>
        <div class="dial">
          <label for="time-constant"><span>Time Constant</span><span id="time-constant-value">0.30 s</span></label>
          <input id="time-constant" type="range" min="0.01" max="2" value="0.30" step="0.01" />
        </div>
        <div class="dial">
          <label for="step-shape"><span>Step Shape</span><span id="step-shape-value">0.70</span></label>
          <input id="step-shape" type="range" min="-1" max="1" value="0.70" step="0.01" />
        </div>
        <div class="dial">
          <label for="time-shape"><span>Time Shape</span><span id="time-shape-value">0.55</span></label>
          <input id="time-shape" type="range" min="-1" max="1" value="0.55" step="0.01" />
        </div>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="starting-from"><span>Starting From</span><span id="starting-from-value">0.00</span></label>
          <input id="starting-from" type="range" min="-1" max="1" value="0" step="0.01" />
        </div>
        <div class="dial">
          <label for="initial-deviation"><span>Initial Deviation</span><span id="initial-deviation-value">0.30</span></label>
          <input id="initial-deviation" type="range" min="0" max="1" value="0.30" step="0.01" />
        </div>
      </div>

      <div class="dial-strip">
        <div class="toggle-row">
          <label class="toggle-label" for="absolute">
            <input id="absolute" class="toggle-input" type="checkbox" />
            <span>Absolute</span>
          </label>
        </div>
        <div class="toggle-row">
          <label class="toggle-label" for="interpolation">
            <input id="interpolation" class="toggle-input" type="checkbox" checked />
            <span>Interpolation</span>
          </label>
        </div>
      </div>

      <div class="frame-readout-grid">
        <div class="frame-readout-card"><span>Frame start</span><strong id="frame-start-value">0</strong></div>
        <div class="frame-readout-card"><span>Peak +</span><strong id="frame-peak-pos-value">0.000</strong></div>
        <div class="frame-readout-card"><span>Peak -</span><strong id="frame-peak-neg-value">0.000</strong></div>
        <div class="frame-readout-card"><span>Mean abs</span><strong id="frame-mean-abs-value">0.000</strong></div>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

let stepSizeSlider: HTMLInputElement;
let stepSizeValue: HTMLSpanElement;
let timeConstantSlider: HTMLInputElement;
let timeConstantValue: HTMLSpanElement;
let stepShapeSlider: HTMLInputElement;
let stepShapeValue: HTMLSpanElement;
let timeShapeSlider: HTMLInputElement;
let timeShapeValue: HTMLSpanElement;
let startingFromSlider: HTMLInputElement;
let startingFromValue: HTMLSpanElement;
let initialDeviationSlider: HTMLInputElement;
let initialDeviationValue: HTMLSpanElement;
let absoluteToggle: HTMLInputElement;
let interpolationToggle: HTMLInputElement;
let frameStartValue: HTMLSpanElement;
let framePeakPosValue: HTMLSpanElement;
let framePeakNegValue: HTMLSpanElement;
let frameMeanAbsValue: HTMLSpanElement;
let frameCanvas: HTMLCanvasElement;
let frameCtx: CanvasRenderingContext2D;
let shaperCanvas: HTMLCanvasElement;
let shaperCtx: CanvasRenderingContext2D;
let stopButton: HTMLButtonElement;
let isStopped = false;
let currentFrame: number[] = [];
let currentShaper: number[] = [];

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  persistKey: "no-persist",
  buildGraph: () =>
    dspBuildGraph({
      stepSize: Number(stepSizeSlider.value),
      timeConstant: Number(timeConstantSlider.value),
      stepShape: Number(stepShapeSlider.value),
      timeShape: Number(timeShapeSlider.value),
      startingFrom: Number(startingFromSlider.value),
      initialDeviation: Number(initialDeviationSlider.value),
      absolute: absoluteToggle.checked,
      interpolation: interpolationToggle.checked,
      isStopped,
    }),
  updateReadouts,
  onAudioReady: (renderer: WebRenderer) => {
    renderer.on("scope", onScopeEvent);
  },
});

stepSizeSlider = q<HTMLInputElement>("#step-size");
stepSizeValue = q<HTMLSpanElement>("#step-size-value");
timeConstantSlider = q<HTMLInputElement>("#time-constant");
timeConstantValue = q<HTMLSpanElement>("#time-constant-value");
stepShapeSlider = q<HTMLInputElement>("#step-shape");
stepShapeValue = q<HTMLSpanElement>("#step-shape-value");
timeShapeSlider = q<HTMLInputElement>("#time-shape");
timeShapeValue = q<HTMLSpanElement>("#time-shape-value");
startingFromSlider = q<HTMLInputElement>("#starting-from");
startingFromValue = q<HTMLSpanElement>("#starting-from-value");
initialDeviationSlider = q<HTMLInputElement>("#initial-deviation");
initialDeviationValue = q<HTMLSpanElement>("#initial-deviation-value");
absoluteToggle = q<HTMLInputElement>("#absolute");
interpolationToggle = q<HTMLInputElement>("#interpolation");
frameStartValue = q<HTMLSpanElement>("#frame-start-value");
framePeakPosValue = q<HTMLSpanElement>("#frame-peak-pos-value");
framePeakNegValue = q<HTMLSpanElement>("#frame-peak-neg-value");
frameMeanAbsValue = q<HTMLSpanElement>("#frame-mean-abs-value");
frameCanvas = q<HTMLCanvasElement>("#frame-bars-canvas");
frameCtx = frameCanvas.getContext("2d") ?? (() => { throw new Error("Missing 2D canvas context"); })();
shaperCanvas = q<HTMLCanvasElement>("#frame-shaper-canvas");
shaperCtx = shaperCanvas.getContext("2d") ?? (() => { throw new Error("Missing 2D canvas context"); })();
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  currentFrame = [];
  currentShaper = [];
  drawBars([]);
  drawShaper([]);
  updateFrameStats(0, []);
  await renderCurrentGraph();
});

wireControls([
  stepSizeSlider,
  timeConstantSlider,
  stepShapeSlider,
  timeShapeSlider,
  startingFromSlider,
  initialDeviationSlider,
  absoluteToggle,
  interpolationToggle,
]);

updateReadouts();
drawBars([]);
drawShaper([]);
updateFrameStats(0, []);

type ScopePayload = {
  source?: string;
  frameStart?: number;
  data?: number[][];
};

function onScopeEvent(event: unknown) {
  const payload = event as ScopePayload;
  if (!Array.isArray(payload?.data)) {
    return;
  }

  const channel = payload.data[0];
  if (!Array.isArray(channel) || channel.length === 0) {
    return;
  }

  if (payload.source === RANDOM_WALKS_SCOPE_EVENT) {
    currentFrame = channel.slice();
    updateFrameStats(payload.frameStart ?? 0, currentFrame);
    drawBars(currentFrame);
    return;
  }

  if (payload.source === RANDOM_WALKS_SHAPER_EVENT) {
    currentShaper = channel.slice();
    drawShaper(currentShaper);
  }
}

function updateReadouts() {
  stepSizeValue.textContent = Number(stepSizeSlider.value).toFixed(2);
  timeConstantValue.textContent = `${Number(timeConstantSlider.value).toFixed(2)} s`;
  stepShapeValue.textContent = Number(stepShapeSlider.value).toFixed(2);
  timeShapeValue.textContent = Number(timeShapeSlider.value).toFixed(2);
  startingFromValue.textContent = Number(startingFromSlider.value).toFixed(2);
  initialDeviationValue.textContent = Number(initialDeviationSlider.value).toFixed(2);
}

function updateFrameStats(frameStart: number, frame: number[]) {
  frameStartValue.textContent = Math.round(frameStart).toString();

  if (frame.length === 0) {
    framePeakPosValue.textContent = "0.000";
    framePeakNegValue.textContent = "0.000";
    frameMeanAbsValue.textContent = "0.000";
    return;
  }

  let peakPos = Number.NEGATIVE_INFINITY;
  let peakNeg = Number.POSITIVE_INFINITY;
  let meanAbs = 0;
  for (const sample of frame) {
    peakPos = Math.max(peakPos, sample);
    peakNeg = Math.min(peakNeg, sample);
    meanAbs += Math.abs(sample);
  }

  framePeakPosValue.textContent = peakPos.toFixed(3);
  framePeakNegValue.textContent = peakNeg.toFixed(3);
  frameMeanAbsValue.textContent = (meanAbs / frame.length).toFixed(3);
}

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

function drawBars(frame: number[]) {
  const { width, height, dpr } = setupCanvas(frameCanvas);
  frameCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  frameCtx.clearRect(0, 0, width, height);

  const gradient = frameCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(176, 10, 234, 0.52)");
  gradient.addColorStop(1, "rgba(250, 155, 72, 0.8)");

  const accentGradient = frameCtx.createLinearGradient(0, height, width, 0);
  accentGradient.addColorStop(0, "rgba(176, 10, 234, 0.3)");
  accentGradient.addColorStop(1, "rgba(250, 155, 72, 0.42)");

  const baseline = height * 0.5;
  frameCtx.fillStyle = "rgba(6, 10, 18, 0.96)";
  frameCtx.fillRect(0, 0, width, height);

  frameCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  frameCtx.lineWidth = 1;
  frameCtx.beginPath();
  frameCtx.moveTo(0, baseline + 0.5);
  frameCtx.lineTo(width, baseline + 0.5);
  frameCtx.stroke();

  frameCtx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  frameCtx.beginPath();
  frameCtx.moveTo(0, height * 0.25 + 0.5);
  frameCtx.lineTo(width, height * 0.25 + 0.5);
  frameCtx.moveTo(0, height * 0.75 + 0.5);
  frameCtx.lineTo(width, height * 0.75 + 0.5);
  frameCtx.stroke();

  if (frame.length === 0) {
    return;
  }

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

  frameCtx.fillStyle = accentGradient;
  frameCtx.fillRect(0, baseline - 1, width, 2);
}

function drawShaper(frame: number[]) {
  const { width, height, dpr } = setupCanvas(shaperCanvas);
  shaperCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  shaperCtx.clearRect(0, 0, width, height);
  shaperCtx.fillStyle = "rgba(4, 7, 14, 0.5)";
  shaperCtx.fillRect(0, 0, width, height);

  const baseline = height * 0.5;
  shaperCtx.strokeStyle = "rgba(255,255,255,0.14)";
  shaperCtx.beginPath();
  shaperCtx.moveTo(0, baseline + 0.5);
  shaperCtx.lineTo(width, baseline + 0.5);
  shaperCtx.stroke();

  if (frame.length === 0) {
    return;
  }

  shaperCtx.strokeStyle = "rgba(250, 155, 72, 0.92)";
  shaperCtx.lineWidth = 1.5;
  shaperCtx.beginPath();
  for (let i = 0; i < frame.length; i += 1) {
    const x = (i / Math.max(1, frame.length - 1)) * width;
    const y = baseline - Math.max(-1, Math.min(1, frame[i])) * (height * 0.42);
    if (i === 0) {
      shaperCtx.moveTo(x, y);
    } else {
      shaperCtx.lineTo(x, y);
    }
  }
  shaperCtx.stroke();
}

window.addEventListener("resize", () => {
  drawBars(currentFrame);
  drawShaper(currentShaper);
});

if (typeof ResizeObserver !== "undefined") {
  const observer = new ResizeObserver(() => {
    drawBars(currentFrame);
    drawShaper(currentShaper);
  });
  observer.observe(frameCanvas);
  observer.observe(shaperCanvas);
}
