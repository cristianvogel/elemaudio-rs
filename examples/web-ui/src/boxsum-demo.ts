import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import WebRenderer from "./WebRenderer";
import "./style.css";
import "./components/Oscilloscope";

///🧩 DSP ////////////////////////////////////////////////
/// Here we define nodes in the graph, by composing `el` utilities.
function buildGraph(): NodeRepr_t[] {

    const noise = el.noise({ key: "boxsum:noise", seed: 7 });

    const windowLength = el.const({ key: "boxsum:window", value: Number(windowLengthSlider.value) });

    const toneBaseFreq = el.const({ key: 'oscFreq:0', value: Number(toneHzSlider.value) });

    const modRange = el.const({ key: 'boxModRange', value: Number(boxModRangeSlider.value) });

    const boxedNoise = el.select(
        modeSelect.value === "average" ? 0 : 1,
        el.extra.boxSum(windowLength, el.mul( el.div(1, windowLength), noise)),
        el.extra.boxAverage(windowLength, noise)

    );

    const scaledBoxedNoise = el.mul(modRange, boxedNoise);

    const metered = el.scope({ name: "boxsum-scope", size: 512, channels: 1 }, boxedNoise );

    const left = el.mul(
        0.25,
        el.blepsaw(el.abs(el.add(toneBaseFreq, scaledBoxedNoise)))
    );

    const right = el.mul(
        0.25,
        el.blepsaw(el.abs(el.sub(toneBaseFreq, scaledBoxedNoise)))
    );

    return [left, el.add( right, el.mul(0, metered))];
}

async function renderCurrentGraph() {
    if (!renderer || !audioContext) {
        return;
    }

    await audioContext.resume();
    let result = await renderer.render(...buildGraph());
    updateSliderValues();
    status.textContent = JSON.stringify(result);
}

///////////////////////////////////////////////////
// DOM, Audio and reactivity support from here on
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
    throw new Error("Missing app root");
}

const root = app;

function mustQuery<T extends Element>(selector: string): T {
    const element = root.querySelector<T>(selector);

    if (!element) {
        throw new Error(`Missing control: ${selector}`);
    }

    return element;
}

app.innerHTML = `
  <elemaudio-oscilloscope id="scope" width="340" height="160" color="#6ea8fe" style="position: fixed; top: 10px; left: 10px"></elemaudio-oscilloscope>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>box-sum modulation demo</h3>
    <p>Uses <code>el.extra.boxSum(windowSamplesNode, x)</code> or <code>el.extra.boxAverage(windowSamplesNode, x)</code> to smooth white noise, then turns that moving sum into an audible tone modulation.</p>
    <p class="demo-link"><a href="/index.html">Back to the graph demo</a></p>
    <div class="controls">
      <button id="start" class="start-button">Start audio</button>
      <div class="row toggle-row">
        <label class="toggle-label" for="mode-select">
          <span>Mode</span>
          <span id="mode-value">sum</span>
        </label>
        <select id="mode-select" class="toggle-select">
          <option value="sum">sum</option>
          <option value="average">average</option>
        </select>
      </div>
      <div class="row">
        <label for="window-hz">
          <span>Window samples</span>
          <span id="window-hz-value">10</span>
        </label>
        <input id="window-hz" type="range" min="2" max="16384" value="4096" step="1" />
      </div>
      <div class="row">
        <label for="box-range">
          <span>Mod Range</span>
          <span id="box-range-value">x10</span>
        </label>
        <input id="box-range" type="range" min="1" max="100" value="8" step="1" />
      </div>

      <div class="row">
        <label for="tone-hz">
          <span>Tone</span>
          <span id="tone-hz-value">200 Hz</span>
        </label>
        <input id="tone-hz" type="range" min="60" max="900" value="200" step="1" />
      </div>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

const startButton = mustQuery<HTMLButtonElement>("#start");
const modeSelect = mustQuery<HTMLSelectElement>("#mode-select");
const modeValue = mustQuery<HTMLSpanElement>("#mode-value");
const windowLengthSlider = mustQuery<HTMLInputElement>("#window-hz");
const windowHzValue = mustQuery<HTMLSpanElement>("#window-hz-value");
const boxModRangeSlider = mustQuery<HTMLInputElement>("#box-range");
const boxModRangeValue = mustQuery<HTMLSpanElement>("#box-range-value");
const toneHzSlider = mustQuery<HTMLInputElement>("#tone-hz");
const toneHzValue = mustQuery<HTMLSpanElement>("#tone-hz-value");
const status = mustQuery<HTMLDivElement>("#status");
const oscilloscope = mustQuery<any>("elemaudio-oscilloscope");

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;

function updateSliderValues() {
    modeValue.textContent = modeSelect.value;
    windowHzValue.textContent = `${Number(windowLengthSlider.value)}`;
    toneHzValue.textContent = `${Number(toneHzSlider.value)} Hz`;
    boxModRangeValue.textContent = `x${Number(boxModRangeSlider.value)}`;
}

async function ensureAudio() {
    if (audioContext && renderer) {
        return;
    }

    audioContext = new AudioContext();
    renderer = new WebRenderer();

    renderer.on("scope", (event: any) => {
        if (event.source === "boxsum-scope") {
            const firstBlock = event.data?.[0];
            // firstBlock is expected to be the sample buffer for channels=1.
            if (firstBlock) {
                console.log("scope firstBlock", firstBlock);
                oscilloscope.data = Array.from(firstBlock as Float32Array);
            }
        }
    });

    const worklet = await renderer.initialize(audioContext);
    worklet.connect(audioContext.destination);
}

const controls = [modeSelect, windowLengthSlider, boxModRangeSlider, toneHzSlider];

controls.forEach((control) => {
    control.addEventListener("input", () => {
        updateSliderValues();

        if (renderer && audioContext?.state === "running") {
            void renderCurrentGraph();
        }
    });
});

startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    status.textContent = "Starting audio...";

    try {
        await ensureAudio();
        await renderCurrentGraph();
    } catch (error) {
        status.textContent = `Failed to start audio: ${error instanceof Error ? error.message : String(error)}`;
        startButton.disabled = false;
    }
});

updateSliderValues();
