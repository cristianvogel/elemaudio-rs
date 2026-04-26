import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import sampleUrl from "../../../demo-resources/115bpm_808_Beat_mono.wav?url";
import irUrl from "../../../demo-resources/SURFACE.wav?url";
import {buildGraph as dspBuildGraph} from "../demo-dsp/sample-fshift-convolvers-demo.dsp";
import WebRenderer from "../WebRenderer";
import "../style.css";

const bundledSamplePath = "SRC:SAMPLES FILE";
const bundledIrBasePath = "SRC:IR FILE";
let samplePath = bundledSamplePath;
let sampleChannels = 1;
let irChannelPaths: string[] = [];
let activeIrPairStart = 0;

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
  <div class="panel">
    <h1>elemaudiors</h1> <h3><i>extra</i> ⊙ sample ⊙ freqShift ⊙ convolver</h3>
    <p>Loads a sample and a four-channel IR from <code>demo-resources/</code> 
    then processes the audio through 
    <code>el.extra.freqShift(...)</code> into switchable <code>el.extra.convolve(...)</code> and <code>el.extra.convolveSpectral(...)</code>. 
    The demo IR has 4 channels. It has been pre-prepared so that channel 3 and 4 are reversed versions of the IR. 
    This is one way to make it trivial to swap the response in realtime.</p>

    <div class="controls">
      <div class="dial-strip dial-strip-three" aria-label="Sample and mix controls">
        <div class="dial">
          <label for="rate">
            <span>Playback</span>
            <span id="rate-value">1.00x</span>
          </label>
          <input id="rate" type="range" min="-1.5" max="1.5" value="1" step="0.01" />
        </div>
        <div class="dial">
          <label for="blend">
            <span>Dry/Wet</span>
            <span id="blend-value">50%</span>
          </label>
          <input id="blend" type="range" min="0" max="100" value="50" step="1" />
        </div>
      </div>

      <div class="dial-strip dial-strip-ir" aria-label="IR shaping controls">
        <div class="dial">
        <label for="convolver-mode">
        <span>Convolver</span>
        <span id="convolver-mode-value">static</span>
        </label>
        <select id="convolver-mode" class="toggle-select">
        <option value="static" selected>static</option>
        <option value="spectral">spectral</option>
        </select>
        </div>
        <div class="dial">
        <label for="start-offset">
        <span>IR Start</span>
        </label>
        <input id="start-offset" type="range" min="0" max="100" value="0" step="1" />
        <span id="start-offset-value">0</span>
        </div>
         <div class="dial">
        <label for="ir-end">
        <span>IR End</span>
        </label>
        <input id="ir-end" type="range" min="0" max="100" value="100" step="1" />
        <span id="ir-end-value">100</span>
        </div>
        <div class="dial">
        <label for="ir-rate">
        <span>IR Rate</span>
        <span id="ir-rate-value">1.00x</span>
        </label>
        <input id="ir-rate" type="range" min="0.1" max="2.0" value="1.0" step="0.01" />
        </div>
        <div class="dial">
        <label for="ir-attenuation">
        <span>IR Attenuation </span>
        <span id="ir-attenuation-value">0 dB</span>
        </label>
        <input id="ir-attenuation" type="range" min="0" max="60" value="16" step="1" />
        </div>
        <div class="dial">
        <label for="ir-normalize">
        <span>Normalise</span>
        </label>
        <input id="ir-normalize" type="checkbox" checked/>
        </div>
        <div class="dial">
        <label for="spectral-tilt">
        <span>Tilt</span>
        <span id="spectral-tilt-value">0 dB/oct</span>
        </label>
        <input id="spectral-tilt" type="range" min="-12" max="12" value="0" step="1" />
        </div>
        <div class="dial">
        <label for="spectral-blur">
        <span>Blur</span>
        <span id="spectral-blur-value">0%</span>
        </label>
        <input id="spectral-blur" type="range" min="0" max="99" value="0" step="1" />
        </div>
      </div>

      <div class="dial-strip dial-strip-three" aria-label="Modulation controls">
        <div class="dial">
          <label for="chopper-threshold">
            <span>Chopper</span>
            <span id="chopper-threshold-value">0.50</span>
          </label>
          <input id="chopper-threshold" type="range" min="1.0e-4" max="1" value="0.1" step="0.01" />
        </div>
        <div class="dial">
          <label for="freq-shift-hz">
            <span class="dial-heading-with-action">
              <button id="freqshift-zoom" class="dial-corner-button" type="button" aria-label="Toggle freqshift zoom">x0.01</button>
              <span>Freq Shift</span>
            </span>
            <span id="freq-shift-hz-value">110 Hz</span>
          </label>
          <input id="freq-shift-hz" type="range" min="-600" max="600" value="50" step="0.001" />
        </div>
        <div class="dial">
          <label for="freqshift-feedback">
            <span>Feedback</span>
            <span id="freqshift-feedback-value">0%</span>
          </label>
          <input id="freqshift-feedback" type="range" min="0" max="95" value="0" step="1" />
        </div>
      </div>

      <div class="resource-row resource-grid">
        <div class="row resource-cell">
          <label for="sample-file">
            <span>Browser file</span>
            <span id="sample-file-name" class="file-name">Demo sample</span>
          </label>
          <input id="sample-file" type="file" accept="audio/*" />
        </div>
        <div class="row resource-cell">
          <label for="ir-file">
            <span>Load new IR</span>
            <span id="ir-file-name" class="file-name">Demo IR</span>
          </label>
          <input id="ir-file" type="file" accept="audio/*" />
        </div>
      </div>
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>
        <button id="reload" class="secondary" hidden>Reload sample</button>
        <button id="toggle-ir" class="secondary">Use IR pair 1/2</button>
      </div>
      <div class="status" id="status">Idle</div>
      <div class="resource-status" id="resource-status">Sample not loaded</div>
    </div>
  </div>
