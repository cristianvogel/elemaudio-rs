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
import {
  ControlLike,
  applyControlState,
  attachPresetControls,
  controlStorageKey,
  createControlPresetManager,
  readControlValue,
} from "./control-presets";

const DEVTOOLS_BRIDGE_SOURCE = "elemaudiors-devscope";
const DEVTOOLS_BRIDGE_TYPE = "elemaudio.debug";
const DEVTOOLS_PANEL_READY_TYPE = "elemaudio.debug.panel-ready";

declare global {
  interface Window {
    // Latest scope payloads mirrored onto the inspected page so the DevTools
    // panel can poll them directly through inspectedWindow.eval(...), even
    // when the actual demo is hosted inside an iframe in index.html.
    __ELEMAUDIO_DEBUG_CACHE__?: {
      bridgeReady: boolean;
      updatedAt: number;
      eventsBySource: Record<string, DevtoolsScopeEvent>;
    };
  }
}

type DevtoolsScopeEvent = {
  schema: "elemaudio.debug";
  version: 1;
  kind: "scope" | "lifecycle";
  mode?: "stream" | "frame";
  phase?: string;
  sessionId: string;
  graphId: string;
  source: string;
  timestampMs: number;
  sampleRate?: number;
  channelCount?: number;
  channels?: unknown;
};

// Cache one latest event per named scope source. The panel only needs the most
// recent block/frame for sparkline rendering and reconnect replay.
const devtoolsScopeCache = new Map<string, DevtoolsScopeEvent>();
let devtoolsPanelListenerInstalled = false;

// Keep a JSON-safe mirror on window for the devtools panel. This is the most
// reliable bridge in this dev-only setup because the panel can read it directly
// from the inspected page without depending on extension message routing.
function syncDevtoolsCacheToWindow() {
  window.__ELEMAUDIO_DEBUG_CACHE__ = {
    bridgeReady: true,
    updatedAt: performance.now(),
    eventsBySource: Object.fromEntries(devtoolsScopeCache.entries()),
  };
}

// Also emit postMessage events so page-local debug tooling can subscribe to the
// same stream. The extension no longer depends on this path, but it remains
// useful for ad-hoc in-page debugging.
function postDevtoolsEvent(event: DevtoolsScopeEvent) {
  window.postMessage(
    {
      source: DEVTOOLS_BRIDGE_SOURCE,
      type: DEVTOOLS_BRIDGE_TYPE,
      event,
    },
    "*",
  );
}

// Listen for an explicit panel reconnect request. When the panel comes up late
// or the extension reloads, it asks for a replay and this handler republishes
// the latest cached scope events immediately.
function ensureDevtoolsPanelListener() {
  if (devtoolsPanelListenerInstalled) {
    return;
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }

    const payload = event.data as { source?: string; type?: string };
    if (!payload || payload.source !== DEVTOOLS_BRIDGE_SOURCE || payload.type !== DEVTOOLS_PANEL_READY_TYPE) {
      return;
    }

    postDevtoolsEvent({
      schema: "elemaudio.debug",
      version: 1,
      kind: "lifecycle",
      phase: "bridge-ready",
      sessionId: location.pathname,
      graphId: location.pathname,
      source: "bridge",
      timestampMs: performance.now(),
    });

    for (const cachedEvent of devtoolsScopeCache.values()) {
      postDevtoolsEvent({
        ...cachedEvent,
        timestampMs: performance.now(),
      });
    }

    syncDevtoolsCacheToWindow();
  });

  devtoolsPanelListenerInstalled = true;
}

// Normalize renderer `scope` events into the devtools schema, cache the latest
// payload by source name, then expose it through both the window cache and the
// optional postMessage stream.
function forwardScopeEventToDevtools(event: unknown) {
  const payload = event as {
    source?: string;
    data?: unknown;
    channels?: number;
    sampleRate?: number;
  };

  if (!payload || typeof payload.source !== "string" || !Array.isArray(payload.data)) {
    return;
  }

  const scopeEvent: DevtoolsScopeEvent = {
    schema: "elemaudio.debug",
    version: 1,
    kind: "scope",
    mode: "stream",
    sessionId: location.pathname,
    graphId: `${location.pathname}:${payload.source}`,
    source: payload.source,
    timestampMs: performance.now(),
    sampleRate: payload.sampleRate,
    channelCount: payload.channels,
    channels: payload.data,
  };

  devtoolsScopeCache.set(payload.source, scopeEvent);
  syncDevtoolsCacheToWindow();
  postDevtoolsEvent(scopeEvent);
}

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
  ensureDevtoolsPanelListener();
  syncDevtoolsCacheToWindow();

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
  const persistenceEnabled = persistKey !== "no-persist";
  const presetManager = persistenceEnabled ? createControlPresetManager(`${persistKey}:presets`) : null;
  const defaultValues = new Map<ControlLike, string>();
  const defaultChecks = new Map<HTMLInputElement, boolean>();

  function loadPersistedState(): Record<string, string | boolean> {
    if (!presetManager) return {};
    return presetManager.loadCurrentState();
  }

  function savePersistedState(state: Record<string, string | boolean>) {
    if (!presetManager) return;
    presetManager.saveCurrentState(state);
  }

  function persistControl(control: ControlLike) {
    if (!persistenceEnabled) return;
    const key = controlStorageKey(control);
    if (!key) return;
    const state = loadPersistedState();
    state[key] = readControlValue(control);
    savePersistedState(state);
  }

  function restoreControls(controls: ControlLike[]) {
    if (!persistenceEnabled) return;
    const state = loadPersistedState();
    applyControlState(controls, state);
  }

  async function ensureAudio() {
    if (audioContext && renderer) return;
    audioContext = new AudioContext();
    renderer = new WebRenderer();

    if (config.onScopeEvent) {
      renderer.on("scope", (event: unknown) => {
        forwardScopeEventToDevtools(event);
        config.onScopeEvent?.(event);
      });
    }

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
    persistControl(control);

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

    restoreControls(controls);

    if (presetManager && app) {
      attachPresetControls({
        controlsHost: app.querySelector<HTMLElement>(".controls") ?? app,
        controls,
        storageKey: `${persistKey}:presets`,
        updateReadouts: config.updateReadouts,
        rerender: renderCurrentGraph,
        isAudioRunning: () => audioContext?.state === "running" && renderer !== null,
      });
    }

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

      if (control instanceof HTMLInputElement) {
        control.addEventListener("dblclick", (event) => {
          event.preventDefault();
          resetControl(control);
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
