/**
 * elemaudiors ramp00 one-shot demo
 *
 * Shows the sample-accurate behavior of `el.extra.ramp00` and the effect
 * of its `blocking` prop. A stochastic trigger source (latched random gate)
 * fires rapidly; with `blocking: true` many retrigger attempts are
 * deliberately ignored while a ramp is in flight. Toggle it off to see the
 * free-retrigger chaos.
 *
 * No audio: the graph is silenced stereo; only the scope tap is visible.
 */

import { MAX_ZOOM } from "../components/Oscilloscope";
import {
  buildGraph as dspBuildGraph,
  SCOPE_NAME,
} from "../demo-dsp/ramp00-demo.dsp";
import { initDemo } from "./demo-harness";
import "../components/Oscilloscope";

// ---- layout -----------------------------------------------------------

const layout = `
  <elemaudio-oscilloscope id="scope" zoom="16"></elemaudio-oscilloscope>
  <div class="scope-title"><p>ramp00 output (no audio)</p></div>
  <div class="panel">
    <h1>elemaudiors</h1>
    <h3>ramp00 &mdash; sample-rate one-shot with blocked retrigger</h3>
    <p>
      A stochastic trigger source <code>el.ge(el.latch(el.train(rate), el.rand()), threshold)</code>
      repeatedly attempts to retrigger <code>el.extra.ramp00</code>. With
      <strong>blocking</strong> on (the default), attempts that arrive while a
      ramp is already running are ignored &mdash; the ramp finishes its
      clean <code>0 &rarr; 1 &rarr; 0</code> shape in exactly
      <code>dur</code> samples, independent of trigger chatter.
    </p>
    <p>
      Dragging <strong>duration</strong> while a ramp is running does
      <em>not</em> restart it &mdash; only its slope changes, per the
      <code>ramp00</code> contract. The scope defaults to
      <strong>16&times; zoom</strong> to show several events per frame;
      click <em>Zoom</em> to iterate up to 128&times; or back to 1&times;.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start</button>
        <button id="stop" class="state-button">Stop</button>
      </div>

      <div class="row toggle-row">
        <label class="toggle-label" for="blocking-toggle">
          <span>Blocking</span>
          <span id="blocking-value">off</span>
        </label>
        <input id="blocking-toggle" type="checkbox"  />
      </div>

      <div class="row">
        <label for="dur-ms">
          <span>Duration</span>
          <span id="dur-ms-value">250 ms</span>
        </label>
        <input id="dur-ms" type="range" min="1" max="3000" value="250" step="1" />
      </div>

      <div class="row">
        <label for="clock-hz">
          <span>Trigger clock</span>
          <span id="clock-hz-value">10 Hz</span>
        </label>
        <input id="clock-hz" type="range" min="1" max="2000" value="25" step="1" />
      </div>

      <div class="row">
        <label for="threshold">
          <span>Threshold</span>
          <span id="threshold-value">0.50</span>
        </label>
        <input id="threshold" type="range" min="0" max="1" value="0.5" step="0.01" />
      </div>

      <div class="row">
        <button id="freeze-scope" class="freeze-button">Freeze</button>
        <button id="zoomButton" class="zoom-button">Zoom: 128&times;</button>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

// ---- init + bindings --------------------------------------------------

let blockingToggle: HTMLInputElement;
let blockingValue: HTMLSpanElement;
let durMsSlider: HTMLInputElement;
let durMsValue: HTMLSpanElement;
let clockHzSlider: HTMLInputElement;
let clockHzValue: HTMLSpanElement;
let thresholdSlider: HTMLInputElement;
let thresholdValue: HTMLSpanElement;
let oscilloscope: any;
let freezeButton: HTMLButtonElement;
let zoomButton: HTMLButtonElement;
let stopButton: HTMLButtonElement;
let isStopped = false;

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  buildGraph: () =>
    dspBuildGraph({
      blocking: blockingToggle.checked,
      durMs: Number(durMsSlider.value),
      clockHz: Number(clockHzSlider.value),
      threshold: Number(thresholdSlider.value),
      isStopped,
    }),
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

blockingToggle = q<HTMLInputElement>("#blocking-toggle");
blockingValue = q<HTMLSpanElement>("#blocking-value");
durMsSlider = q<HTMLInputElement>("#dur-ms");
durMsValue = q<HTMLSpanElement>("#dur-ms-value");
clockHzSlider = q<HTMLInputElement>("#clock-hz");
clockHzValue = q<HTMLSpanElement>("#clock-hz-value");
thresholdSlider = q<HTMLInputElement>("#threshold");
thresholdValue = q<HTMLSpanElement>("#threshold-value");
oscilloscope = q<any>("elemaudio-oscilloscope");
freezeButton = q<HTMLButtonElement>("#freeze-scope");
zoomButton = q<HTMLButtonElement>("#zoomButton");
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

wireControls([blockingToggle, durMsSlider, clockHzSlider, thresholdSlider]);

stopButton.addEventListener("click", async () => {
  isStopped = true;
  await renderCurrentGraph();
});

// --- freeze button ---
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


let currentZoom = 128;
oscilloscope.setAttribute("zoom", String(currentZoom));
zoomButton.textContent = `Zoom: ${currentZoom}×`;

zoomButton.addEventListener("click", () => {
  currentZoom = currentZoom === MAX_ZOOM ? 1 : currentZoom * 2;
  oscilloscope.setAttribute("zoom", String(currentZoom));
  zoomButton.textContent = `Zoom: ${currentZoom}×`;
});

// ---- readouts ---------------------------------------------------------

function updateReadouts() {
  blockingValue.textContent = blockingToggle.checked ? "on" : "off";
  durMsValue.textContent = `${Number(durMsSlider.value)} ms`;
  clockHzValue.textContent = `${Number(clockHzSlider.value)} Hz`;
  thresholdValue.textContent = Number(thresholdSlider.value).toFixed(2);
}

updateReadouts();
