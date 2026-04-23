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
      /**
       * Clears held tracked min/max for one source so the next block
       * re-seeds it. Passing no argument resets every source.
       */
      resetRange: (source?: string) => void;
      /**
       * Forces held tracked min/max to the given clamped range for one
       * source. Passing no source clamps every source. Used by the panel
       * when the user pins a source to Audio [-1..1] mode.
       */
      clampRange: (min: number, max: number, source?: string) => void;
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
  seq?: number;
  sampleRate?: number;
  channelCount?: number;
  channels?: unknown;
  /** Lowest sample value ever observed on this source since session start. */
  trackedMin?: number;
  /** Highest sample value ever observed on this source since session start. */
  trackedMax?: number;
  /** Lowest sample value in the most recent block. */
  blockMin?: number;
  /** Highest sample value in the most recent block. */
  blockMax?: number;
};

// Cache one latest event per named scope source. The panel only needs the most
// recent block/frame for sparkline rendering and reconnect replay.
const devtoolsScopeCache = new Map<string, DevtoolsScopeEvent>();
// Per-source held min/max across the lifetime of the session. The panel reads
// these directly from each event, so range logic lives next to the raw
// samples and is immune to panel-side deduplication or polling cadence.
const devtoolsScopeRanges = new Map<string, { min: number; max: number }>();
// Per-source monotonic event counter used by the panel for dedup.
const devtoolsScopeSeq = new Map<string, number>();
// Sources whose tracked range is pinned by the panel. While pinned, the
// producer stops folding block extremes into the held range so the clamp
// survives future audio blocks. Re-entering adaptive mode in the panel
// unpins the source via resetRange().
const devtoolsScopePinned = new Set<string>();
let devtoolsPanelListenerInstalled = false;

// Keep a JSON-safe mirror on window for the devtools panel. This is the most
// reliable bridge in this dev-only setup because the panel can read it directly
// from the inspected page without depending on extension message routing.
function resetDevtoolsRange(source?: string) {
  if (typeof source === "string" && source.length > 0) {
    devtoolsScopeRanges.delete(source);
    devtoolsScopePinned.delete(source);
    const cached = devtoolsScopeCache.get(source);
    if (cached) {
      devtoolsScopeCache.set(source, {
        ...cached,
        trackedMin: undefined,
        trackedMax: undefined,
      });
    }
    return;
  }

  devtoolsScopeRanges.clear();
  devtoolsScopePinned.clear();
  for (const [key, cached] of devtoolsScopeCache.entries()) {
    devtoolsScopeCache.set(key, {
      ...cached,
      trackedMin: undefined,
      trackedMax: undefined,
    });
  }
}

function clampDevtoolsRange(min: number, max: number, source?: string) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return;
  }

  const applyToSource = (key: string) => {
    devtoolsScopeRanges.set(key, { min, max });
    devtoolsScopePinned.add(key);
    const cached = devtoolsScopeCache.get(key);
    if (cached) {
      devtoolsScopeCache.set(key, {
        ...cached,
        trackedMin: min,
        trackedMax: max,
      });
    }
  };

  if (typeof source === "string" && source.length > 0) {
    applyToSource(source);
    return;
  }

  for (const key of devtoolsScopeCache.keys()) {
    applyToSource(key);
  }
}

function syncDevtoolsCacheToWindow() {
  window.__ELEMAUDIO_DEBUG_CACHE__ = {
    bridgeReady: true,
    updatedAt: performance.now(),
    eventsBySource: Object.fromEntries(devtoolsScopeCache.entries()),
    resetRange: resetDevtoolsRange,
    clampRange: clampDevtoolsRange,
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
    });

    for (const cachedEvent of devtoolsScopeCache.values()) {
      postDevtoolsEvent(cachedEvent);
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

  // Scan channel[0] once for this block's extremes. Doing it at the producer
  // keeps tracked min/max tied to actual rendered audio, immune to panel
  // polling cadence or dedup quirks.
  const firstChannel = payload.data[0];
  let blockMin = Number.POSITIVE_INFINITY;
  let blockMax = Number.NEGATIVE_INFINITY;
  if (Array.isArray(firstChannel)) {
    for (let i = 0; i < firstChannel.length; i += 1) {
      const v = Number(firstChannel[i]);
      if (!Number.isFinite(v)) continue;
      if (v < blockMin) blockMin = v;
      if (v > blockMax) blockMax = v;
    }
  } else if (firstChannel && typeof firstChannel === "object") {
    for (const raw of Object.values(firstChannel as Record<string, unknown>)) {
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      if (v < blockMin) blockMin = v;
      if (v > blockMax) blockMax = v;
    }
  }

  // Fold this block's extremes into the session-wide held range for this
  // source. The held range is clamped so that it never collapses inside the
  // normalized audio window [-1, 1]: a signal that happens to peak at 0.4
  // should still plot against the full audio window, not a compressed one.
  // It only expands outward when the signal actually exceeds [-1, 1].
  //
  // When a source is pinned by the panel (Audio mode), the fold is skipped
  // entirely so the clamp survives out-of-range blocks.
  const pinned = devtoolsScopePinned.has(payload.source);
  const held = devtoolsScopeRanges.get(payload.source);
  let nextMin: number | undefined;
  let nextMax: number | undefined;
  if (pinned && held) {
    nextMin = held.min;
    nextMax = held.max;
  } else {
    const candidateMin = Number.isFinite(blockMin)
      ? held
        ? Math.min(held.min, blockMin)
        : blockMin
      : held?.min;
    const candidateMax = Number.isFinite(blockMax)
      ? held
        ? Math.max(held.max, blockMax)
        : blockMax
      : held?.max;
    nextMin = candidateMin !== undefined ? Math.min(candidateMin, -1) : undefined;
    nextMax = candidateMax !== undefined ? Math.max(candidateMax, 1) : undefined;
    if (nextMin !== undefined && nextMax !== undefined) {
      devtoolsScopeRanges.set(payload.source, { min: nextMin, max: nextMax });
    }
  }

  const prevSeq = devtoolsScopeSeq.get(payload.source) ?? 0;
  const nextSeq = prevSeq + 1;
  devtoolsScopeSeq.set(payload.source, nextSeq);

  const scopeEvent: DevtoolsScopeEvent = {
    schema: "elemaudio.debug",
    version: 1,
    kind: "scope",
    mode: "stream",
    sessionId: location.pathname,
    graphId: `${location.pathname}:${payload.source}`,
    source: payload.source,
    seq: nextSeq,
    sampleRate: payload.sampleRate,
    channelCount: payload.channels,
    channels: payload.data,
    trackedMin: nextMin,
    trackedMax: nextMax,
    blockMin: Number.isFinite(blockMin) ? blockMin : undefined,
    blockMax: Number.isFinite(blockMax) ? blockMax : undefined,
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
  const persistKey = config.persistKey ?? `elemaudiors:demo:${location.pathname}`;
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
