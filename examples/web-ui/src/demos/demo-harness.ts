/**
 * Shared demo harness for elemaudiors web-ui demos.
 *
 * Extracts the repeated boilerplate so each demo only defines:
 *  - layout HTML
 *  - buildGraph()
 *  - control bindings and readout sync
 */

import { el, type NodeRepr_t } from "@elem-rs/core";
import WebRenderer from "../WebRenderer";
import "../style.css";
import { installDevtoolsBridge, wireRendererScopeEvents } from "./devtools/bridge";

type ControlLike = HTMLInputElement | HTMLSelectElement;

export type BuildGraph = () => NodeRepr_t[];

export interface RenderOptions {
  rootFadeInMs: number;
  rootFadeOutMs: number;
}

export interface DemoConfig {
  /** HTML string injected into #app. Must contain `#start` and `#status`. */
  layout: string;
  /** Returns the stereo root nodes for the current control state. */
  buildGraph: BuildGraph;
  /** Called after each render to sync readout spans with slider values. */
  updateReadouts: () => void;
  /** Optional scope event handler wired during audio init. */
  onScopeEvent?: (event: any) => void;
  /** Optional root fade options passed to renderWithOptions instead of render. */
  renderOptions?: RenderOptions;
  /** Optional map of default values for double-click reset on sliders. */
  resetValues?: Map<HTMLInputElement, string>;
  /** Optional map of default checked states for double-click reset on toggles. */
  resetChecks?: Map<HTMLInputElement, boolean>;
  /** Optional callback invoked once after audio context and renderer are initialized. */
  onAudioReady?: (renderer: WebRenderer) => Promise<void> | void;
}

/**
 * Queries the app root for an element matching `selector`.
 * Throws if the element is missing.
 */
export function mustQuery<T extends Element>(root: HTMLElement, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing control: ${selector}`);
  return el;
}

/**
 * Bootstraps a demo from a config object.
 * Wires audio init, control listeners, and the start button.
 */
export function initDemo(config: DemoConfig) {
  installDevtoolsBridge();

  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing app root");

  app.innerHTML = config.layout;

  const startButton = mustQuery<HTMLButtonElement>(app, "#start");
  const stopButton = mustQuery<HTMLButtonElement>(app, "#stop");
  const status = mustQuery<HTMLDivElement>(app, "#status");

  if (stopButton) {
    stopButton.disabled = true;
  }

  let audioContext: AudioContext | null = null;
  let renderer: WebRenderer | null = null;
  const defaultValues = new Map<ControlLike, string>();
  const defaultChecks = new Map<HTMLInputElement, boolean>();

  async function ensureAudio() {
    if (audioContext && renderer) return;
    audioContext = new AudioContext();
    renderer = new WebRenderer();

    wireRendererScopeEvents(renderer, config.onScopeEvent);

    const worklet = await renderer.initialize(audioContext);
    worklet.connect(audioContext.destination);

    if (config.onAudioReady) {
      await config.onAudioReady(renderer);
    }
  }

  async function renderCurrentGraph() {
    if (!renderer || !audioContext || !renderer.isReady()) return;
    await audioContext.resume();

    try {
      if (config.renderOptions) {
        const result = await renderer.renderWithOptions(config.renderOptions, ...config.buildGraph());
        config.updateReadouts();
        status.textContent = JSON.stringify(result);
      } else {
        const result = await renderer.render(...config.buildGraph());
        config.updateReadouts();
        status.textContent = JSON.stringify(result);
      }
    } catch (error) {
      // Render rejections (for example unknown node types) would otherwise
      // be swallowed as unhandled promise rejections on `void` calls from
      // input listeners. Surface them in the demo status bar so the user
      // can see what went wrong.
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      status.textContent = `Render failed: ${message}`;
      // eslint-disable-next-line no-console
      console.error("renderCurrentGraph failed", error);
    }
  }

  async function stopAudio() {
    if (!renderer || !audioContext) return;

    status.textContent = "Stopping audio...";
    if (stopButton) stopButton.disabled = true;

    await renderer.renderWithOptions(
      { rootFadeInMs: 0, rootFadeOutMs: 100 },
      ...[el.const({ value: 0 }), el.const({ value: 0 })]
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    await audioContext.suspend();

    status.textContent = "Audio stopped";
    startButton.disabled = false;
  }

  async function startAudio() {
    startButton.disabled = true;
    status.textContent = "Starting audio...";

    try {
      await ensureAudio();
      await renderCurrentGraph();
      if (stopButton) stopButton.disabled = false;
    } catch (error) {
      status.textContent = `Failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`;
      startButton.disabled = false;
    }
  }

  function resetControl(control: HTMLInputElement) {
    if (control.type === "checkbox") {
      const checked = config.resetChecks?.get(control) ?? defaultChecks.get(control);
      if (checked !== undefined) {
        control.checked = checked;
      }
    } else {
      const value = config.resetValues?.get(control) ?? defaultValues.get(control);
      if (value !== undefined) {
        control.value = value;
      }
    }

    config.updateReadouts();

    if (renderer && audioContext?.state === "running") {
      void renderCurrentGraph();
    }
  }

  function wireControls(controls: ControlLike[]) {
    controls.forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        defaultChecks.set(control, control.defaultChecked);
        return;
      }

      const initialValue = control instanceof HTMLInputElement ? control.defaultValue : control.value;
      defaultValues.set(control, initialValue);
    });

    controls.forEach((control) => {
      const onChange = () => {
        config.updateReadouts();
        if (renderer && audioContext?.state === "running") {
          void renderCurrentGraph();
        }
      };

      control.addEventListener("input", onChange);
      control.addEventListener("change", onChange);

      if (control instanceof HTMLInputElement) {
        control.addEventListener("dblclick", (event) => {
          event.preventDefault();
          resetControl(control);
        });
      }
    });
  }

  startButton.addEventListener("click", () => {
    void startAudio();
  });

  if (stopButton) {
    stopButton.addEventListener("click", async () => {
      await stopAudio();
    });
  }

  return {
    app,
    status,
    startButton,
    stopButton,
    stopAudio,
    renderCurrentGraph,
    wireControls,
    updateReadouts: () => config.updateReadouts(),
    mustQuery: <T extends Element>(sel: string) => {
      if (!app) throw new Error("App root is missing");
      return mustQuery<T>(app, sel);
    },
  };
}
