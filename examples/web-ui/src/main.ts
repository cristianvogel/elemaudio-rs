import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import WebRenderer from "./WebRenderer";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
const sampleDemoHref = "/sample.html";
const resourceManagerHref = "/resource-manager.html";

if (!app) {
    throw new Error("Missing app root");
}

app.innerHTML = `
  <div class="panel">
    <h1>elemaudio-rs demo</h1>
    <p>Click start to open the browser audio engine, build a JS graph, and stream it into the runtime.</p>
    <p class="demo-link"><a href="${sampleDemoHref}">Open the sample-file demo</a></p>
    <p class="demo-link"><a href="${resourceManagerHref}">Open the Rust resource manager demo</a></p>
    <div class="controls">
      <div class="row">
        <label for="frequency">
          <span>Synth Fc</span>
          <span id="frequency-value">220 Hz</span>
        </label>
        <input id="frequency" type="range" min="60" max="1200" value="220" step="1" />
      </div>
      <hr style="width: 100%; opacity: 0.125"/>
      <div class="row">
      <label  for="drive-limiter">
      <span>Drive limiter</span>
      <span id="drive-limiter-value">8.0x</span>
    </label>
    <input id="drive-limiter" type="range" min="1" max="8" value="1" step="0.1" />
</div>
      <hr style="width: 100%; opacity: 0.125"/>
      <div class="row">
        <label for="crunch-drive">
          <span>Crunch drive</span>
          <span id="crunch-drive-value">4.0x</span>
        </label>
        <input id="crunch-drive" type="range" min="0.5" max="12" value="4" step="0.1" />
      </div>
      <div class="row">
        <label for="crunch-fuzz">
          <span>Crunch fuzz</span>
          <span id="crunch-fuzz-value">0%</span>
        </label>
        <input id="crunch-fuzz" type="range" min="0" max="100" value="0" step="1" />
      </div>
      <div class="row">
        <label for="crunch-tone">
          <span>Crunch tone</span>
          <span id="crunch-tone-value">2000 Hz</span>
        </label>
        <input id="crunch-tone" type="range" min="300" max="8000" value="2000" step="1" />
      </div>
      <div class="row">
        <label for="crunch-cut">
          <span>Crunch cut</span>
          <span id="crunch-cut-value">50 Hz</span>
        </label>
        <input id="crunch-cut" type="range" min="20" max="400" value="50" step="1" />
      </div>
      <div class="row">
        <label for="crunch-out">
          <span>Crunch out</span>
          <span id="crunch-out-value">1.00x</span>
        </label>
        <input id="crunch-out" type="range" min="0.1" max="2.0" value="1" step="0.01" />
      </div>
      <div class="row">
        <label class="toggle-row" for="crunch-enable">
          <span>Enable crunch</span>
        </label>
        <input id="crunch-enable" type="checkbox" checked />
      </div>
      <hr style="width: 100%; opacity: 0.125"/>
      <button id="start">Start audio</button>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

const startButton = mustQuery<HTMLButtonElement>("#start");
const frequencySlider = mustQuery<HTMLInputElement>("#frequency");
const frequencyValue = mustQuery<HTMLSpanElement>("#frequency-value");
const driveLimiterSlider = mustQuery<HTMLInputElement>("#drive-limiter");
const driveLimiterValue = mustQuery<HTMLSpanElement>("#drive-limiter-value");
const crunchDriveSlider = mustQuery<HTMLInputElement>("#crunch-drive");
const crunchDriveValue = mustQuery<HTMLSpanElement>("#crunch-drive-value");
const crunchFuzzSlider = mustQuery<HTMLInputElement>("#crunch-fuzz");
const crunchFuzzValue = mustQuery<HTMLSpanElement>("#crunch-fuzz-value");
const crunchToneSlider = mustQuery<HTMLInputElement>("#crunch-tone");
const crunchToneValue = mustQuery<HTMLSpanElement>("#crunch-tone-value");
const crunchCutSlider = mustQuery<HTMLInputElement>("#crunch-cut");
const crunchCutValue = mustQuery<HTMLSpanElement>("#crunch-cut-value");
const crunchOutSlider = mustQuery<HTMLInputElement>("#crunch-out");
const crunchOutValue = mustQuery<HTMLSpanElement>("#crunch-out-value");
const crunchEnable = mustQuery<HTMLInputElement>("#crunch-enable");
const status = mustQuery<HTMLDivElement>("#status");

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;


///////// DSP ////////////////////////////////////////////////
/// Here we define nodes in the graph, using the `el` utilities.
///=== synth arp demo

let synthVoice = (hz: NodeRepr_t) =>
    el.mul(
        0.25,
        el.add(
            el.blepsaw(el.mul(hz, 1.001)),
            el.blepsquare(el.mul(hz, 0.994)),
            el.cycle(el.mul(hz, 0.5))
        )
    );

let trains = [el.train(8), el.train(6)];
let arp = [0, 4, 7, 11, 12, 11, 4, 7]
    .map((x) => 261.63 * 0.5 * Math.pow(2, x / 12));


let modulate = (x: number, rate: number, amt: number) => el.add(x, el.mul(amt, el.cycle(rate)));
let env = el.adsr(0.01, 0.5, 0, 0.4, trains[0]);
let lpf = (vn: number = 1, f: number, x: NodeRepr_t) =>
    el.lowpass(el.add(el.const({key: "lpf-cutoff-" + vn, value: f}), el.mul(modulate(400, 0.05, 800), env)), 1, x);


let synth_out = (f: number) => [
    el.mul(
        0.25,
        lpf(1, f, synthVoice(el.seq({seq: arp, hold: true, offset: 4}, trains[0], 1)))
    ),
    el.mul(
        0.25,
        lpf(2, f, synthVoice(el.seq({seq: arp, hold: true, offset: 0}, trains[1], 1)))
    )
];


const crunchBranch = (key: string = "crunch-node", input: NodeRepr_t): NodeRepr_t => {
    const drive = Number(crunchDriveSlider.value);
    const fuzz = Number(crunchFuzzSlider.value) / 100;
    const toneHz = Number(crunchToneSlider.value);
    const cutHz = Number(crunchCutSlider.value);
    const outGain = Number(crunchOutSlider.value);
    const enabled = crunchEnable.checked ? 1 : 0;
    // When the toggle is off, the next render omits the crunch node entirely.
    // That makes it unreachable from the new root set and eligible for runtime GC.
    if (!enabled) {
        return input;
    }
    // Key the node so the runtime can keep its identity stable while the effect
    // is active, then fully remove it when the toggle goes off.
    return el.extra.crunch({
        key,
        channels: 1,
        drive,
        fuzz,
        toneHz,
        cutHz,
        outGain,
        autoGain: true
    }, input)[0];
};

/// Now we wire up the "modules" defined above to form a graph.
function buildGraph(f: number): NodeRepr_t[] {
    const voicePair = [
        crunchBranch("crunch:0", synth_out(f)[0]),
        crunchBranch("crunch:1", synth_out(f)[1])
    ];
    const inputGain = Number(driveLimiterSlider.value);
    return el.extra.stereoLimiter({key: "stereo-limiter", inputGain}, voicePair[0], voicePair[1]);
}


//////////////////////////////////////////////
//== Audio and reactivity support from here on
function mustQuery<T extends Element>(selector: string): T {
    const element = app!.querySelector<T>(selector);

    if (!element) {
        throw new Error(`Missing control: ${selector}`);
    }

    return element;
}

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

async function ensureAudio() {
    if (audioContext && renderer) {
        return;
    }

    audioContext = new AudioContext();
    renderer = new WebRenderer();

    const worklet = await renderer.initialize(audioContext);
    worklet.connect(audioContext.destination);
}

/// and this is the main renderer call, where dsp params
///  will be dynamically changed at runtime by a standard HTML slider input element.
async function renderCurrentGraph() {
    if (!renderer || !frequencyValue || !status) {
        return;
    }

    frequencyValue.textContent = `${Number(frequencySlider?.value)} Hz`;
    crunchDriveValue.textContent = `${Number(crunchDriveSlider.value).toFixed(1)}x`;
    crunchFuzzValue.textContent = `${Number(crunchFuzzSlider.value)}%`;
    crunchToneValue.textContent = `${Number(crunchToneSlider.value)} Hz`;
    crunchCutValue.textContent = `${Number(crunchCutSlider.value)} Hz`;
    crunchOutValue.textContent = `${Number(crunchOutSlider.value).toFixed(2)}x`;
    driveLimiterValue.textContent = `${Number(driveLimiterSlider.value).toFixed(1)}x`;

    // Use the renderer's built-in root fades so graph transitions stay smooth.
    let msg = await renderer
        .renderWithOptions(
            {
                rootFadeInMs: 10,
                rootFadeOutMs: 10
            }, ...buildGraph(Number(frequencySlider?.value)));
    console.log("Renderer info: ", msg);
}

startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    status.textContent = "Starting audio...";

    try {
        await ensureAudio();
        await audioContext?.resume();
        await renderCurrentGraph();
    } catch (error) {
        status.textContent = `Failed to start audio: ${formatError(error)}`;
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

driveLimiterSlider.addEventListener("input", () => {
    const driveLimiter = Number(driveLimiterSlider.value);
    driveLimiterValue.textContent = `${driveLimiter.toFixed(1)}x`;

    if (renderer && audioContext?.state === "running") {
        void renderCurrentGraph();
    }
});

[crunchDriveSlider, crunchFuzzSlider, crunchToneSlider, crunchCutSlider, crunchOutSlider, crunchEnable].forEach((control) => {
    control.addEventListener("input", () => {
        // Any control change re-renders the graph. When crunch is toggled off the
        // next render drops that branch, then the runtime GC prunes the unreachable
        // nodes after the fade-out settles.
        if (renderer && audioContext?.state === "running") {
            void renderCurrentGraph();
        }
    });
});
