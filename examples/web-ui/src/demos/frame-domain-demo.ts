import WebRenderer from "../WebRenderer";
import "../style.css";
import {
  buildGraph as dspBuildGraph,
  FRAME_SCOPE_EVENT,
  FRAME_LENGTH,
} from "../demo-dsp/frame-domain-demo.dsp";
import { initDemo } from "./demo-harness";

const layout = `
  <div class="frame-stage-wrap">
    <div class="frame-stage-label">Frame Domain Programming</div>
    <div class="frame-visual-row">
      <div class="frame-visual-card">
        <div class="frame-stage frame-bars-stage">
          <div class="frame-bars-head">
            <div>
              <div class="scope-title">Area Under The Signal</div>
              <div class="frame-bars-subtitle">A framePhasor drawn as one bar per sample track.</div>
            </div>
            <div class="frame-bars-badge">frameLength ${FRAME_LENGTH}</div>
          </div>
          <canvas id="frame-bars-canvas" class="frame-bars-canvas"></canvas>
        </div>
      </div>
    </div>
  </div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>Frame Shaper</h3>
    <p>
      This demo uses <code>el.extra.framePhasor(...)</code> under
      <code>el.extra.frameScope(...)</code>. Each completed frame is drawn directly to canvas as
      a fixed bar field with one vertical bar per sample.
    </p>
    <p>
      The frame period is fixed at <strong>${FRAME_LENGTH} samples</strong>. The chart baseline is centered,
      so positive values rise upward and negative values fall below zero with no tweening between frames.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start</button>
        <button id="stop" class="state-button">Stop</button>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="offset"><span>Offset</span><span id="offset-value">0.00</span></label>
          <input id="offset" type="range" min="-1" max="1" value="0" step="0.01" />
        </div>
        <div class="dial">
          <label for="shift"><span>Shift</span><span id="shift-value">0</span></label>
          <input id="shift" type="range" min="0" max="255" value="0" step="1" />
        </div>
        <div class="dial">
          <label for="tilt"><span>Tilt</span><span id="tilt-value">0.00</span></label>
          <input id="tilt" type="range" min="-1" max="1" value="0" step="0.01" />
        </div>
        <div class="dial">
          <label for="scale"><span>Scale</span><span id="scale-value">1.00</span></label>
          <input id="scale" type="range" min="-1" max="1" value="1" step="0.01" />
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

let offsetSlider: HTMLInputElement;
let offsetValue: HTMLSpanElement;
let shiftSlider: HTMLInputElement;
let shiftValue: HTMLSpanElement;
let tiltSlider: HTMLInputElement;
let tiltValue: HTMLSpanElement;
let scaleSlider: HTMLInputElement;
let scaleValue: HTMLSpanElement;
let frameStartValue: HTMLSpanElement;
let framePeakPosValue: HTMLSpanElement;
let framePeakNegValue: HTMLSpanElement;
let frameMeanAbsValue: HTMLSpanElement;
let frameCanvas: HTMLCanvasElement;
let frameCtx: CanvasRenderingContext2D;
let stopButton: HTMLButtonElement;
let isStopped = false;
let currentFrame: number[] = [];

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  persistKey: "no-persist",
  buildGraph: () =>
    dspBuildGraph({
      offset: Number(offsetSlider.value),
      shift: Number(shiftSlider.value),
      tilt: Number(tiltSlider.value),
      scale: Number(scaleSlider.value),
      isStopped,
    }),
  updateReadouts,
  onAudioReady: (renderer: WebRenderer) => {
    renderer.on("scope", onScopeEvent);
  },
});

offsetSlider = q<HTMLInputElement>("#offset");
offsetValue = q<HTMLSpanElement>("#offset-value");
shiftSlider = q<HTMLInputElement>("#shift");
shiftValue = q<HTMLSpanElement>("#shift-value");
tiltSlider = q<HTMLInputElement>("#tilt");
tiltValue = q<HTMLSpanElement>("#tilt-value");
scaleSlider = q<HTMLInputElement>("#scale");
scaleValue = q<HTMLSpanElement>("#scale-value");
frameStartValue = q<HTMLSpanElement>("#frame-start-value");
framePeakPosValue = q<HTMLSpanElement>("#frame-peak-pos-value");
framePeakNegValue = q<HTMLSpanElement>("#frame-peak-neg-value");
frameMeanAbsValue = q<HTMLSpanElement>("#frame-mean-abs-value");
frameCanvas = q<HTMLCanvasElement>("#frame-bars-canvas");
frameCtx = frameCanvas.getContext("2d") ?? (() => { throw new Error("Missing 2D canvas context"); })();
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  currentFrame = [];
  drawFrame([]);
  updateFrameStats(0, []);
  await renderCurrentGraph();
});

wireControls([offsetSlider, shiftSlider, tiltSlider, scaleSlider]);

updateReadouts();
drawFrame([]);
updateFrameStats(0, []);

type ScopePayload = {
  source?: string;
  frameStart?: number;
  data?: number[][];
};

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
  updateFrameStats(payload.frameStart ?? 0, currentFrame);
  drawFrame(currentFrame);
}

function updateReadouts() {
  offsetValue.textContent = Number(offsetSlider.value).toFixed(2);
  shiftValue.textContent = shiftSlider.value;
  tiltValue.textContent = Number(tiltSlider.value).toFixed(2);
  scaleValue.textContent = Number(scaleSlider.value).toFixed(2);
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

function drawFrame(frame: number[]) {
  const bounds = frameCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(bounds.width));
  const height = Math.max(1, Math.floor(bounds.height));
  const dpr = window.devicePixelRatio ?? 1;

  if (frameCanvas.width !== Math.floor(width * dpr) || frameCanvas.height !== Math.floor(height * dpr)) {
    frameCanvas.width = Math.floor(width * dpr);
    frameCanvas.height = Math.floor(height * dpr);
    frameCanvas.style.width = `${width}px`;
    frameCanvas.style.height = `${height}px`;
  }

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

window.addEventListener("resize", () => {
  drawFrame(currentFrame);
});

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => drawFrame(currentFrame)).observe(frameCanvas);
}
