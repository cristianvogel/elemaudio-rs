/**
 * Shared demo harness for elemaudio-rs web-ui demos.
 *
 * Extracts the repeated boilerplate so each demo only defines:
 *  - layout HTML
 *  - buildGraph()
 *  - control bindings and readout sync
 */

import { el, type NodeRepr_t } from "@elem-rs/core";
import WebRenderer from "../WebRenderer";
import "../style.css";

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
  /**
   * Optional persistence key. When omitted, derived from pathname
   * so each demo page gets its own localStorage bucket automatically.
   */
  persistKey?: string;
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
  const persistKey = config.persistKey ?? `elemaudio-rs:demo:${location.pathname}`;

  function loadPersistedState(): Record<string, string | boolean> {
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return parsed as Record<string, string | boolean>;
    } catch {
      return {};
    }
  }

  function savePersistedState(state: Record<string, string | boolean>) {
    try {
      localStorage.setItem(persistKey, JSON.stringify(state));
    } catch {
      // Ignore quota/privacy failures during dev.
    }
  }

  function controlStorageKey(control: HTMLInputElement | HTMLSelectElement): string | null {
    return control.id || control.getAttribute("name");
  }

  function readControlValue(control: HTMLInputElement | HTMLSelectElement): string | boolean {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return control.checked;
    }
    return control.value;
  }

  function writeControlValue(control: HTMLInputElement | HTMLSelectElement, value: string | boolean) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      if (typeof value === "boolean") control.checked = value;
      return;
    }
    if (typeof value === "string") control.value = value;
  }

  function persistControl(control: HTMLInputElement | HTMLSelectElement) {
    const key = controlStorageKey(control);
    if (!key) return;
    const state = loadPersistedState();
    state[key] = readControlValue(control);
    savePersistedState(state);
  }

  function restoreControls(controls: Array<HTMLInputElement | HTMLSelectElement>) {
    const state = loadPersistedState();
    controls.forEach((control) => {
      const key = controlStorageKey(control);
      if (!key) return;
      if (!(key in state)) return;
      writeControlValue(control, state[key]);
    });
  }

  async function ensureAudio() {
    if (audioContext && renderer) return;
    audioContext = new AudioContext();
    renderer = new WebRenderer();

    if (config.onScopeEvent) {
      renderer.on("scope", config.onScopeEvent);
    }

    const worklet = await renderer.initialize(audioContext);
    worklet.connect(audioContext.destination);

    if (config.onAudioReady) {
      await config.onAudioReady(renderer);
    }
  }

  async function renderCurrentGraph() {
    if (!renderer || !audioContext) return;
    await audioContext.resume();

    if (config.renderOptions) {
      const result = await renderer.renderWithOptions(config.renderOptions, ...config.buildGraph());
      config.updateReadouts();
      status.textContent = JSON.stringify(result);
    } else {
      const result = await renderer.render(...config.buildGraph());
      config.updateReadouts();
      status.textContent = JSON.stringify(result);
    }
  }

  async function stopAudio() {
    if (!renderer || !audioContext) return;

    status.textContent = "Stopping audio...";
    if (stopButton) stopButton.disabled = true;

    // Render silence with a short fade-out
    await renderer.renderWithOptions(
      { rootFadeInMs: 0, rootFadeOutMs: 100 },
      ...[el.const({ value: 0 }), el.const({ value: 0 })]
    );

    // Give it a moment to fade out before suspending
    await new Promise((resolve) => setTimeout(resolve, 120));
    await audioContext.suspend();

    status.textContent = "Audio stopped";
    startButton.disabled = false;
  }

  function resetControl(control: HTMLInputElement) {
    if (control.type === "checkbox" && config.resetChecks) {
      control.checked = config.resetChecks.get(control) ?? control.checked;
    } else if (config.resetValues) {
      const value = config.resetValues.get(control);
      if (value !== undefined) control.value = value;
    }

    config.updateReadouts();
    persistControl(control);

    if (renderer && audioContext?.state === "running") {
      void renderCurrentGraph();
    }
  }

  /**
   * Wires input and optional double-click-reset listeners on the given controls.
   * Call this after querying control elements from the DOM.
   */
  function wireControls(controls: Array<HTMLInputElement | HTMLSelectElement>) {
    // Restore persisted values once before listeners go live.
    restoreControls(controls);

    controls.forEach((control) => {
      const onChange = () => {
        persistControl(control);
        config.updateReadouts();
        if (renderer && audioContext?.state === "running") {
          void renderCurrentGraph();
        }
      };

      control.addEventListener("input", onChange);
      control.addEventListener("change", onChange);

      if (config.resetValues || config.resetChecks) {
        control.addEventListener("dblclick", (event) => {
          event.preventDefault();
          resetControl(control as HTMLInputElement);
        });
      }
    });
  }

  startButton.addEventListener("click", async () => {
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
  });

  if (stopButton) {
    stopButton.addEventListener("click", async () => {
      await stopAudio();
    });
  }

  // Note: updateReadouts is NOT called here. Demos call it after
  // querying their control elements. The first render also calls it.

  return {
    app,
    status,
    startButton,
    stopButton,
    stopAudio,
    renderCurrentGraph,
    wireControls,
    updateReadouts: () => config.updateReadouts(),
    mustQuery: <T extends Element>(sel: string) => mustQuery<T>(app, sel),
  };
}
