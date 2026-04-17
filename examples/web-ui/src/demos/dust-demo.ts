/**
 * elemaudio-rs dust resonator bank demo.
 *
 * UI shell only — the DSP graph lives in `../demo-dsp/dust-demo.dsp.ts`.
 */

import { MAX_ZOOM } from "../components/Oscilloscope";
import "../components/Oscilloscope";
import { initDemo } from "./demo-harness";
import { buildGraph as buildDspGraph, SCOPE_NAME, type DustBankParams } from "../demo-dsp/dust-demo.dsp";

const layout = `
  <elemaudio-oscilloscope id="scope" zoom="2"></elemaudio-oscilloscope>
  <div class="scope-title"><p>Resonator bank output</p></div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>dust resonator bank</h3>
    <p>
      Sparse bipolar impulses from <code>el.extra.dust</code> excite a bank
      of self-resonating bandpass filters. Each resonator wraps a bandpass
      in a tapIn/tapOut feedback loop; the feedback gain is coupled as
      <code>fb_eff = fb · 0.95 / Q</code> so the self-oscillation threshold
      lands at <strong>100%</strong> regardless of Q — push past ~85% for
      long sustains.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>
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
          <label for="fundamental">
            <span>Fundamental</span>
            <span id="fundamental-value">110 Hz</span>
          </label>
          <input id="fundamental" type="range" min="40" max="880" value="110" step="1" />
        </div>

        <div class="dial">
          <label for="q">
            <span>Resonance (Q)</span>
            <span id="q-value">80</span>
          </label>
          <input id="q" type="range" min="5" max="200" value="80" step="1" />
        </div>

        <div class="dial">
          <label for="fb">
            <span>Self-resonance</span>
            <span id="fb-value">85 %</span>
          </label>
          <input id="fb" type="range" min="0" max="100" value="85" step="1" />
        </div>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="trails">
            <span>Exciter trail</span>
            <span id="trails-value">1 ms</span>
          </label>
          <input id="trails" type="range" min="0" max="200" value="1" step="1" />
        </div>

        <div class="dial">
          <label for="jitter">
            <span>Amp jitter</span>
            <span id="jitter-value">0 %</span>
          </label>
          <input id="jitter" type="range" min="0" max="100" value="0" step="1" />
        </div>

        <div class="dial">
          <label for="partials">
            <span>Partials</span>
            <span id="partials-value">7</span>
          </label>
          <input id="partials" type="range" min="1" max="12" value="7" step="1" />
        </div>

        <div class="dial">
          <label for="spread">
            <span>Detune</span>
            <span id="spread-value">1.5 %</span>
          </label>
          <input id="spread" type="range" min="0" max="50" value="15" step="1" />
        </div>

        <div class="dial">
          <label for="gain">
            <span>Output gain</span>
            <span id="gain-value">50 %</span>
          </label>
          <input id="gain" type="range" min="0" max="100" value="50" step="1" />
        </div>
      </div>

      <div class="row">
        <div class="buttons">
          <button id="freeze-scope" class="freeze-button">Freeze</button>
          <button id="zoomButton" class="zoom-button">Zoom: 2×</button>
        </div>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

let densitySlider: HTMLInputElement;
let densityValue: HTMLSpanElement;
let fundamentalSlider: HTMLInputElement;
let fundamentalValue: HTMLSpanElement;
let qSlider: HTMLInputElement;
let qValue: HTMLSpanElement;
let fbSlider: HTMLInputElement;
let fbValue: HTMLSpanElement;
let trailsSlider: HTMLInputElement;
let trailsValue: HTMLSpanElement;
let jitterSlider: HTMLInputElement;
let jitterValue: HTMLSpanElement;
let partialsSlider: HTMLInputElement;
let partialsValue: HTMLSpanElement;
let spreadSlider: HTMLInputElement;
let spreadValue: HTMLSpanElement;
let gainSlider: HTMLInputElement;
let gainValue: HTMLSpanElement;
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

function currentParams(): DustBankParams {
  return {
    density: densityFromSlider(Number(densitySlider.value)),
    trailsMs: Number(trailsSlider.value),
    jitter: Number(jitterSlider.value) / 100,
    fundamental: Number(fundamentalSlider.value),
    q: Number(qSlider.value),
    fb: Number(fbSlider.value) / 100, // 0–100 → 0.0–1.0 (coupled to 1/Q inside DSP)
    partials: Number(partialsSlider.value),
    spreadPct: Number(spreadSlider.value) / 10, // 0–50 → 0–5 %
    gain: Number(gainSlider.value) / 100,
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
  renderOptions: { rootFadeInMs: 0, rootFadeOutMs: 20 },
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
fundamentalSlider = q<HTMLInputElement>("#fundamental");
fundamentalValue = q<HTMLSpanElement>("#fundamental-value");
qSlider = q<HTMLInputElement>("#q");
qValue = q<HTMLSpanElement>("#q-value");
fbSlider = q<HTMLInputElement>("#fb");
fbValue = q<HTMLSpanElement>("#fb-value");
trailsSlider = q<HTMLInputElement>("#trails");
trailsValue = q<HTMLSpanElement>("#trails-value");
jitterSlider = q<HTMLInputElement>("#jitter");
jitterValue = q<HTMLSpanElement>("#jitter-value");
partialsSlider = q<HTMLInputElement>("#partials");
partialsValue = q<HTMLSpanElement>("#partials-value");
spreadSlider = q<HTMLInputElement>("#spread");
spreadValue = q<HTMLSpanElement>("#spread-value");
gainSlider = q<HTMLInputElement>("#gain");
gainValue = q<HTMLSpanElement>("#gain-value");
oscilloscope = q<any>("elemaudio-oscilloscope");
freezeButton = q<HTMLButtonElement>("#freeze-scope");
zoomButton = q<HTMLButtonElement>("#zoomButton");
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

wireControls([
  densitySlider,
  fundamentalSlider,
  qSlider,
  fbSlider,
  trailsSlider,
  jitterSlider,
  partialsSlider,
  spreadSlider,
  gainSlider,
]);

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

let currentZoom = 2;
oscilloscope.setAttribute("zoom", String(currentZoom));
zoomButton.textContent = `Zoom: ${currentZoom}×`;

zoomButton.addEventListener("click", () => {
  currentZoom = currentZoom === MAX_ZOOM ? 1 : currentZoom * 2;
  oscilloscope.setAttribute("zoom", String(currentZoom));
  zoomButton.textContent = `Zoom: ${currentZoom}×`;
});

function updateReadouts() {
  const d = densityFromSlider(Number(densitySlider.value));
  // Finer formatting at low density for visibility below 1 Hz.
  const densityText = d < 1 ? `${d.toFixed(2)} Hz` : `${d.toFixed(1)} Hz`;
  densityValue.textContent = densityText;
  fundamentalValue.textContent = `${Number(fundamentalSlider.value)} Hz`;
  qValue.textContent = `${Number(qSlider.value)}`;
  fbValue.textContent = `${Number(fbSlider.value)} %`;
  trailsValue.textContent = `${Number(trailsSlider.value)} ms`;
  jitterValue.textContent = `${Number(jitterSlider.value)} %`;
  partialsValue.textContent = `${Number(partialsSlider.value)}`;
  spreadValue.textContent = `${(Number(spreadSlider.value) / 10).toFixed(1)} %`;
  gainValue.textContent = `${Number(gainSlider.value)} %`;
}

updateReadouts();
