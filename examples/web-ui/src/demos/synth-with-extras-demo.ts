/**
 * elemaudio-rs synth + extras demo
 *
 * Arp synth with crunch distortion, stride delay, and stereo limiter.
 */

import type { StrideDelayMode } from "@elem-rs/core/extra";
import { buildGraph as dspBuildGraph } from "../demo-dsp/synth-demo.dsp";
import { initDemo } from "./demo-harness";

// ---- layout -----------------------------------------------------------

const layout = `
  <div class="panel">
    <h1>Synth + Extras</h1>
    <p>Click start to open the browser audio engine, build a JS graph, and stream it into the runtime.</p>
    <div class="controls">
      <button id="start" class="start-button">Start audio</button>
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
        <label for="drive-limiter">
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
          <label for="delay-transition">
            <span>Transition</span>
            <span id="delay-transition-value">20 ms</span>
          </label>
          <input id="delay-transition" type="range" min="1" max="250" value="20" step="1" />
        </div>
        <div class="dial">
          <label for="delay-method">
            <span>Mode</span>
            <span id="delay-method-value">dualStride</span>
          </label>
          <input id="delay-method" type="range" min="0" max="2" value="1" step="1" />
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
      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

// ---- init + bindings --------------------------------------------------

let frequencySlider: HTMLInputElement;
let frequencyValue: HTMLSpanElement;
let driveLimiterSlider: HTMLInputElement;
let driveLimiterValue: HTMLSpanElement;
let delayTimeSlider: HTMLInputElement;
let delayTimeValue: HTMLSpanElement;
let delayFeedbackSlider: HTMLInputElement;
let delayFeedbackValue: HTMLSpanElement;
let delayTransitionSlider: HTMLInputElement;
let delayTransitionValue: HTMLSpanElement;
let delayMethodSlider: HTMLInputElement;
let delayMethodValue: HTMLSpanElement;
let limiterEnable: HTMLInputElement;
let crunchDriveSlider: HTMLInputElement;
let crunchDriveValue: HTMLSpanElement;
let crunchFuzzSlider: HTMLInputElement;
let crunchFuzzValue: HTMLSpanElement;
let crunchToneSlider: HTMLInputElement;
let crunchToneValue: HTMLSpanElement;
let crunchCutSlider: HTMLInputElement;
let crunchCutValue: HTMLSpanElement;
let crunchOutSlider: HTMLInputElement;
let crunchOutValue: HTMLSpanElement;
let crunchEnable: HTMLInputElement;

const { mustQuery: q, wireControls } = initDemo({
  layout,
  buildGraph: () => dspBuildGraph({
    frequency: Number(frequencySlider.value),
    limiterEnabled: limiterEnable.checked,
    limiterDrive: Number(driveLimiterSlider.value),
    crunchEnabled: crunchEnable.checked,
    crunchDrive: Number(crunchDriveSlider.value),
    crunchFuzz: Number(crunchFuzzSlider.value) / 100,
    crunchToneHz: Number(crunchToneSlider.value),
    crunchCutHz: Number(crunchCutSlider.value),
    crunchOutGain: Number(crunchOutSlider.value),
    delayTimeMs: Number(delayTimeSlider.value),
    delayFeedback: Number(delayFeedbackSlider.value) / 100,
    delayTransitionMs: Number(delayTransitionSlider.value),
    delayMode: (["linear", "dualStride", "step"] as const)[Number(delayMethodSlider.value)] as StrideDelayMode,
  }),
  updateReadouts,
  renderOptions: { rootFadeInMs: 250, rootFadeOutMs: 250 },
});

frequencySlider = q<HTMLInputElement>("#frequency");
frequencyValue = q<HTMLSpanElement>("#frequency-value");
driveLimiterSlider = q<HTMLInputElement>("#drive-limiter");
driveLimiterValue = q<HTMLSpanElement>("#drive-limiter-value");
delayTimeSlider = q<HTMLInputElement>("#delay-time");
delayTimeValue = q<HTMLSpanElement>("#delay-time-value");
delayFeedbackSlider = q<HTMLInputElement>("#delay-feedback");
delayFeedbackValue = q<HTMLSpanElement>("#delay-feedback-value");
delayTransitionSlider = q<HTMLInputElement>("#delay-transition");
delayTransitionValue = q<HTMLSpanElement>("#delay-transition-value");
delayMethodSlider = q<HTMLInputElement>("#delay-method");
delayMethodValue = q<HTMLSpanElement>("#delay-method-value");
limiterEnable = q<HTMLInputElement>("#limiter-enable");
crunchDriveSlider = q<HTMLInputElement>("#crunch-drive");
crunchDriveValue = q<HTMLSpanElement>("#crunch-drive-value");
crunchFuzzSlider = q<HTMLInputElement>("#crunch-fuzz");
crunchFuzzValue = q<HTMLSpanElement>("#crunch-fuzz-value");
crunchToneSlider = q<HTMLInputElement>("#crunch-tone");
crunchToneValue = q<HTMLSpanElement>("#crunch-tone-value");
crunchCutSlider = q<HTMLInputElement>("#crunch-cut");
crunchCutValue = q<HTMLSpanElement>("#crunch-cut-value");
crunchOutSlider = q<HTMLInputElement>("#crunch-out");
crunchOutValue = q<HTMLSpanElement>("#crunch-out-value");
crunchEnable = q<HTMLInputElement>("#crunch-enable");

wireControls([
  frequencySlider, driveLimiterSlider, limiterEnable,
  delayTimeSlider, delayFeedbackSlider, delayTransitionSlider, delayMethodSlider,
  crunchDriveSlider, crunchFuzzSlider, crunchToneSlider, crunchCutSlider, crunchOutSlider, crunchEnable,
]);

function updateReadouts() {
  frequencyValue.textContent = `${Number(frequencySlider.value)} Hz`;
  crunchDriveValue.textContent = `${Number(crunchDriveSlider.value).toFixed(1)}x`;
  crunchFuzzValue.textContent = `${Number(crunchFuzzSlider.value)}%`;
  crunchToneValue.textContent = `${Number(crunchToneSlider.value)} Hz`;
  crunchCutValue.textContent = `${Number(crunchCutSlider.value)} Hz`;
  crunchOutValue.textContent = `${Number(crunchOutSlider.value).toFixed(2)}x`;
  driveLimiterValue.textContent = `${Number(driveLimiterSlider.value).toFixed(1)}x`;
  delayTimeValue.textContent = `${Number(delayTimeSlider.value)} ms`;
  delayFeedbackValue.textContent = `${Number(delayFeedbackSlider.value)}%`;
  delayTransitionValue.textContent = `${Number(delayTransitionSlider.value)} ms`;
  delayMethodValue.textContent =
    ["linear", "dualStride", "step"][Number(delayMethodSlider.value)] ?? "dualStride";
}

updateReadouts();
