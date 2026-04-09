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
 *    c) Add HTML controls inside `app.innerHTML`. Each control needs:
 *       - A unique `id` for the input element.
 *       - A companion `<span id="...-value">` for the readout.
 *    d) Bind each control with `mustQuery` and add it to the
 *       `controls` array so input events trigger re-renders.
 *    e) Update `updateSliderValues()` to sync readouts.
 *    f) If the demo needs a scope, uncomment the oscilloscope import,
 *       the `<elemaudio-oscilloscope>` element in the HTML, the
 *       `oscilloscope` binding, and the `renderer.on("scope", ...)`
 *       handler in `ensureAudio()`.
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
 * 5. Add a navigation link from the main demo page if desired.
 *
 * 6. Run `npm --prefix examples/web-ui run dev` and open the new page.
 *
 * CONTROL PATTERNS
 * ----------------
 * Slider:
 *   HTML:  <input id="x" type="range" min="0" max="1" value="0.5" step="0.01" />
 *   TS:    const xSlider = mustQuery<HTMLInputElement>("#x");
 *          // read: Number(xSlider.value)
 *
 * Toggle:
 *   HTML:  <input id="y" class="toggle-input" type="checkbox" checked />
 *   TS:    const yToggle = mustQuery<HTMLInputElement>("#y");
 *          // read: yToggle.checked
 *
 * Select:
 *   HTML:  <select id="z"><option value="a">A</option></select>
 *   TS:    const zSelect = mustQuery<HTMLSelectElement>("#z");
 *          // read: zSelect.value
 */

import type { NodeRepr_t } from "@elem-rs/core";
import { el } from "@elem-rs/core";
import WebRenderer from "./WebRenderer";
import "./style.css";
// Uncomment if the demo needs the oscilloscope web component:
// import "./components/Oscilloscope";

// ---- constants --------------------------------------------------------
const DEMO_TITLE = "demo-name";
const DEMO_DESCRIPTION = "Short description of the demo.";
const BACK_LINK = "../index.html";

// ---- DSP --------------------------------------------------------------

function buildGraph(): NodeRepr_t[] {
  // Replace with the actual graph composition.
  const tone = el.cycle(el.const({ key: `${DEMO_TITLE}:freq`, value: 220 }));
  return [el.mul(0.25, tone), el.mul(0.25, tone)];
}

async function renderCurrentGraph() {
  if (!renderer || !audioContext) return;
  await audioContext.resume();
  const result = await renderer.render(...buildGraph());
  updateSliderValues();
  status.textContent = JSON.stringify(result);
}

// ---- DOM ---------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");
const root = app;

function mustQuery<T extends Element>(selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing control: ${selector}`);
  return el;
}

app.innerHTML = `
  <!-- Uncomment for oscilloscope: -->
  <!-- <elemaudio-oscilloscope id="scope"></elemaudio-oscilloscope> -->
  <!-- <div class="scope-title"><p>Scope label</p></div> -->
  <div class="panel">
    <h1>elemaudio-rs</h1>
    <h3>${DEMO_TITLE}</h3>
    <p>${DEMO_DESCRIPTION}</p>
    <p class="demo-link"><a href="${BACK_LINK}">Back</a></p>
    <div class="controls">
      <button id="start" class="start-button">Start audio</button>

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

// ---- control bindings --------------------------------------------------

const startButton = mustQuery<HTMLButtonElement>("#start");
const paramASlider = mustQuery<HTMLInputElement>("#param-a");
const paramAValue = mustQuery<HTMLSpanElement>("#param-a-value");
const status = mustQuery<HTMLDivElement>("#status");
// const oscilloscope = mustQuery<any>("elemaudio-oscilloscope");

let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;

function updateSliderValues() {
  paramAValue.textContent = Number(paramASlider.value).toFixed(2);
}

// ---- audio lifecycle ---------------------------------------------------

async function ensureAudio() {
  if (audioContext && renderer) return;
  audioContext = new AudioContext();
  renderer = new WebRenderer();

  // Uncomment for oscilloscope event wiring:
  // renderer.on("scope", (event: any) => {
  //   if (event.source === "demo-scope") {
  //     const block = event.data?.[0];
  //     if (block) oscilloscope.data = Array.from(block as Float32Array);
  //   }
  // });

  const worklet = await renderer.initialize(audioContext);
  worklet.connect(audioContext.destination);
}

// ---- reactivity --------------------------------------------------------

const controls: Array<HTMLInputElement | HTMLSelectElement> = [paramASlider];

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
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    startButton.disabled = false;
  }
});

updateSliderValues();
