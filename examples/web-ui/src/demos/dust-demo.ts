/**
 * elemaudio-rs dust signal utility demo.
 *
 * Shows sparse impulses from `el.extra.dust` and their characteristics.
 * No audio output — only a scope visualization. The graph is still rendered
 * (so the dust generator ticks), but the final output is muted.
 */

import { MAX_ZOOM } from "../components/Oscilloscope";
import "../components/Oscilloscope";
import { initDemo } from "./demo-harness";
import { buildGraph as buildDspGraph, SCOPE_NAME, type DustParams } from "../demo-dsp/dust-demo.dsp";

const layout = `
  <elemaudio-oscilloscope id="scope" zoom="16"></elemaudio-oscilloscope>
  <div class="scope-title"><p>Dust impulses (no audio)</p></div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>dust — sparse impulse generator</h3>
    <p>
      Visualize sparse impulses from <code>el.extra.dust</code>.
      Density controls impulse rate in Hz. Release (duration) and jitter
      (amplitude randomness) shape each burst. A native DC blocker keeps
      the output centered around 0 as releases overlap. This is a scope-only
      visualization; no audio is output.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start</button>
        <button id="stop" class="state-button">Stop</button>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="density">
            <span>Density</span>
            <span id="density-value">4.00 Hz</span>
          </label>
          <input id="density" type="range" min="0" max="1000" value="460" step="1" />
        </div>

        <div class="dial">
          <label for="release">
            <span>Release</span>
            <span id="release-value">1 ms</span>
          </label>
          <input id="release" type="range" min="0" max="200" value="1" step="1" />
        </div>

        <div class="dial">
          <label for="jitter">
            <span>Jitter</span>
            <span id="jitter-value">0 %</span>
          </label>
          <input id="jitter" type="range" min="0" max="100" value="0" step="1" />
        </div>

      </div>

      <div class="row">
        <button id="freeze-scope" class="freeze-button">Freeze</button>
        <button id="zoomButton" class="zoom-button">Zoom: 16×</button>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

let densitySlider: HTMLInputElement;
let densityValue: HTMLSpanElement;
let releaseSlider: HTMLInputElement;
let releaseValue: HTMLSpanElement;
let jitterSlider: HTMLInputElement;
let jitterValue: HTMLSpanElement;
let oscilloscope: any;
let freezeButton: HTMLButtonElement;
let zoomButton: HTMLButtonElement;
let stopButton: HTMLButtonElement;
let isStopped = false;

// Exponential density taper — slider 0..1000 maps to 0.25 Hz .. 500 Hz
// log-linearly, so low-density values get much more resolution.
const DENSITY_MIN_HZ = 0.25;
const DENSITY_MAX_HZ = 500;
function densityFromSlider(v: number): number {
  const t = v / 1000;
  return DENSITY_MIN_HZ * Math.pow(DENSITY_MAX_HZ / DENSITY_MIN_HZ, t);
}

function currentParams(): DustParams {
  return {
    density: densityFromSlider(Number(densitySlider.value)),
    releaseMs: Number(releaseSlider.value),
    jitter: Number(jitterSlider.value) / 100,
    isStopped,
  };
}

function buildGraph() {
  return buildDspGraph(currentParams());
}

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  buildGraph,
  updateReadouts,
  onScopeEvent: (event: any) => {
    if (event.source === SCOPE_NAME) {
      const firstBlock = event.data?.[0];
      if (firstBlock) {
        oscilloscope.data = Array.from(firstBlock as Float32Array);
      }
    }
  },
});

densitySlider = q<HTMLInputElement>("#density");
densityValue = q<HTMLSpanElement>("#density-value");
releaseSlider = q<HTMLInputElement>("#release");
releaseValue = q<HTMLSpanElement>("#release-value");
jitterSlider = q<HTMLInputElement>("#jitter");
jitterValue = q<HTMLSpanElement>("#jitter-value");
oscilloscope = q<any>("elemaudio-oscilloscope");
freezeButton = q<HTMLButtonElement>("#freeze-scope");
zoomButton = q<HTMLButtonElement>("#zoomButton");
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

wireControls([densitySlider, releaseSlider, jitterSlider]);

stopButton.addEventListener("click", async () => {
  isStopped = true;
  await renderCurrentGraph();
});

freezeButton.addEventListener("click", () => {
  const isFrozen = oscilloscope.hasAttribute("freeze");
  if (isFrozen) {
    oscilloscope.removeAttribute("freeze");
    freezeButton.textContent = "Freeze";
  } else {
    oscilloscope.setAttribute("freeze", "");
    freezeButton.textContent = "Unfreeze";
  }
});

let currentZoom = 16;
oscilloscope.setAttribute("zoom", String(currentZoom));
zoomButton.textContent = `Zoom: ${currentZoom}×`;

zoomButton.addEventListener("click", () => {
  currentZoom = currentZoom === MAX_ZOOM ? 1 : currentZoom * 2;
  oscilloscope.setAttribute("zoom", String(currentZoom));
  zoomButton.textContent = `Zoom: ${currentZoom}×`;
});

function updateReadouts() {
  const d = densityFromSlider(Number(densitySlider.value));
  const densityText = d < 1 ? `${d.toFixed(2)} Hz` : `${d.toFixed(1)} Hz`;
  densityValue.textContent = densityText;
  releaseValue.textContent = `${Number(releaseSlider.value)} ms`;
  jitterValue.textContent = `${Number(jitterSlider.value)} %`;
}

updateReadouts();
