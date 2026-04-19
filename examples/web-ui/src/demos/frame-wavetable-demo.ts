import WebRenderer from "../WebRenderer";
import "../style.css";
import {
  buildGraph as dspBuildGraph,
  FRAME_LENGTH,
  FRAME_SCOPE_EVENT,
} from "../demo-dsp/frame-wavetable-demo.dsp";
import { initDemo } from "./demo-harness";

const layout = `
  <div class="frame-stage-wrap">
    <div class="frame-stage-label">Frame Domain Programming</div>
    <div class="frame-visual-row">
      <div class="frame-visual-card">
        <div class="frame-stage frame-bars-stage">
          <div class="frame-bars-head">
            <div>
              <div class="scope-title">Frame Wavetable</div>
              <div class="frame-bars-subtitle">The live frame written into RAM and read by el.table(...).</div>
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
    <h3>Frame Wavetable Synth</h3>
    <p>
      This demo writes a live <code>frameShaper</code> into RAM with
      <code>el.extra.frameWriteRAM(...)</code>, then reads that buffer with vendor
      <code>el.table(...)</code> as a wavetable oscillator.
    </p>
    <p>
      The <code>modulate</code> control fades in a bounded <code>frameRandomWalks</code> layer that gets added
      into the wavetable before RAM write.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start</button>
        <button id="stop" class="state-button">Stop</button>
      </div>
      <div class="dial-strip">
        <div class="dial"><label for="frequency"><span>Frequency</span><span id="frequency-value">110.0 Hz</span></label><input id="frequency" type="range" min="20" max="880" value="110" step="1" /></div>
        <div class="dial"><label for="level"><span>Level</span><span id="level-value">0.15</span></label><input id="level" type="range" min="0" max="0.5" value="0.15" step="0.01" /></div>
        <div class="dial"><label for="wave"><span>Wave</span><span id="wave-value">1.00</span></label><input id="wave" type="range" min="-1" max="1" value="0" step="0.01" /></div>
      </div>
      <div class="dial-strip">
        <div class="dial"><label for="scale"><span>Scale</span><span id="scale-value">1.00</span></label><input id="scale" type="range" min="-1" max="1" value="1" step="0.01" /></div>
        <div class="dial"><label for="tilt"><span>Tilt</span><span id="tilt-value">0.00</span></label><input id="tilt" type="range" min="-1" max="1" value="0" step="0.01" /></div>
        <div class="dial"><label for="zoom"><span>Zoom</span><span id="zoom-value">x1.00</span></label><input id="zoom" type="range" min="0.10" max="8" value="1" step="0.01" /></div>
      </div>
      <div class="dial-strip">
        <div class="dial"><label for="modulate"><span>Modulate</span><span id="modulate-value">0.00</span></label><input id="modulate" type="range" min="0" max="1" value="0" step="0.01" /></div>
        <div class="dial"><label for="shift"><span>Shift</span><span id="shift-value">0</span></label><input id="shift" type="range" min="0" max="255" value="0" step="1" /></div>
      </div>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

let frequencySlider: HTMLInputElement;
let frequencyValue: HTMLSpanElement;
let levelSlider: HTMLInputElement;
let levelValue: HTMLSpanElement;
let waveSlider: HTMLInputElement;
let waveValue: HTMLSpanElement;
let scaleSlider: HTMLInputElement;
let scaleValue: HTMLSpanElement;
let tiltSlider: HTMLInputElement;
let tiltValue: HTMLSpanElement;
let zoomSlider: HTMLInputElement;
let zoomValue: HTMLSpanElement;
let modulateSlider: HTMLInputElement;
let modulateValue: HTMLSpanElement;
let shiftSlider: HTMLInputElement;
let shiftValue: HTMLSpanElement;
let frameCanvas: HTMLCanvasElement;
let frameCtx: CanvasRenderingContext2D;
let stopButton: HTMLButtonElement;
let isStopped = false;
let currentFrame: number[] = [];

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  persistKey: "no-persist",
  buildGraph: () => dspBuildGraph({
    frequency: Number(frequencySlider.value),
    level: Number(levelSlider.value),
    wave: Number(waveSlider.value),
    scale: Number(scaleSlider.value),
    tilt: Number(tiltSlider.value),
    zoom: Number(zoomSlider.value),
    modulate: Number(modulateSlider.value),
    shift: Number(shiftSlider.value),
    isStopped,
  }),
  updateReadouts,
  onAudioReady: (renderer: WebRenderer) => {
    renderer.on("scope", onScopeEvent);
  },
});

frequencySlider = q<HTMLInputElement>("#frequency");
frequencyValue = q<HTMLSpanElement>("#frequency-value");
levelSlider = q<HTMLInputElement>("#level");
levelValue = q<HTMLSpanElement>("#level-value");
waveSlider = q<HTMLInputElement>("#wave");
waveValue = q<HTMLSpanElement>("#wave-value");
scaleSlider = q<HTMLInputElement>("#scale");
scaleValue = q<HTMLSpanElement>("#scale-value");
tiltSlider = q<HTMLInputElement>("#tilt");
tiltValue = q<HTMLSpanElement>("#tilt-value");
zoomSlider = q<HTMLInputElement>("#zoom");
zoomValue = q<HTMLSpanElement>("#zoom-value");
modulateSlider = q<HTMLInputElement>("#modulate");
modulateValue = q<HTMLSpanElement>("#modulate-value");
shiftSlider = q<HTMLInputElement>("#shift");
shiftValue = q<HTMLSpanElement>("#shift-value");
frameCanvas = q<HTMLCanvasElement>("#frame-bars-canvas");
frameCtx = frameCanvas.getContext("2d") ?? (() => { throw new Error("Missing 2D canvas context"); })();
stopButton = q<HTMLButtonElement>("#stop");

q<HTMLButtonElement>("#start").addEventListener("click", () => {
  isStopped = false;
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  currentFrame = [];
  drawFrame([]);
  await renderCurrentGraph();
});

wireControls([
  frequencySlider,
  levelSlider,
  waveSlider,
  scaleSlider,
  tiltSlider,
  zoomSlider,
  modulateSlider,
  shiftSlider,
]);

updateReadouts();
drawFrame([]);

type ScopePayload = {
  source?: string;
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
  drawFrame(currentFrame);
}

function updateReadouts() {
  frequencyValue.textContent = `${Number(frequencySlider.value).toFixed(1)} Hz`;
  levelValue.textContent = Number(levelSlider.value).toFixed(2);
  waveValue.textContent = Number(waveSlider.value).toFixed(2);
  scaleValue.textContent = Number(scaleSlider.value).toFixed(2);
  tiltValue.textContent = Number(tiltSlider.value).toFixed(2);
  zoomValue.textContent = `x${Number(zoomSlider.value).toFixed(2)}`;
  modulateValue.textContent = Number(modulateSlider.value).toFixed(2);
  shiftValue.textContent = shiftSlider.value;
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
