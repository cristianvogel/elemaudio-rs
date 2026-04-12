/**
 * elemaudio-rs vocoder demo
 *
 * STFT channel vocoder with three oscilloscope channels:
 *   - Carrier (mc-test.wav)
 *   - Modulator (noise or 808 beat)
 *   - Vocoded output
 */

import { MAX_ZOOM } from "../components/Oscilloscope";
import {
  buildGraph as dspBuildGraph,
  SCOPE_CARRIER,
  SCOPE_MOD,
  SCOPE_OUTPUT,
  type ModulatorSource,
} from "../demo-dsp/vocoder-demo.dsp";
import { initDemo } from "./demo-harness";
import modUrl from "../../../demo-resources/housey.wav?url";
import carrierUrl from "../../../demo-resources/115bpm_808_Beat.flac?url";
import "../components/Oscilloscope";

// ---- constants --------------------------------------------------------

const DEMO_TITLE = "vocoder";
const DEMO_DESCRIPTION =
  "STFT channel vocoder (<code>el.extra.vocoder</code>). "
const CARRIER_VFS = "vocoder/carrier";
const MOD_VFS    = "vocoder/mod";

// ---- layout -----------------------------------------------------------

const layout = `
<div class="scope-row" style="display:flex; gap:1rem; justify-content:center;">
  <div class="scope-col" style="text-align:center;">
    <elemaudio-oscilloscope id="scope-carrier"></elemaudio-oscilloscope>
    <div class="scope-title"><p>Carrier</p></div>
  </div>
  <div class="scope-col" style="text-align:center;">
    <elemaudio-oscilloscope id="scope-mod"></elemaudio-oscilloscope>
    <div class="scope-title"><p>Modulator</p></div>
  </div>
  <div class="scope-col" style="text-align:center;">
    <elemaudio-oscilloscope id="scope-output"></elemaudio-oscilloscope>
    <div class="scope-title"><p>Output</p></div>
  </div>
</div>

  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>${DEMO_TITLE}</h3>
    <p>${DEMO_DESCRIPTION}</p>
    <div class="controls">
      <button id="start" class="start-button">Start audio</button>

      <div class="row toggle-row">
        <label class="toggle-label" for="mod-source">
          <span>Modulator</span>
          <span id="mod-source-value">noise</span>
        </label>
        <select id="mod-source" class="toggle-select">
          <option value="noise">Noise</option>
          <option value="sample">Sample</option>
        </select>
      </div>

      <div class="dial-strip" aria-label="Vocoder controls">
        <div class="dial">
          <label for="window-ms">
            <span>Window</span>
            <span id="window-ms-value">10 ms</span>
          </label>
          <input id="window-ms" type="range" min="1" max="50" value="10" step="1" />
        </div>
        <div class="dial">
          <label for="smoothing-ms">
            <span>Smoothing</span>
            <span id="smoothing-ms-value">5 ms</span>
          </label>
          <input id="smoothing-ms" type="range" min="0" max="1000" value="100" step="1" />
        </div>
        <div class="dial">
          <label for="max-gain-db">
            <span>Max Gain</span>
            <span id="max-gain-db-value">40 dB</span>
          </label>
          <input id="max-gain-db" type="range" min="0" max="100" value="40" step="1" />
        </div>
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
        <button id="zoomButton" class="zoom-button">Zoom: 1\u00D7</button>
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

// ---- state ------------------------------------------------------------

let carrierLoaded = false;
let beatLoaded = false;

// ---- init + bindings --------------------------------------------------

let modSourceSelect: HTMLSelectElement;
let modSourceValue: HTMLSpanElement;
let windowMsSlider: HTMLInputElement;
let windowMsValue: HTMLSpanElement;
let smoothingMsSlider: HTMLInputElement;
let smoothingMsValue: HTMLSpanElement;
let maxGainDbSlider: HTMLInputElement;
let maxGainDbValue: HTMLSpanElement;
let mixSlider: HTMLInputElement;
let mixValue: HTMLSpanElement;
let scopeCarrier: any;
let scopeMod: any;
let scopeOutput: any;
let freezeButton: HTMLButtonElement;
let zoomButton: HTMLButtonElement;

const { mustQuery: q, wireControls } = initDemo({
  layout,
  buildGraph: () =>
    dspBuildGraph({
      windowMs: Number(windowMsSlider.value),
      smoothingMs: Number(smoothingMsSlider.value),
      maxGainDb: Number(maxGainDbSlider.value),
      modulatorSource: modSourceSelect.value as ModulatorSource,
      mix: Number(mixSlider.value),
      carrierPath: carrierLoaded ? CARRIER_VFS : undefined,
      modPath: beatLoaded ? MOD_VFS : undefined,
    }),
  updateReadouts,
  onScopeEvent: (event: any) => {
    const block = event.data?.[0];
    if (!block) return;
    const arr = Array.from(block as Float32Array);

    if (event.source === SCOPE_CARRIER && scopeCarrier) scopeCarrier.data = arr;
    if (event.source === SCOPE_MOD && scopeMod)         scopeMod.data = arr;
    if (event.source === SCOPE_OUTPUT && scopeOutput)   scopeOutput.data = arr;
  },
  onAudioReady: async (renderer) => {
    // Load both samples into the VFS.
    async function loadSample(url: string, vfsPath: string): Promise<Float32Array | null> {
      try {
        const response = await fetch(url);
        const bytes = await response.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(bytes);
        await audioCtx.close();
        return new Float32Array(decoded.getChannelData(0));
      } catch (err) {
        console.warn(`Failed to load ${vfsPath}:`, err);
        return null;
      }
    }

    const [carrierData, beatData] = await Promise.all([
      loadSample(carrierUrl, CARRIER_VFS),
      loadSample(modUrl, MOD_VFS),
    ]);

    const vfs: Record<string, Float32Array> = {};
    if (carrierData) { vfs[CARRIER_VFS] = carrierData; carrierLoaded = true; }
    if (beatData)    { vfs[MOD_VFS]    = beatData;    beatLoaded = true; }

    if (Object.keys(vfs).length > 0) {
      await renderer.updateVirtualFileSystem(vfs);
    }
  },
});

// ---- control bindings (after layout injection) ------------------------

modSourceSelect   = q<HTMLSelectElement>("#mod-source");
modSourceValue    = q<HTMLSpanElement>("#mod-source-value");
windowMsSlider    = q<HTMLInputElement>("#window-ms");
windowMsValue     = q<HTMLSpanElement>("#window-ms-value");
smoothingMsSlider = q<HTMLInputElement>("#smoothing-ms");
smoothingMsValue  = q<HTMLSpanElement>("#smoothing-ms-value");
maxGainDbSlider   = q<HTMLInputElement>("#max-gain-db");
maxGainDbValue    = q<HTMLSpanElement>("#max-gain-db-value");
mixSlider         = q<HTMLInputElement>("#mix");
mixValue          = q<HTMLSpanElement>("#mix-value");
scopeCarrier      = q<any>("#scope-carrier");
scopeMod          = q<any>("#scope-mod");
scopeOutput       = q<any>("#scope-output");
freezeButton      = q<HTMLButtonElement>("#freeze-scope");
zoomButton        = q<HTMLButtonElement>("#zoomButton");

wireControls([
  modSourceSelect,
  windowMsSlider,
  smoothingMsSlider,
  maxGainDbSlider,
  mixSlider,
]);

// ---- freeze / zoom ----------------------------------------------------

freezeButton.addEventListener("click", () => {
  const frozen = scopeCarrier.hasAttribute("freeze");
  [scopeCarrier, scopeMod, scopeOutput].forEach((s: any) => {
    if (frozen) s.removeAttribute("freeze");
    else s.setAttribute("freeze", "");
  });
  freezeButton.textContent = frozen ? "Freeze" : "Unfreeze";
});

let currentZoom = 1;
zoomButton.textContent = "Zoom: 1\u00D7";
[scopeCarrier, scopeMod, scopeOutput].forEach((s: any) =>
  s.setAttribute("zoom", String(currentZoom)),
);

zoomButton.addEventListener("click", () => {
  currentZoom = currentZoom === MAX_ZOOM ? 1 : currentZoom * 2;
  [scopeCarrier, scopeMod, scopeOutput].forEach((s: any) =>
    s.setAttribute("zoom", String(currentZoom)),
  );
  zoomButton.textContent = `Zoom: ${currentZoom}\u00D7`;
});

// ---- readouts ---------------------------------------------------------

function updateReadouts() {
  modSourceValue.textContent = modSourceSelect.value;
  windowMsValue.textContent = `${windowMsSlider.value} ms`;
  smoothingMsValue.textContent = `${smoothingMsSlider.value} ms`;
  maxGainDbValue.textContent = `${maxGainDbSlider.value} dB`;
  mixValue.textContent = `${Math.round(Number(mixSlider.value) * 100)}%`;
}

updateReadouts();
