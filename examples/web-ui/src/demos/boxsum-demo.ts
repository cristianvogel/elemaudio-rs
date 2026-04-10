/**
 * elemaudio-rs box-sum modulation demo
 *
 * Uses el.extra.boxSum / el.extra.boxAverage to smooth white noise
 * and modulate oscillator frequency.
 */

import { buildGraph as dspBuildGraph, SCOPE_NAME } from "../demo-dsp/boxsum-demo.dsp";
import { initDemo } from "./demo-harness";
import { el } from "@elem-rs/core";
import "../components/Oscilloscope";

// ---- layout -----------------------------------------------------------

const layout = `
  <elemaudio-oscilloscope id="scope"></elemaudio-oscilloscope>
  <div class="scope-title"><p>Modulation Signal</p></div>
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>box-sum modulation demo</h3>
    <p>Uses <code>el.extra.boxSum(window, x)</code> or <code>el.extra.boxAverage(window, x)</code> with a keyed window node to smooth white noise and modulate oscillator frequency.</p>
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
        <label for="boxsum-attenuation">
          <span>Boxsum atten</span>
          <span id="boxsum-attenuation-value">0.010</span>
        </label>
        <input id="boxsum-attenuation" type="range" min="0.001" max="0.1" value="0.01" step="0.001" />
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

// ---- init + bindings --------------------------------------------------

let modeSelect: HTMLSelectElement;
let modeValue: HTMLSpanElement;
let windowLengthSlider: HTMLInputElement;
let windowHzValue: HTMLSpanElement;
let boxModRangeSlider: HTMLInputElement;
let boxModRangeValue: HTMLSpanElement;
let boxsumAttenuationSlider: HTMLInputElement;
let boxsumAttenuationValue: HTMLSpanElement;
let toneHzSlider: HTMLInputElement;
let toneHzValue: HTMLSpanElement;
let oscilloscope: any;

const { mustQuery: q, wireControls } = initDemo({
  layout,
  buildGraph: () => dspBuildGraph({
    mode: modeSelect.value as "sum" | "average",
    windowLength: el.const({ key: "boxsum:windowLength", value: Number(windowLengthSlider.value) }),
    toneHz: Number(toneHzSlider.value),
    modRange: Number(boxModRangeSlider.value),
    attenuation: Number(boxsumAttenuationSlider.value),
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

modeSelect = q<HTMLSelectElement>("#mode-select");
modeValue = q<HTMLSpanElement>("#mode-value");
windowLengthSlider = q<HTMLInputElement>("#window-hz");
windowHzValue = q<HTMLSpanElement>("#window-hz-value");
boxModRangeSlider = q<HTMLInputElement>("#box-range");
boxModRangeValue = q<HTMLSpanElement>("#box-range-value");
boxsumAttenuationSlider = q<HTMLInputElement>("#boxsum-attenuation");
boxsumAttenuationValue = q<HTMLSpanElement>("#boxsum-attenuation-value");
toneHzSlider = q<HTMLInputElement>("#tone-hz");
toneHzValue = q<HTMLSpanElement>("#tone-hz-value");
oscilloscope = q<any>("elemaudio-oscilloscope");

wireControls([modeSelect, windowLengthSlider, boxModRangeSlider, boxsumAttenuationSlider, toneHzSlider]);

function updateReadouts() {
  modeValue.textContent = modeSelect.value;
  windowHzValue.textContent = `${Number(windowLengthSlider.value)}`;
  toneHzValue.textContent = `${Number(toneHzSlider.value)} Hz`;
  boxModRangeValue.textContent = `x${Number(boxModRangeSlider.value)}`;
  boxsumAttenuationValue.textContent = `${Number(boxsumAttenuationSlider.value).toFixed(3)}`;
}

updateReadouts();
