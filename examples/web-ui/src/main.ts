import { el } from "@elem-rs/core";
import type { NodeRepr_t } from "@elem-rs/core";
import WebRenderer from "./WebRenderer";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

app.innerHTML = `
  <div class="panel">
    <h1>elemaudio-rs demo</h1>
    <p>Click start to open the browser audio engine, build a JS graph, and stream it into the runtime.</p>
    <div class="controls">
      <div class="row">
        <label for="frequency">
          <span>Frequency</span>
          <span id="frequency-value">220 Hz</span>
        </label>
        <input id="frequency" type="range" min="60" max="1200" value="220" step="1" />
      </div>
      <button id="start">Start audio</button>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

const startButton = app.querySelector<HTMLButtonElement>("#start");
const frequencySlider = app.querySelector<HTMLInputElement>("#frequency");
const frequencyValue = app.querySelector<HTMLSpanElement>("#frequency-value");
const status = app.querySelector<HTMLDivElement>("#status");

if (!startButton || !frequencySlider || !frequencyValue || !status) {
  throw new Error("Missing controls");
}

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;

const smoothedCycle = (key: string, value: number): NodeRepr_t => {
    return el.cycle(el.sm(el.const({ key, value })));
}

const hann_LFO_VCA = (  input: NodeRepr_t , value: number = 1.0) => {
    return el.mul( el.hann( el.phasor( el.const( { value } ) ) ), input  )
}


function buildGraph(frequency: number): NodeRepr_t[] {
  return [
      hann_LFO_VCA( smoothedCycle("freqL", frequency) ),
      hann_LFO_VCA( smoothedCycle("freqR", frequency * 1.618), 1.618)
  ];
}

async function ensureAudio() {
  if (audioContext && renderer) {
    return;
  }

  audioContext = new AudioContext();
  renderer = new WebRenderer();

  const worklet = await renderer.initialize(audioContext);
  worklet.connect(audioContext.destination);
}

async function renderCurrentGraph() {
  if (!renderer || !frequencyValue || !status) {
    return;
  }

  const frequency = Number(frequencySlider?.value);
  frequencyValue.textContent = `${frequency} Hz`;
  status.textContent = `Running at ${frequency} Hz`;

  await renderer?.render(...buildGraph(frequency));

}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "Starting audio...";

  try {
    await ensureAudio();
    await audioContext?.resume();
    await renderCurrentGraph();
  } catch (error) {
    status.textContent = `Failed to start audio: ${error instanceof Error ? error.message : String(error)}`;
    startButton.disabled = false;
  }
});

frequencySlider.addEventListener("input", () => {
  const frequency = Number(frequencySlider.value);
  frequencyValue.textContent = `${frequency} Hz`;

  if (renderer && audioContext?.state === "running") {
    void renderCurrentGraph();
  }
});