`;

const startButton = mustQuery<HTMLButtonElement>("#start");
const stopButton = mustQuery<HTMLButtonElement>("#stop");
const reloadButton = mustQuery<HTMLButtonElement>("#reload"); // not using
const freqShiftZoomButton = mustQuery<HTMLButtonElement>("#freqshift-zoom");
const irStart = mustQuery<HTMLInputElement>("#start-offset");
const irStartValue = mustQuery<HTMLSpanElement>("#start-offset-value");
const irEnd = mustQuery<HTMLInputElement>("#ir-end");
const irEndValue = mustQuery<HTMLSpanElement>("#ir-end-value");
const irRate = mustQuery<HTMLInputElement>("#ir-rate");
const irRateValue = mustQuery<HTMLSpanElement>("#ir-rate-value");
const irAttenuation = mustQuery<HTMLInputElement>("#ir-attenuation");
const irAttenuationValue = mustQuery<HTMLSpanElement>("#ir-attenuation-value");
const irNormalize = mustQuery<HTMLInputElement>("#ir-normalize");
const convolverModeSelect = mustQuery<HTMLSelectElement>("#convolver-mode");
const convolverModeValue = mustQuery<HTMLSpanElement>("#convolver-mode-value");
const spectralTiltSlider = mustQuery<HTMLInputElement>("#spectral-tilt");
const spectralTiltValue = mustQuery<HTMLSpanElement>("#spectral-tilt-value");
const spectralBlurSlider = mustQuery<HTMLInputElement>("#spectral-blur");
const spectralBlurValue = mustQuery<HTMLSpanElement>("#spectral-blur-value");
const rateSlider = mustQuery<HTMLInputElement>("#rate");
const blendSlider = mustQuery<HTMLInputElement>("#blend");
const chopperThresholdSlider = mustQuery<HTMLInputElement>("#chopper-threshold");
const freqShiftHzSlider = mustQuery<HTMLInputElement>("#freq-shift-hz");
const freqShiftFeedbackSlider = mustQuery<HTMLInputElement>("#freqshift-feedback");
const sampleFileInput = mustQuery<HTMLInputElement>("#sample-file");
const irFileInput = mustQuery<HTMLInputElement>("#ir-file");
const rateValue = mustQuery<HTMLSpanElement>("#rate-value");
const blendValue = mustQuery<HTMLSpanElement>("#blend-value");
const chopperThresholdValue = mustQuery<HTMLSpanElement>("#chopper-threshold-value");
const freqShiftHzValue = mustQuery<HTMLSpanElement>("#freq-shift-hz-value");
const freqShiftFeedbackValue = mustQuery<HTMLSpanElement>("#freqshift-feedback-value");
const sampleFileName = mustQuery<HTMLSpanElement>("#sample-file-name");
const irFileName = mustQuery<HTMLSpanElement>("#ir-file-name");
const toggleIrButton = mustQuery<HTMLButtonElement>("#toggle-ir");
const resourceStatus = mustQuery<HTMLDivElement>("#resource-status");
const status = mustQuery<HTMLDivElement>("#status");

updateIrToggleLabel();

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;
let sampleLoaded = false;
let isStopped = false;
let freqShiftFiveHzScale = false;

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function updateIrToggleLabel() {
    if (irChannelPaths.length < 2) {
        toggleIrButton.disabled = true;
        toggleIrButton.textContent = "IR pair unavailable";
        return;
    }

    toggleIrButton.disabled = irChannelPaths.length < 4;
    toggleIrButton.textContent = activeIrPairStart === 0 ? "Use IR pair 1/2" : "Use IR pair 3/4";
}

async function updateBlend() {
    const blend = Number(blendSlider.value) ;
    blendValue.textContent = `${Math.round(blend * 100)}%`;

    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateIrStart() {
    irStartValue.textContent = `${(Number(irStart.value).toFixed(0))}%`;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateIrEnd() {
    irEndValue.textContent = `${(Number(irEnd.value).toFixed(0))}%`;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateIrRate() {
    irRateValue.textContent = `${Number(irRate.value).toFixed(2)}x`;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateIrAttenuation() {
    irAttenuationValue.textContent = `${Number(irAttenuation.value).toFixed(0)} dB`;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateIrNormalize() {
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateConvolverMode() {
    convolverModeValue.textContent = convolverModeSelect.value;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateSpectralTilt() {
    spectralTiltValue.textContent = `${Number(spectralTiltSlider.value)} dB/oct`;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateSpectralBlur() {
    spectralBlurValue.textContent = `${Number(spectralBlurSlider.value)}%`;
    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateChopperThreshold() {
    chopperThresholdValue.textContent = Number(chopperThresholdSlider.value).toFixed(2);

    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function updateFreqShiftHz() {
    freqShiftHzValue.textContent = `${Math.round(getFreqShiftHz())} Hz`;

    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

function getFreqShiftHz() {
    return Number(freqShiftHzSlider.value);
}

function setFreqShiftSliderFromHz(hz: number) {
    const limit = freqShiftFiveHzScale ? 6 : 600;
    const clamped = Math.max(-limit, Math.min(limit, hz));
    freqShiftHzSlider.value = String(clamped);
}

function configureFreqShiftSlider(rescaleCurrentHz = true) {
    const currentHz = getFreqShiftHz();
    if (freqShiftFiveHzScale) {
        freqShiftHzSlider.min = "-6";
        freqShiftHzSlider.max = "6";
        freqShiftHzSlider.step = "0.001";
        freqShiftZoomButton.textContent = "x100";
        if (rescaleCurrentHz) {
            setFreqShiftSliderFromHz(currentHz * 0.01);
        }
    } else {
        freqShiftHzSlider.min = "-600";
        freqShiftHzSlider.max = "600";
        freqShiftHzSlider.step = "0.1";
        freqShiftZoomButton.textContent = "x0.01";
        if (rescaleCurrentHz) {
            setFreqShiftSliderFromHz(currentHz * 100);
        }
    }
}

async function updateFreqShiftFeedback() {
    freqShiftFeedbackValue.textContent = `${Number(freqShiftFeedbackSlider.value)}%`;

    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
}

async function loadBundledResources() {
    if (!audioContext || !renderer) {
        return;
    }

    const [sampleResponse, irResponse] = await Promise.all([fetch(sampleUrl), fetch(irUrl)]);

    if (!sampleResponse.ok) {
        throw new Error(`Failed to fetch sample: ${sampleResponse.status} ${sampleResponse.statusText}`);
    }

    if (!irResponse.ok) {
        throw new Error(`Failed to fetch IR: ${irResponse.status} ${irResponse.statusText}`);
    }

    const [sampleBytes, irBytes] = await Promise.all([sampleResponse.arrayBuffer(), irResponse.arrayBuffer()]);
    const [sampleBuffer, irBuffer] = await Promise.all([
        audioContext.decodeAudioData(sampleBytes),
        audioContext.decodeAudioData(irBytes)
    ]);

    sampleChannels = sampleBuffer.numberOfChannels;
    const sampleData = sampleBuffer.numberOfChannels > 1
        ? Array.from({length: sampleBuffer.numberOfChannels}, (_, index) =>
            new Float32Array(sampleBuffer.getChannelData(index))
        )
        : new Float32Array(sampleBuffer.getChannelData(0));

    const irData = Array.from({length: irBuffer.numberOfChannels}, (_, index) =>
        new Float32Array(irBuffer.getChannelData(index))
    );

    irChannelPaths = irData.map((_, index) => `${bundledIrBasePath}_ch${index + 1}.wav`);

    const vfs: Record<string, Float32Array | Float32Array[]> = {
        [samplePath]: sampleData
    };

    irChannelPaths.forEach((path, index) => {
        vfs[path] = irData[index];
    });

    await renderer.updateVirtualFileSystem(vfs);

    sampleLoaded = true;
    activeIrPairStart = 0;
    updateIrToggleLabel();
    resourceStatus.textContent = `Loaded ${samplePath} and ${irChannelPaths.length} IR channels (${sampleBuffer.numberOfChannels} ch + ${irBuffer.numberOfChannels} ch @ ${sampleBuffer.sampleRate} Hz)`;
}

async function loadBrowserSample(file: File) {
    if (!audioContext || !renderer) {
        return;
    }

    const bytes = await file.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(bytes);

    samplePath = `browser/${file.name}`;
    sampleFileName.textContent = file.name;
    sampleChannels = buffer.numberOfChannels;

    const sampleData = buffer.numberOfChannels > 1
        ? Array.from({length: buffer.numberOfChannels}, (_, index) =>
            new Float32Array(buffer.getChannelData(index))
        )
        : new Float32Array(buffer.getChannelData(0));

    await renderer.updateVirtualFileSystem({
        [samplePath]: sampleData
    });

    sampleLoaded = true;
    resourceStatus.textContent = `Loaded ${file.name} from the browser (${buffer.numberOfChannels} ch @ ${buffer.sampleRate} Hz)`;
}

function activeIrTargetPaths(): [string, string] {
    const left = irChannelPaths[activeIrPairStart] ?? `${bundledIrBasePath}_ch1.wav`;
    const right = irChannelPaths[activeIrPairStart + 1] ?? left;
    return [left, right];
}

async function loadBrowserIr(file: File) {
    if (!audioContext || !renderer) {
        return;
    }

    const bytes = await file.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(bytes);
    const [leftPath, rightPath] = activeIrTargetPaths();
    const vfs: Record<string, Float32Array | Float32Array[]> = {};

    const leftData = new Float32Array(buffer.getChannelData(0));
    vfs[leftPath] = leftData;

    if (buffer.numberOfChannels > 1 && rightPath !== leftPath) {
        vfs[rightPath] = new Float32Array(buffer.getChannelData(1));
    } else if (rightPath !== leftPath) {
        vfs[rightPath] = leftData;
    }

    await renderer.updateVirtualFileSystem(vfs);
    irFileName.textContent = file.name;
    resourceStatus.textContent = `Overwrote active IR slot(s) with ${file.name} (${buffer.numberOfChannels} ch @ ${buffer.sampleRate} Hz)`;
}

function buildGraph(rate: number): NodeRepr_t[] {
    const [leftIrPath, rightIrPath] = activeIrTargetPaths();

    return dspBuildGraph({
        samplePath,
        rate,
        blend: Number(blendSlider.value) / 100,
        irRate: Number(irRate.value),
        irAttenuationDb: Number(irAttenuation.value),
        irNormalize: irNormalize.checked,
        convolverMode: convolverModeSelect.value as "static" | "spectral",
        spectralTiltDbPerOct: Number(spectralTiltSlider.value),
        spectralBlur: Number(spectralBlurSlider.value) / 100,
        chopperThreshold: Number(chopperThresholdSlider.value),
        freqShiftHz: getFreqShiftHz(),
        feedback: Number(freqShiftFeedbackSlider.value) / 100,
        leftIrPath,
        rightIrPath,
        isStopped,
        irStart: Number(irStart.value) / 100,
        irEnd: Number(irEnd.value) / 100

    });
}

configureFreqShiftSlider(false);

async function ensureAudio() {
    if (audioContext && renderer) {
        return;
    }

    audioContext = new AudioContext();
    renderer = new WebRenderer();

    const worklet = await renderer.initialize(audioContext);
    worklet.connect(audioContext.destination);

    await loadBundledResources();
}

async function renderCurrentGraph() {
    if (!renderer) {
        return;
    }

    const rate = Number(rateSlider.value);
    rateValue.textContent = `${rate.toFixed(2)}x`;
    status.textContent = JSON.stringify( await renderer.render(...buildGraph(rate)));
}

startButton.addEventListener("click", async () => {
    isStopped = false;
    startButton.disabled = true;
    status.textContent = "Starting audio...";

    try {
        await ensureAudio();
        await audioContext?.resume();
        await renderCurrentGraph();
        stopButton.disabled = false;
    } catch (error) {
        status.textContent = `Failed to start audio: ${formatError(error)}`;
        startButton.disabled = false;
    }
});

stopButton.addEventListener("click", async () => {
    if (!renderer || !audioContext) return;

    isStopped = true;
    status.textContent = "Stopping audio...";
    stopButton.disabled = true;

    // Render silence with a short fade-out
    await renderer.renderWithOptions(
        {rootFadeInMs: 0, rootFadeOutMs: 100},
        ...[el.const({value: 0}), el.const({value: 0})]
    );

    // Give it a moment to fade out before suspending
    await new Promise((resolve) => setTimeout(resolve, 120));
    await audioContext.suspend();

    status.textContent = "Audio stopped";
    startButton.disabled = false;
});

reloadButton.addEventListener("click", async () => {
    try {
        await ensureAudio();
        samplePath = bundledSamplePath;
        sampleChannels = 1;
        irChannelPaths = [];
        activeIrPairStart = 0;
        sampleFileName.textContent = "Built-in sample";
        await loadBundledResources();
        await renderCurrentGraph();
    } catch (error) {
        status.textContent = `Failed to reload sample: ${formatError(error)}`;
    }
});

toggleIrButton.addEventListener("click", async () => {
    if (irChannelPaths.length < 4) {
        return;
    }

    activeIrPairStart = activeIrPairStart === 0 ? 2 : 0;
    updateIrToggleLabel();

    if (renderer && audioContext?.state === "running") {
        await renderCurrentGraph();
    }
});

sampleFileInput.addEventListener("change", async () => {
    const file = sampleFileInput.files?.[0];

    if (!file) {
        return;
    }

    try {
        await ensureAudio();
        await loadBrowserSample(file);
        await renderCurrentGraph();
    } catch (error) {
        status.textContent = `Failed to load browser file: ${formatError(error)}`;
    }
});

irFileInput.addEventListener("change", async () => {
    const file = irFileInput.files?.[0];

    if (!file) {
        return;
    }

    try {
        await ensureAudio();
        await loadBrowserIr(file);
         await renderCurrentGraph();
    } catch (error) {
        status.textContent = `Failed to load browser IR: ${formatError(error)}`;
    }
});

rateSlider.addEventListener("input", () => {
    rateValue.textContent = `${Number(rateSlider.value).toFixed(2)}x`;
    if (renderer && audioContext?.state === "running") {
        void renderCurrentGraph();
    }
});

blendSlider.addEventListener("input", () => {
    void updateBlend();
});

irStart.addEventListener("input", () => {
    void updateIrStart();
})

irEnd.addEventListener("input", () => {
    void updateIrEnd();
})

irRate.addEventListener("input", () => {
    void updateIrRate();
});

irAttenuation.addEventListener("input", () => {
    void updateIrAttenuation();
});

irNormalize.addEventListener("change", () => {
    void updateIrNormalize();
});

convolverModeSelect.addEventListener("input", () => {
    void updateConvolverMode();
});

convolverModeSelect.addEventListener("change", () => {
    void updateConvolverMode();
});

spectralTiltSlider.addEventListener("input", () => {
    void updateSpectralTilt();
});

spectralBlurSlider.addEventListener("input", () => {
    void updateSpectralBlur();
});

chopperThresholdSlider.addEventListener("input", () => {

    void updateChopperThreshold();
});

freqShiftHzSlider.addEventListener("input", () => {

    void updateFreqShiftHz();
});

freqShiftZoomButton.addEventListener("click", () => {
    freqShiftFiveHzScale = !freqShiftFiveHzScale;
    configureFreqShiftSlider();

    void updateFreqShiftHz();
});

freqShiftFeedbackSlider.addEventListener("input", () => {

    void updateFreqShiftFeedback();
});

rateValue.textContent = `${Number(rateSlider.value).toFixed(2)}x`;
blendValue.textContent = `${Math.round((Number(blendSlider.value) / 100) * 100)}%`;
irRateValue.textContent = `${Number(irRate.value).toFixed(2)}x`;
irAttenuationValue.textContent = `${Number(irAttenuation.value).toFixed(0)} dB`;
convolverModeValue.textContent = convolverModeSelect.value;
spectralTiltValue.textContent = `${Number(spectralTiltSlider.value)} dB/oct`;
spectralBlurValue.textContent = `${Number(spectralBlurSlider.value)}%`;
chopperThresholdValue.textContent = Number(chopperThresholdSlider.value).toFixed(2);
freqShiftHzValue.textContent = `${Math.round(getFreqShiftHz())} Hz`;
void updateFreqShiftFeedback();
