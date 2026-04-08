import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import {StrideDelayFallbackMode} from "@elem-rs/core/extra";
import {time} from "@elem-rs/core/vendor-core";
import WebRenderer from "./WebRenderer";
import "./style.css";

///🧩 DSP ////////////////////////////////////////////////
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

let strideDelay = (vn: number = 1, x: NodeRepr_t ) =>
    el.extra.strideDelay( {
        key: "stride-delay-" + vn,
        fallback: delayFallbackSlider.value as StrideDelayFallbackMode,
        fb: Number(delayFeedbackSlider.value) / 100,
        delayMs: Number(delayTimeSlider.value),
        strideMs: Number(delayStrideSlider.value),
        transitionMs: Number(delayTransitionSlider.value),
        maxJumpMs: Number(delayJumpSlider.value),
        maxDelayMs: 1000,
    }, x);

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
    // When the toggle is off, the next render omits the crunch node entirely.
    // That makes it unreachable from the new root set and eligible for runtime GC.
    if (!crunchEnable.checked) {
        return input;
    }
    // Key the node so the runtime can keep its identity stable while the effect
    // is active, then fully remove it when the toggle goes off.
    return el.extra.crunch({
        key,
        channels: 1,
        drive: Number(crunchDriveSlider.value),
        fuzz: Number(crunchFuzzSlider.value) / 100,
        toneHz: Number(crunchToneSlider.value),
        cutHz: Number(crunchCutSlider.value),
        outGain: Number(crunchOutSlider.value),
        autoGain: true
    }, input)[0];
};

/// Now we wire up the "modules" defined above to form a graph
/// and return the root nodes of the graph, a stereo limiter
//  around the full synth output.
function buildGraph(f: number): NodeRepr_t[] {
    const crunchyVoicesPreFX = [
        crunchBranch("crunch:0", synth_out(f)[0]),
        crunchBranch("crunch:1", synth_out(f)[1])
    ];

    const voiceWithFx = [
        strideDelay(1, crunchyVoicesPreFX[0]),
        strideDelay(2, crunchyVoicesPreFX[1]),
    ]

    const inputGain = Number(driveLimiterSlider.value);
    if (!limiterEnable.checked) {
        return voiceWithFx;
    }
    return el.extra.stereoLimiter({key: "stereo-limiter", inputGain}, voiceWithFx[0], voiceWithFx[1]);
}
/// and this is the main renderer call, where dsp params
///  will be dynamically changed at runtime by a standard HTML slider input element.

async function renderCurrentGraph() {
    if (!renderer || !frequencyValue || !status) {
        return;
    }
    // Render the graph and use the renderer's built-in root fades so graph transitions stay smooth.
    let msg = await renderer
        .renderWithOptions(
            {
                rootFadeInMs: 250,
                rootFadeOutMs: 250
            }, ...buildGraph(Number(frequencySlider?.value)));

    updateSliderValues();

    console.log("Renderer info: ", msg);
}


///////////////////////////////////////////////////
//== DOM, Audio and reactivity support from here on
const app = document.querySelector<HTMLDivElement>("#app");
const sampleDemoHref = "/sample.html";
const resourceManagerHref = "/resource-manager.html";

if (!app) {
    throw new Error("Missing app root");
}

