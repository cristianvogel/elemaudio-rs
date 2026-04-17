/**
 * elemaudio-rs web-ui demo template
 *
 * HOW TO USE
 * ----------
 * 1. Copy this file and the matching `_DEMO_TEMPLATE.html` into the same
 *    directories, renaming both to match the new demo:
 *
 *      cp src/_DEMO_TEMPLATE.ts   src/my-effect-demo.ts
 *      cp _DEMO_TEMPLATE.html     my-effect.html
 *
 * 2. In the new HTML file:
 *    - Update the <title> tag.
 *    - Update the <script> src to point at `./src/my-effect-demo.ts`.
 *
 * 3. In the new TS file:
 *    a) Set DEMO_TITLE and DEMO_DESCRIPTION at the top.
 *    b) Write the DSP graph inside `buildGraph()`.
 *       Use `el.*` and `el.extra.*` helpers. The function must return
 *       a `NodeRepr_t[]` (typically stereo: [left, right]).
 *    c) Add HTML controls inside the `layout` string. Each control needs:
 *       - A unique `id` for the input element.
 *       - A companion `<span id="...-value">` for the readout.
 *    d) Bind each control with `q()` after `initDemo()` returns, and
 *       list them in `controls` so input events trigger re-renders.
 *    e) Fill `updateReadouts()` to sync readout spans.
 *    f) For a scope, uncomment the oscilloscope import, add the
 *       `<elemaudio-oscilloscope>` element to the layout, and pass
 *       an `onScopeEvent` handler in the config.
 *
 * 4. Register the new HTML entrypoint in `vite.config.ts`:
 *
 *      rollupOptions: {
 *        input: {
 *          ...existing entries,
 *          myEffect: resolve(__dirname, "my-effect.html"),
 *        },
 *      },
 *
 * 5. Add a sidebar link in `index.html` under the appropriate group.
 *
 * 6. Run `npm --prefix examples/web-ui run dev` and open the new page.
 *
 * CONTROL PATTERNS
 * ----------------
 * Slider:
 *   HTML:  <input id="x" type="range" min="0" max="1" value="0.5" step="0.01" />
 *   TS:    const xSlider = q<HTMLInputElement>("#x");
 *          // read: Number(xSlider.value)
 *
 * Toggle:
 *   HTML:  <input id="y" class="toggle-input" type="checkbox" checked />
 *   TS:    const yToggle = q<HTMLInputElement>("#y");
 *          // read: yToggle.checked
 *
 * Select:
 *   HTML:  <select id="z"><option value="a">A</option></select>
 *   TS:    const zSelect = q<HTMLSelectElement>("#z");
 *          // read: zSelect.value
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import { initDemo } from "./demo-harness";
// Uncomment and create a matching DSP module in ../demo-dsp/:
// import { buildGraph as dspBuildGraph } from "../demo-dsp/my-effect-demo.dsp";
// Uncomment if the demo needs the oscilloscope web component:
// import "../components/Oscilloscope";

// ---- constants --------------------------------------------------------
const DEMO_TITLE = "demo-name";
const DEMO_DESCRIPTION = "Short description of the demo.";

// ---- layout -----------------------------------------------------------
const layout = `
  <!-- Uncomment for oscilloscope: -->
  <!-- <elemaudio-oscilloscope id="scope"></elemaudio-oscilloscope> -->
  <!-- <div class="scope-title"><p>Scope label</p></div> -->
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>${DEMO_TITLE}</h3>
    <p>${DEMO_DESCRIPTION}</p>
    <div class="controls">
      <div class="button-row">
        <button id="start" class="state-button">Start audio</button>
        <button id="stop" class="state-button">Stop audio</button>
      </div>

      <!-- Add controls here, for example: -->
      <div class="row">
        <label for="param-a">
          <span>Param A</span>
          <span id="param-a-value">0.50</span>
        </label>
        <input id="param-a" type="range" min="0" max="1" value="0.5" step="0.01" />
      </div>

      <div class="status" id="status">Idle</div>
    </div>
  </div>
`;

// ---- DSP --------------------------------------------------------------

let isStopped = false;

function buildGraph(): NodeRepr_t[] {
  if (isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }
  // Replace with the actual graph composition.
  const tone = el.cycle(el.const({ key: `${DEMO_TITLE}:freq`, value: 220 }));
  return [el.mul(0.25, tone), el.mul(0.25, tone)];
}

// ---- init + bindings --------------------------------------------------

const { mustQuery: q, wireControls, renderCurrentGraph } = initDemo({
  layout,
  buildGraph,
  updateReadouts,
  // Uncomment for scope event wiring:
  // onScopeEvent: (event: any) => {
  //   if (event.source === "demo-scope") {
  //     const block = event.data?.[0];
  //     if (block) oscilloscope.data = Array.from(block as Float32Array);
  //   }
  // },
});

const paramASlider = q<HTMLInputElement>("#param-a");
const paramAValue = q<HTMLSpanElement>("#param-a-value");
const stopButton = q<HTMLButtonElement>("#stop");
// const oscilloscope = q<any>("elemaudio-oscilloscope");

const startButton = q<HTMLButtonElement>("#start");
startButton.addEventListener("click", () => {
  isStopped = false;
});

wireControls([paramASlider]);

stopButton.addEventListener("click", async () => {
  isStopped = true;
  await renderCurrentGraph();
});

function updateReadouts() {
  paramAValue.textContent = Number(paramASlider.value).toFixed(2);
}
