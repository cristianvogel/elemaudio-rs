/**
 * elemaudio-rs waveshaper demo
 *
 * Explores native low-level waveshapers starting with el.extra.foldback.
 * Supports oscillator and sample-based source selection.
 */

import {MAX_ZOOM} from "../components/Oscilloscope";
import {buildGraph as dspBuildGraph, SCOPE_NAME, type SourceMode} from "../demo-dsp/waveshaper-demo.dsp";
import {initDemo} from "./demo-harness";
import sampleUrl from "../../../demo-resources/115bpm_808_Beat_mono.wav?url";
import "../components/Oscilloscope";

// ---- constants --------------------------------------------------------

const DEMO_TITLE = "waveshaper";
const DEMO_DESCRIPTION =
    "Low-level waveshaper explorer. Uses <code>el.extra.foldback</code> to recursively fold a signal into a threshold interval, shaping timbre.";
const SAMPLE_VFS_PATH = "waveshaper/808-beat.wav";

// ---- layout -----------------------------------------------------------

const layout = `
  <elemaudio-oscilloscope id="scope" ></elemaudio-oscilloscope>
  <div class="scope-title"><p>Shaped signal</p></div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>${DEMO_TITLE}</h3>
    <p>${DEMO_DESCRIPTION}</p>
    <div class="controls">
      <button id="start" class="start-button">Start audio</button>

      <div class="row toggle-row">
        <label class="toggle-label" for="source-select">
          <span>Source</span>
          <span id="source-value">oscillator</span>
        </label>
        <select id="source-select" class="toggle-select">
          <option value="oscillator">Oscillator</option>
          <option value="sample">808 Sample</option>
        </select>
      </div>

      <div class="row">
        <label for="freq">
          <span>Tone Frequency</span>
          <span id="freq-value">220 Hz</span>
        </label>
        <input id="freq" type="range" min="10" max="2000" value="220" step="1" />
      </div>
      
      <div class="dial-strip" aria-label="Filter controls">
        <div class="dial">
          <label for="cutoff">
            <span>Filter Cutoff</span>
            <span id="cutoff-value">300 Hz</span>
          </label>
          <input id="cutoff" type="range" min="0" max="1" value="0.37" step="0.001" />
        </div>
        <div class="dial">
          <label for="filter-type">
            <span>Filter Type</span>
            <span id="filter-type-value">highpass</span>
          </label>
          <select id="filter-type" class="toggle-select">
            <option value="highpass">Highpass</option>
            <option value="lowpass">Lowpass</option>
          </select>
        </div>
        <div class="dial">
          <label for="slope">
            <span>Slope</span>
            <span id="slope-value">8</span>
          </label>
          <input id="slope" type="range" min="2" max="8" value="8" step="1" />
        </div>
      </div>

      <div class="row">
        <label for="drive">
          <span>Drive</span>
          <span id="drive-value">1.00x</span>
        </label>
        <input id="drive" type="range" min="0.1" max="8" value="1" step="0.01" />
      </div>

      <div class="row">
        <label for="thresh">
          <span>Fold threshold</span>
          <span id="thresh-value">1.00</span>
        </label>
        <input id="thresh" type="range" min="0.01" max="2" value="1" step="0.01" />
      </div>

      <div class="row">
        <label for="amp">
          <span>Post amp</span>
          <span id="amp-value">1.00</span>
        </label>
        <input id="amp" type="range" min="0.1" max="4" value="1" step="0.01" />
      </div>

      <div class="row">
        <label for="mix">
          <span>Dry / Wet</span>
          <span id="mix-value">100%</span>
        </label>
        <input id="mix" type="range" min="0" max="1" value="1" step="0.01" />
      </div>

      <div class="row">
        <button id="freeze-scope" class="freeze-button">Freeze</button>
        <button id="zoomButton" class="zoom-button">Zoom: 1×</button>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

// ---- state ------------------------------------------------------------

let sampleLoaded = false;
const MIN_CUTOFF = 20;
const MAX_CUTOFF = 16000;

function cutoffFromSlider(slider: HTMLInputElement) {
    const position = Number(slider.value) / Number(slider.max);
    return Math.round(MIN_CUTOFF * Math.pow(MAX_CUTOFF / MIN_CUTOFF, position));
}

// ---- init -------------------------------------------------------------

// initDemo injects the layout and returns query/wire helpers.
// Closures below capture `let` bindings which are assigned immediately after.
let freqSlider: HTMLInputElement;
let freqValue: HTMLSpanElement;
let cutOffSlider: HTMLInputElement;
let cutOffValue: HTMLSpanElement;
let slopeSlider: HTMLInputElement;
let slopeValue: HTMLSpanElement;
let filterTypeSelect: HTMLSelectElement;
let filterTypeValue: HTMLSpanElement;
let driveSlider: HTMLInputElement;
let driveValue: HTMLSpanElement;
let threshSlider: HTMLInputElement;
let threshValue: HTMLSpanElement;
let ampSlider: HTMLInputElement;
let ampValue: HTMLSpanElement;
let mixSlider: HTMLInputElement;
let mixValue: HTMLSpanElement;
let sourceSelect: HTMLSelectElement;
let sourceValue: HTMLSpanElement;
let oscilloscope: any;
let freezeButton: HTMLButtonElement;
let zoomButton: HTMLButtonElement;

const {mustQuery: q, wireControls} = initDemo({
    layout,
    buildGraph: () => dspBuildGraph({
        source: sourceSelect.value as SourceMode,
        freq: Number(freqSlider.value),
        cutOff: cutoffFromSlider(cutOffSlider),
        slope: Number(slopeSlider.value),
        filterType: filterTypeSelect.value as "highpass" | "lowpass",
        drive: Number(driveSlider.value),
        thresh: Number(threshSlider.value),
        amp: Number(ampSlider.value),
        mix: Number(mixSlider.value),
        samplePath: sampleLoaded ? SAMPLE_VFS_PATH : undefined
    }),
    updateReadouts,
    onScopeEvent: (event: any) => {
        if (event.source === SCOPE_NAME) {
            const block = event.data?.[0];
            if (block) oscilloscope.data = Array.from(block as Float32Array);
        }
    },
    onAudioReady: async (renderer) => {
        try {
            const response = await fetch(sampleUrl);
            const bytes = await response.arrayBuffer();
            const audioCtx = new AudioContext();
            const decoded = await audioCtx.decodeAudioData(bytes);
            await audioCtx.close();
            const data = new Float32Array(decoded.getChannelData(0));
            await renderer.updateVirtualFileSystem({[SAMPLE_VFS_PATH]: data});
            sampleLoaded = true;
        } catch (err) {
            console.warn("Failed to pre-load sample for waveshaper demo:", err);
        }
    }
});

// ---- control bindings (after layout injection) ------------------------

freqSlider = q<HTMLInputElement>("#freq");
freqValue = q<HTMLSpanElement>("#freq-value");
cutOffSlider = q<HTMLInputElement>("#cutoff");
cutOffValue = q<HTMLSpanElement>("#cutoff-value");
slopeSlider = q<HTMLInputElement>("#slope");
slopeValue = q<HTMLSpanElement>("#slope-value");
filterTypeSelect = q<HTMLSelectElement>("#filter-type");
filterTypeValue = q<HTMLSpanElement>("#filter-type-value");
driveSlider = q<HTMLInputElement>("#drive");
driveValue = q<HTMLSpanElement>("#drive-value");
threshSlider = q<HTMLInputElement>("#thresh");
threshValue = q<HTMLSpanElement>("#thresh-value");
ampSlider = q<HTMLInputElement>("#amp");
ampValue = q<HTMLSpanElement>("#amp-value");
mixSlider = q<HTMLInputElement>("#mix");
mixValue = q<HTMLSpanElement>("#mix-value");
sourceSelect = q<HTMLSelectElement>("#source-select");
sourceValue = q<HTMLSpanElement>("#source-value");
oscilloscope = q<HTMLElement>("elemaudio-oscilloscope");
freezeButton = q<HTMLButtonElement>("#freeze-scope");
zoomButton = q<HTMLButtonElement>("#zoomButton");

wireControls([sourceSelect, freqSlider, cutOffSlider, slopeSlider, filterTypeSelect, driveSlider, threshSlider, ampSlider, mixSlider]);

// Toggle freeze state on the oscilloscope
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

// Cycle zoom 1× → 2× → 4×
let currentZoom = 1;
zoomButton.textContent = "Zoom: 1×";
oscilloscope.setAttribute("zoom", String(currentZoom));

zoomButton.addEventListener("click", () => {
    currentZoom = currentZoom === MAX_ZOOM ? 1 : currentZoom * 2;
    oscilloscope.setAttribute("zoom", String(currentZoom));
    zoomButton.textContent = `Zoom: ${currentZoom}×`;
});

function updateReadouts() {
    sourceValue.textContent = sourceSelect.value;
    freqSlider.disabled = sourceSelect.value === "sample";
    freqValue.textContent = `${Number(freqSlider.value)} Hz`;
    cutOffValue.textContent = `${cutoffFromSlider(cutOffSlider)} Hz`;
    slopeValue.textContent = slopeSlider.value;
    filterTypeValue.textContent = filterTypeSelect.value;
    driveValue.textContent = `${Number(driveSlider.value).toFixed(2)}x`;
    threshValue.textContent = Number(threshSlider.value).toFixed(2);
    ampValue.textContent = Number(ampSlider.value).toFixed(2);
    mixValue.textContent = `${Math.round(Number(mixSlider.value) * 100)}%`;
}

updateReadouts();