function mustQuery<T extends Element>(app: HTMLDivElement, selector: string): T {
    const element = app.querySelector<T>(selector);

    if (!element) {
        throw new Error(`Missing control: ${selector}`);
    }

    return element;
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
      <div class="row toggle-row">
        <label class="toggle-label" for="limiter-enable">
          <span>Enable Limiter</span>
        </label>
        <input id="limiter-enable" class="toggle-input" type="checkbox" checked />
      </div>
      <div class="row">
        <label  for="drive-limiter">
      <span>Drive limiter</span>
      <span id="drive-limiter-value">8.0x</span>
    </label>
    <input id="drive-limiter" type="range" min="1" max="8" value="1" step="0.1" />
</div>
      <hr style="width: 100%; opacity: 0.125"/>
      <div class="dial-strip" aria-label="Stride delay controls">
        <div class="dial">
          <label for="delay-time">
            <span>Delay</span>
            <span id="delay-time-value">250 ms</span>
          </label>
          <input id="delay-time" type="range" min="10" max="1200" value="250" step="1" />
        </div>
        <div class="dial">
          <label for="delay-feedback">
            <span>Feedback</span>
            <span id="delay-feedback-value">0%</span>
          </label>
          <input id="delay-feedback" type="range" min="0" max="95" value="0" step="1" />
        </div>
        <div class="dial">
          <label for="delay-stride">
            <span>Stride</span>
            <span id="delay-stride-value">8 ms</span>
          </label>
          <input id="delay-stride" type="range" min="1" max="64" value="8" step="1" />
        </div>
        <div class="dial">
          <label for="delay-transition">
            <span>Transition</span>
            <span id="delay-transition-value">20 ms</span>
          </label>
          <input id="delay-transition" type="range" min="1" max="250" value="20" step="1" />
        </div>
      </div>
      <div class="dial-strip">
        <div class="dial">
          <label for="delay-jump">
            <span>Max jump</span>
            <span id="delay-jump-value">50 ms</span>
          </label>
          <input id="delay-jump" type="range" min="1" max="250" value="50" step="1" />
        </div>
        <div class="dial">
          <label for="delay-fallback">
            <span>Fallback</span>
            <span id="delay-fallback-value">dualStrideCrossfade</span>
          </label>
          <input id="delay-fallback" type="range" min="0" max="2" value="1" step="1" />
        </div>
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
      <div class="row toggle-row">
        <label class="toggle-label" for="crunch-enable">
          <span>Enable crunch</span>
        </label>
        <input id="crunch-enable" class="toggle-input" type="checkbox" checked />
      </div>
      <hr style="width: 100%; opacity: 0.125"/>
      <button id="start">Start audio</button>
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;


const startButton = mustQuery<HTMLButtonElement>(app, "#start");
const frequencySlider = mustQuery<HTMLInputElement>(app, "#frequency");
const frequencyValue = mustQuery<HTMLSpanElement>(app, "#frequency-value");
const driveLimiterSlider = mustQuery<HTMLInputElement>(app, "#drive-limiter");
const driveLimiterValue = mustQuery<HTMLSpanElement>(app, "#drive-limiter-value");
const delayTimeSlider = mustQuery<HTMLInputElement>(app, "#delay-time");
const delayTimeValue = mustQuery<HTMLSpanElement>(app, "#delay-time-value");
const delayFeedbackSlider = mustQuery<HTMLInputElement>(app, "#delay-feedback");
const delayFeedbackValue = mustQuery<HTMLSpanElement>(app, "#delay-feedback-value");
const delayStrideSlider = mustQuery<HTMLInputElement>(app, "#delay-stride");
const delayStrideValue = mustQuery<HTMLSpanElement>(app, "#delay-stride-value");
const delayTransitionSlider = mustQuery<HTMLInputElement>(app, "#delay-transition");
const delayTransitionValue = mustQuery<HTMLSpanElement>(app, "#delay-transition-value");
const delayJumpSlider = mustQuery<HTMLInputElement>(app, "#delay-jump");
const delayJumpValue = mustQuery<HTMLSpanElement>(app, "#delay-jump-value");
const delayFallbackSlider = mustQuery<HTMLInputElement>(app, "#delay-fallback");
const delayFallbackValue = mustQuery<HTMLSpanElement>(app, "#delay-fallback-value");
const limiterEnable = mustQuery<HTMLInputElement>(app, "#limiter-enable");
const crunchDriveSlider = mustQuery<HTMLInputElement>(app, "#crunch-drive");
const crunchDriveValue = mustQuery<HTMLSpanElement>(app, "#crunch-drive-value");
const crunchFuzzSlider = mustQuery<HTMLInputElement>(app, "#crunch-fuzz");
const crunchFuzzValue = mustQuery<HTMLSpanElement>(app, "#crunch-fuzz-value");
const crunchToneSlider = mustQuery<HTMLInputElement>(app, "#crunch-tone");
const crunchToneValue = mustQuery<HTMLSpanElement>(app, "#crunch-tone-value");
const crunchCutSlider = mustQuery<HTMLInputElement>(app, "#crunch-cut");
const crunchCutValue = mustQuery<HTMLSpanElement>(app, "#crunch-cut-value");
const crunchOutSlider = mustQuery<HTMLInputElement>(app, "#crunch-out");
const crunchOutValue = mustQuery<HTMLSpanElement>(app, "#crunch-out-value");
const crunchEnable = mustQuery<HTMLInputElement>(app, "#crunch-enable");
const status = mustQuery<HTMLDivElement>(app, "#status");

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;

function updateSliderValues() {
    frequencyValue.textContent = `${Number(frequencySlider?.value)} Hz`;
    crunchDriveValue.textContent = `${Number(crunchDriveSlider.value).toFixed(1)}x`;
    crunchFuzzValue.textContent = `${Number(crunchFuzzSlider.value)}%`;
    crunchToneValue.textContent = `${Number(crunchToneSlider.value)} Hz`;
    crunchCutValue.textContent = `${Number(crunchCutSlider.value)} Hz`;
    crunchOutValue.textContent = `${Number(crunchOutSlider.value).toFixed(2)}x`;
    driveLimiterValue.textContent = `${Number(driveLimiterSlider.value).toFixed(1)}x`;
    delayTimeValue.textContent = `${Number(delayTimeSlider.value)} ms`;
    delayFeedbackValue.textContent = `${Number(delayFeedbackSlider.value)}%`;
    delayStrideValue.textContent = `${Number(delayStrideSlider.value)} ms`;
    delayTransitionValue.textContent = `${Number(delayTransitionSlider.value)} ms`;
    delayJumpValue.textContent = `${Number(delayJumpSlider.value)} ms`;
    delayFallbackValue.textContent = ["linear", "dualStrideCrossfade", "step"][Number(delayFallbackSlider.value)] ?? "dualStrideCrossfade";
}

const controls = [
    crunchDriveSlider,
    crunchFuzzSlider,
    crunchToneSlider,
    crunchCutSlider,
    crunchOutSlider,
    crunchEnable,
    driveLimiterSlider,
    limiterEnable,
    delayTimeSlider,
    delayFeedbackSlider,
    delayStrideSlider,
    delayTransitionSlider,
    delayJumpSlider,
    delayFallbackSlider,
    frequencySlider
];

const resetValues = new Map<HTMLInputElement, string>([
    [frequencySlider, "220"],
    [driveLimiterSlider, "1"],
    [delayTimeSlider, "250"],
    [delayFeedbackSlider, "0"],
    [delayStrideSlider, "8"],
    [delayTransitionSlider, "20"],
    [delayJumpSlider, "50"],
    [delayFallbackSlider, "1"],
    [crunchDriveSlider, "4"],
    [crunchFuzzSlider, "0"],
    [crunchToneSlider, "2000"],
    [crunchCutSlider, "50"],
    [crunchOutSlider, "1"],
]);

const resetChecks = new Map<HTMLInputElement, boolean>([
    [limiterEnable, true],
    [crunchEnable, true],
]);

function resetControl(control: HTMLInputElement) {
    if (control.type === "checkbox") {
        control.checked = resetChecks.get(control) ?? control.checked;
    } else {
        const value = resetValues.get(control);

        if (value !== undefined) {
            control.value = value;
        }
    }

    updateSliderValues();

    if (renderer && audioContext?.state === "running") {
        void renderCurrentGraph();
    }
}

controls.forEach((control) => {
    control.addEventListener("input", () => {
        // Any control change re-renders the graph. When a branch is toggled off the
        // next render should drop that branch, then the runtime GC prunes the unreachable nodes
        if (renderer && audioContext?.state === "running") {
            void renderCurrentGraph();
        }
    });

    control.addEventListener("dblclick", (event) => {
        event.preventDefault();
        resetControl(control);
    });
});


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


async function ensureAudio() {
    if (audioContext && renderer) {
        return;
    }

    audioContext = new AudioContext();
    renderer = new WebRenderer();

    const worklet = await renderer.initialize(audioContext);
    worklet.connect(audioContext.destination);
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
