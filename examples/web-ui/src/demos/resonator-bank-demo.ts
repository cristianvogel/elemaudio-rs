/**
 * elemaudio-rs modal resonator bank demo — UI shell.
 *
 * DSP lives in `../demo-dsp/resonator-bank-demo.dsp.ts`. This file wires
 * the control panel, reads slider values, and renders the graph.
 */

import {MAX_ZOOM} from "../components/Oscilloscope";
import "../components/Oscilloscope";
import {
    buildGraph as buildDspGraph,
    type ClipMode,
    type ExciterKind,
    type ResonatorBankParams,
    SCOPE_HAMMER,
    SCOPE_OUTPUT
} from "../demo-dsp/resonator-bank-demo.dsp";
import {initDemo} from "./demo-harness";

const layout = `
  <div class="scope-row" style="display:flex; gap:1rem; justify-content:center;">
    <div class="scope-col" style="text-align:center;">
      <elemaudio-oscilloscope id="scope-hammer"></elemaudio-oscilloscope>
      <div class="scope-title"><p>Hammer</p></div>
    </div>
    <div class="scope-col" style="text-align:center;">
      <elemaudio-oscilloscope id="scope-output"></elemaudio-oscilloscope>
      <div class="scope-title"><p>Output</p></div>
    </div>
  </div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>modal stiff-string resonator bank</h3>
    <p>
      A modal bank built from stiff-string maths. Each partial is a
      tuned Karplus-Strong-style delay resonator with per-mode damping
      ( dispersive wave propagation ).
      Excite with a <em>hammer</em> (velocity + hardness) or
      <em>dust</em> for A/B. TS reference implementation; the Rust
      <code>el::extra::resonator_bank</code> is still in the works.
    </p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="exciter">
            <span>Exciter</span>
            <span id="exciter-value">Hammer</span>
          </label>
          <select id="exciter">
            <option value="hammer" selected>Hammer</option>
            <option value="dust">Dust</option>
          </select>
        </div>

        <div class="dial">
          <label for="f0">
            <span>Fundamental</span>
            <span id="f0-value">110 Hz</span>
          </label>
          <input id="f0" type="range" min="40" max="880" value="110" step="1" />
        </div>

        <div class="dial">
          <label for="modes">
            <span>Modes</span>
            <span id="modes-value">24</span>
          </label>
          <input id="modes" type="range" min="1" max="64" value="24" step="1" />
        </div>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="inharmonicity">
            <span>Inharmonicity</span>
            <span id="inharmonicity-value">0.0004</span>
          </label>
          <input id="inharmonicity" type="range" min="0" max="100" value="4" step="1" />
        </div>

        <div class="dial">
          <label for="strikePos">
            <span>Strike position</span>
            <span id="strikePos-value">0.12</span>
          </label>
          <input id="strikePos" type="range" min="1" max="50" value="12" step="1" />
        </div>

        <div class="dial">
          <label for="brightness">
            <span>Brightness</span>
            <span id="brightness-value">30 %</span>
          </label>
          <input id="brightness" type="range" min="0" max="100" value="30" step="1" />
        </div>

        <div class="dial">
          <label for="spread">
            <span>Stereo Spread</span>
            <span id="spread-value">35 %</span>
          </label>
          <input id="spread" type="range" min="0" max="100" value="35" step="1" />
        </div>

        <div class="dial">
          <label for="decay">
            <span>Decay</span>
            <span id="decay-value">70 %</span>
          </label>
          <input id="decay" type="range" min="0" max="100" value="70" step="1" />
        </div>
      </div>

      <div class="dial-strip">
        <div class="dial">
        <label for="position-jitter">
            <span >Strike position mod</span>
            <span id="position-jitter-value">0 %</span>
        </label>
        <input id="position-jitter" type="range" min="0" max="100" value="0" step="1" />
        </div>
        <div class="dial">
          <label for="strikeRate">
            <span>Strike rate</span>
            <span id="strikeRate-value">1.5 Hz</span>
          </label>
          <input id="strikeRate" type="range" min="1" max="100" value="15" step="1" />
        </div>

        <div class="dial">
          <label for="velocity">
            <span>Velocity</span>
            <span id="velocity-value">80 %</span>
          </label>
          <input id="velocity" type="range" min="0" max="100" value="80" step="1" />
        </div>

        <div class="dial">
          <label for="hardness">
            <span>Hardness</span>
            <span id="hardness-value">50 %</span>
          </label>
          <input id="hardness" type="range" min="0" max="100" value="50" step="1" />
        </div>
      </div>

      <div class="dial-strip">
        <div class="dial">
          <label for="dustDensity">
            <span>Dust density</span>
            <span id="dustDensity-value">8 Hz</span>
          </label>
          <input id="dustDensity" type="range" min="1" max="500" value="8" step="1" />
        </div>

        <div class="dial">
          <label for="dustReleaseMs">
            <span>Dust release</span>
            <span id="dustReleaseMs-value">1 ms</span>
          </label>
          <input id="dustReleaseMs" type="range" min="0" max="200" value="1" step="1" />
        </div>

        <div class="dial">
          <label for="dustJitter">
            <span>Dust jitter</span>
            <span id="dustJitter-value">0 %</span>
          </label>
          <input id="dustJitter" type="range" min="0" max="100" value="0" step="1" />
        </div>

        <div class="dial">
          <label for="gain">
            <span>Output gain</span>
            <span id="gain-value">50 %</span>
          </label>
          <input id="gain" type="range" min="0" max="100" value="50" step="1" />
        </div>

        <div class="dial">
          <label for="clip-mode">
            <span>Clip flavour</span>
            <span id="clip-mode-value">Soft</span>
          </label>
          <select id="clip-mode">
            <option value="soft" selected>Soft tanh</option>
            <option value="limiter">Limiter</option>
          </select>
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

let exciterSelect: HTMLSelectElement;
let exciterValue: HTMLSpanElement;
let f0Slider: HTMLInputElement;
let f0Value: HTMLSpanElement;
let modesSlider: HTMLInputElement;
let modesValue: HTMLSpanElement;
let inharmSlider: HTMLInputElement;
let inharmValue: HTMLSpanElement;
let strikePosSlider: HTMLInputElement;
let strikePosValue: HTMLSpanElement;
let strikePosJitterSlider: HTMLInputElement;
let strikePosJitterValue: HTMLSpanElement;
let brightSlider: HTMLInputElement;
let brightValue: HTMLSpanElement;
let spreadSlider: HTMLInputElement;
let spreadValue: HTMLSpanElement;
let decaySlider: HTMLInputElement;
let decayValue: HTMLSpanElement;
let strikeRateSlider: HTMLInputElement;
let strikeRateValue: HTMLSpanElement;
let velocitySlider: HTMLInputElement;
let velocityValue: HTMLSpanElement;
let hardnessSlider: HTMLInputElement;
let hardnessValue: HTMLSpanElement;
let dustDensitySlider: HTMLInputElement;
let dustDensityValue: HTMLSpanElement;
let dustReleaseSlider: HTMLInputElement;
let dustReleaseValue: HTMLSpanElement;
let dustJitterSlider: HTMLInputElement;
let dustJitterValue: HTMLSpanElement;
let gainSlider: HTMLInputElement;
let gainValue: HTMLSpanElement;
let clipModeSelect: HTMLSelectElement;
let clipModeValue: HTMLSpanElement;
let hammerScope: any;
let outputScope: any;
let freezeButton: HTMLButtonElement;
let zoomButton: HTMLButtonElement;
let stopButton: HTMLButtonElement;
let isStopped = false;
const DENSITY_MIN_HZ = 0.25;
const DENSITY_MAX_HZ = 500;

function densityFromSlider(v: number): number {
    const t = v / 1000;
    return DENSITY_MIN_HZ * Math.pow(DENSITY_MAX_HZ / DENSITY_MIN_HZ, t);
}

// Inharmonicity slider 0..100 maps to 0..0.01 with a mild curve so low
// values get better resolution (the musical action is sub-0.002).
function inharmFromSlider(v: number): number {
    const t = v / 100;
    return 0.01 * Math.pow(t, 2);
}

// Strike position slider 1..50 maps to 0.01..0.50.
function strikePosFromSlider(v: number): number {
    return v / 100;
}

// Strike rate slider 1..100 maps to 0.1..10 Hz logarithmically.
function strikeRateFromSlider(v: number): number {
    const t = (v - 1) / 99;
    return 0.1 * Math.pow(100, t);
}

function currentParams(): ResonatorBankParams {
    return {
        exciter: exciterSelect.value as ExciterKind,
        f0: Number(f0Slider.value),
        inharmonicity: inharmFromSlider(Number(inharmSlider.value)),
        strikePos: strikePosFromSlider(Number(strikePosSlider.value)),
        strikePosJitter: Number(strikePosJitterSlider.value) / 100,
        brightness: Number(brightSlider.value) / 100,
        stereoSpread: Number(spreadSlider.value) / 100,
        decay: Number(decaySlider.value) / 100,
        modes: Number(modesSlider.value),
        strikeRate: strikeRateFromSlider(Number(strikeRateSlider.value)),
        velocity: Number(velocitySlider.value) / 100,
        hardness: Number(hardnessSlider.value) / 100,
        dustDensity: Number(dustDensitySlider.value),
        dustReleaseMs: Number(dustReleaseSlider.value),
        dustJitter: Number(dustJitterSlider.value) / 100,
        gain: 0.65 * Math.pow(Number(gainSlider.value) / 100, 2.4),
        clipMode: clipModeSelect.value as ClipMode,
        isStopped
    };
}

function buildGraph() {
    return buildDspGraph(currentParams());
}

const {mustQuery: q, wireControls, renderCurrentGraph} = initDemo({
    layout,
    buildGraph,
    updateReadouts,
    renderOptions: {rootFadeInMs: 0, rootFadeOutMs: 20},
    onScopeEvent: (event: any) => {
        const firstBlock = event.data?.[0];
        if (!firstBlock) return;

        if (event.source === SCOPE_HAMMER && hammerScope) {
            hammerScope.data = Array.from(firstBlock as Float32Array);
        }

        if (event.source === SCOPE_OUTPUT && outputScope) {
            outputScope.data = Array.from(firstBlock as Float32Array);
        }
    }
});

exciterSelect = q<HTMLSelectElement>("#exciter");
exciterValue = q<HTMLSpanElement>("#exciter-value");
f0Slider = q<HTMLInputElement>("#f0");
f0Value = q<HTMLSpanElement>("#f0-value");
modesSlider = q<HTMLInputElement>("#modes");
modesValue = q<HTMLSpanElement>("#modes-value");
inharmSlider = q<HTMLInputElement>("#inharmonicity");
inharmValue = q<HTMLSpanElement>("#inharmonicity-value");
strikePosSlider = q<HTMLInputElement>("#strikePos");
strikePosValue = q<HTMLSpanElement>("#strikePos-value");
strikePosJitterSlider = q<HTMLInputElement>("#position-jitter");
strikePosJitterValue = q<HTMLSpanElement>("#position-jitter-value");
brightSlider = q<HTMLInputElement>("#brightness");
brightValue = q<HTMLSpanElement>("#brightness-value");
spreadSlider = q<HTMLInputElement>("#spread");
spreadValue = q<HTMLSpanElement>("#spread-value");
decaySlider = q<HTMLInputElement>("#decay");
decayValue = q<HTMLSpanElement>("#decay-value");
strikeRateSlider = q<HTMLInputElement>("#strikeRate");
strikeRateValue = q<HTMLSpanElement>("#strikeRate-value");
velocitySlider = q<HTMLInputElement>("#velocity");
velocityValue = q<HTMLSpanElement>("#velocity-value");
hardnessSlider = q<HTMLInputElement>("#hardness");
hardnessValue = q<HTMLSpanElement>("#hardness-value");
dustDensitySlider = q<HTMLInputElement>("#dustDensity");
dustDensityValue = q<HTMLSpanElement>("#dustDensity-value");
dustReleaseSlider = q<HTMLInputElement>("#dustReleaseMs");
dustReleaseValue = q<HTMLSpanElement>("#dustReleaseMs-value");
dustJitterSlider = q<HTMLInputElement>("#dustJitter");
dustJitterValue = q<HTMLSpanElement>("#dustJitter-value");
gainSlider = q<HTMLInputElement>("#gain");
gainValue = q<HTMLSpanElement>("#gain-value");
clipModeSelect = q<HTMLSelectElement>("#clip-mode");
clipModeValue = q<HTMLSpanElement>("#clip-mode-value");
hammerScope = q<any>("#scope-hammer");
outputScope = q<any>("#scope-output");
freezeButton = q<HTMLButtonElement>("#freeze-scope");
zoomButton = q<HTMLButtonElement>("#zoomButton");
stopButton = q<HTMLButtonElement>("#stop");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
    isStopped = false;
});

wireControls([
    exciterSelect,
    f0Slider,
    modesSlider,
    inharmSlider,
    strikePosSlider,
    strikePosJitterSlider,
    brightSlider,
    spreadSlider,
    decaySlider,
    strikeRateSlider,
    velocitySlider,
    hardnessSlider,
    dustDensitySlider,
    dustReleaseSlider,
    dustJitterSlider,
    gainSlider,
    clipModeSelect
]);

stopButton.addEventListener("click", async () => {
    isStopped = true;
    await renderCurrentGraph();
});

freezeButton.addEventListener("click", () => {
    const isFrozen = hammerScope.hasAttribute("freeze");
    if (isFrozen) {
        hammerScope.removeAttribute("freeze");
        outputScope.removeAttribute("freeze");
        freezeButton.textContent = "Freeze";
    } else {
        hammerScope.setAttribute("freeze", "");
        outputScope.setAttribute("freeze", "");
        freezeButton.textContent = "Unfreeze";
    }
});

let currentZoom = MAX_ZOOM;
hammerScope.setAttribute("zoom", String(currentZoom));
outputScope.setAttribute("zoom", String(currentZoom));
zoomButton.textContent = `Zoom: ${currentZoom}×`;

zoomButton.addEventListener("click", () => {
    currentZoom = currentZoom === MAX_ZOOM ? 1 : currentZoom * 2;
    hammerScope.setAttribute("zoom", String(currentZoom));
    outputScope.setAttribute("zoom", String(currentZoom));
    zoomButton.textContent = `Zoom: ${currentZoom}×`;
});

function updateReadouts() {
    exciterValue.textContent = exciterSelect.value === "hammer" ? "Hammer" : "Dust";
    f0Value.textContent = `${Number(f0Slider.value)} Hz`;
    modesValue.textContent = `${Number(modesSlider.value)}`;
    const B = inharmFromSlider(Number(inharmSlider.value));
    inharmValue.textContent = B < 0.001 ? B.toExponential(2) : B.toFixed(4);
    strikePosValue.textContent = strikePosFromSlider(Number(strikePosSlider.value)).toFixed(2);
    strikePosJitterValue.textContent = `${Number(strikePosJitterSlider.value)} %`;
    brightValue.textContent = `${Number(brightSlider.value)} %`;
    spreadValue.textContent = `${Number(spreadSlider.value)} %`;
    decayValue.textContent = `${Number(decaySlider.value)} %`;
    const rate = strikeRateFromSlider(Number(strikeRateSlider.value));
    strikeRateValue.textContent =
        rate < 1 ? `${rate.toFixed(2)} Hz` : `${rate.toFixed(1)} Hz`;
    velocityValue.textContent = `${Number(velocitySlider.value)} %`;
    hardnessValue.textContent = `${Number(hardnessSlider.value)} %`;
    const d = densityFromSlider(Number(dustDensitySlider.value));
    // Finer formatting at low density for visibility below 1 Hz.
    dustDensityValue.textContent = d < 1 ? `${d.toFixed(2)} Hz` : `${d.toFixed(1)} Hz`;
    dustReleaseValue.textContent = `${Number(dustReleaseSlider.value)} ms`;
    dustJitterValue.textContent = `${Number(dustJitterSlider.value)} %`;
    gainValue.textContent = `${Number(gainSlider.value)} %`;
    clipModeValue.textContent = clipModeSelect.value === "limiter" ? "Limiter" : "Soft";
}

updateReadouts();
