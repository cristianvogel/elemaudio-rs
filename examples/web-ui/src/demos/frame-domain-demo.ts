import WebRenderer from "../WebRenderer";
import "../components/Oscilloscope";
import "../style.css";
import {
  buildGraph as dspBuildGraph,
  FRAME_SCOPE_EVENT,
  FRAME_LENGTH,
  PULSE_EVENT,
  X_EVENT,
  Y_EVENT,
} from "../demo-dsp/frame-domain-demo.dsp";
import { initDemo } from "./demo-harness";

const layout = `
  <div class="frame-stage-wrap">
    <div class="frame-stage-label">Frame Domain Programming</div>
    <div class="frame-visual-row">
      <div class="frame-visual-card">
        <div id="frame-stage" class="frame-stage">
          <div id="frame-grid" class="frame-grid"></div>
          <div id="frame-ring" class="frame-ring"></div>
          <div id="frame-orb" class="frame-orb"></div>
          <div id="frame-diamond" class="frame-diamond"></div>
        </div>
      </div>
      <div class="frame-visual-card frame-scope-card">
        <div class="scope-title">Frame Scope · frameLength ${FRAME_LENGTH}</div>
        <elemaudio-oscilloscope id="frame-scope" mode="replace" zoom="1" color="#7dd3fc"></elemaudio-oscilloscope>
      </div>
    </div>
  </div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>Frame Domain Programming</h3>
    <p>
      This demo uses three <code>el.extra.frameValue(...)</code> readouts on top of
      <code>el.extra.framePhasor(...)</code>. The browser worklet polls
      <code>processQueuedEvents()</code>, and each frame-synchronised value drives a CSS shape.
    </p>
    <p>
      The frame period is fixed at <strong>${FRAME_LENGTH} samples</strong>. The sample indices below are
      latched on frame boundaries, so index changes stay frame-synchronous even while the UI is moving.
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

      <div class="dial-strip">
        <div class="dial">
          <label for="x-index"><span>X index</span><span id="x-index-value">32</span></label>
          <input id="x-index" type="range" min="0" max="255" value="32" step="1" />
        </div>
        <div class="dial">
          <label for="y-index"><span>Y index</span><span id="y-index-value">96</span></label>
          <input id="y-index" type="range" min="0" max="255" value="96" step="1" />
        </div>
        <div class="dial">
          <label for="pulse-index"><span>Pulse index</span><span id="pulse-index-value">192</span></label>
          <input id="pulse-index" type="range" min="0" max="255" value="192" step="1" />
        </div>
      </div>

      <div class="frame-readout-grid">
        <div class="frame-readout-card"><span>X event</span><strong id="x-event-value">0.000</strong></div>
        <div class="frame-readout-card"><span>Y event</span><strong id="y-event-value">0.000</strong></div>
        <div class="frame-readout-card"><span>Pulse event</span><strong id="pulse-event-value">0.000</strong></div>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

type FrameState = {
  x: number;
  y: number;
  pulse: number;
};

const frameState: FrameState = { x: 0, y: 0, pulse: 0 };

let offsetSlider: HTMLInputElement;
let offsetValue: HTMLSpanElement;
let shiftSlider: HTMLInputElement;
let shiftValue: HTMLSpanElement;
let tiltSlider: HTMLInputElement;
let tiltValue: HTMLSpanElement;
let scaleSlider: HTMLInputElement;
let scaleValue: HTMLSpanElement;
let xIndexSlider: HTMLInputElement;
let xIndexValue: HTMLSpanElement;
let yIndexSlider: HTMLInputElement;
let yIndexValue: HTMLSpanElement;
let pulseIndexSlider: HTMLInputElement;
let pulseIndexValue: HTMLSpanElement;
let xEventValue: HTMLSpanElement;
let yEventValue: HTMLSpanElement;
let pulseEventValue: HTMLSpanElement;
let frameStage: HTMLDivElement;
let frameScope: HTMLElement;
let stopButton: HTMLButtonElement;
let isStopped = false;

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  buildGraph: () =>
    dspBuildGraph({
      offset: Number(offsetSlider.value) ,
      shift: Number(shiftSlider.value),
      tilt: Number(tiltSlider.value),
      scale: Number(scaleSlider.value),
      xIndex: Number(xIndexSlider.value),
      yIndex: Number(yIndexSlider.value),
      pulseIndex: Number(pulseIndexSlider.value),
      isStopped,
    }),
  updateReadouts,
  onAudioReady: (renderer: WebRenderer) => {
    renderer.on("frameValue", onFrameValueEvent);
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

xIndexSlider = q<HTMLInputElement>("#x-index");
xIndexValue = q<HTMLSpanElement>("#x-index-value");
yIndexSlider = q<HTMLInputElement>("#y-index");
yIndexValue = q<HTMLSpanElement>("#y-index-value");
pulseIndexSlider = q<HTMLInputElement>("#pulse-index");
pulseIndexValue = q<HTMLSpanElement>("#pulse-index-value");

xEventValue = q<HTMLSpanElement>("#x-event-value");
yEventValue = q<HTMLSpanElement>("#y-event-value");
pulseEventValue = q<HTMLSpanElement>("#pulse-event-value");
frameStage = q<HTMLDivElement>("#frame-stage");
frameScope = q<HTMLElement>("#frame-scope");
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

stopButton.addEventListener("click", async () => {
  isStopped = true;
  setFrameState({ x: 0, y: 0, pulse: 0 });
  await renderCurrentGraph();
});

wireControls([
  offsetSlider,
  shiftSlider,
  tiltSlider,
  scaleSlider,
  xIndexSlider,
  yIndexSlider,
  pulseIndexSlider,
]);

updateReadouts();
setFrameState(frameState);

type FrameValuePayload = {
  source?: string;
  data?: number;
};

type ScopePayload = {
  source?: string;
  data?: number[][];
};

function onFrameValueEvent(event: unknown) {
  const payload = event as FrameValuePayload;
  if (!payload?.source || typeof payload.data !== "number") {
    return;
  }

  if (payload.source === X_EVENT) {
    setFrameState({ ...frameState, x: (payload.data) });
    return;
  }

  if (payload.source === Y_EVENT) {
    setFrameState({ ...frameState, y: (payload.data) });
    return;
  }

  if (payload.source === PULSE_EVENT) {
    setFrameState({ ...frameState, pulse: (payload.data) });
  }
}

function onScopeEvent(event: unknown) {
  const payload = event as ScopePayload;
  if (payload?.source !== FRAME_SCOPE_EVENT || !Array.isArray(payload.data)) {
    return;
  }

  const channel = payload.data[0];
  if (!Array.isArray(channel) || channel.length === 0) {
    return;
  }

  try {
    (frameScope as { data?: number[] }).data = channel.slice();
  } catch {
    // Swallow transient failures while the custom element is still connecting.
  }
}

function setFrameState(next: FrameState) {
  frameState.x = next.x;
  frameState.y = next.y;
  frameState.pulse = next.pulse;

  frameStage.style.setProperty("--frame-x", next.x.toFixed(4));
  frameStage.style.setProperty("--frame-y", next.y.toFixed(4));
  frameStage.style.setProperty("--frame-pulse", next.pulse.toFixed(4));

  xEventValue.textContent = next.x.toFixed(3);
  yEventValue.textContent = next.y.toFixed(3);
  pulseEventValue.textContent = next.pulse.toFixed(3);
}

function updateReadouts() {
  offsetValue.textContent = Number(offsetSlider.value).toFixed(2);
  shiftValue.textContent = shiftSlider.value;
  tiltValue.textContent = Number(tiltSlider.value).toFixed(2);
  scaleValue.textContent = Number(scaleSlider.value).toFixed(2);
  xIndexValue.textContent = xIndexSlider.value;
  yIndexValue.textContent = yIndexSlider.value;
  pulseIndexValue.textContent = pulseIndexSlider.value;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
