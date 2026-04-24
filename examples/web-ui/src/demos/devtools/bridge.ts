const DEVTOOLS_BRIDGE_SOURCE = "elemaudiors-devscope";
const DEVTOOLS_BRIDGE_TYPE = "elemaudio.debug";
const DEVTOOLS_PANEL_READY_TYPE = "elemaudio.debug.panel-ready";

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
  trackedMin?: number;
  trackedMax?: number;
  blockMin?: number;
  blockMax?: number;
};

declare global {
  interface Window {
    __ELEMAUDIO_DEBUG_CACHE__?: {
      bridgeReady: boolean;
      updatedAt: number;
      eventsBySource: Record<string, DevtoolsScopeEvent>;
      resetRange: (source?: string) => void;
      clampRange: (min: number, max: number, source?: string) => void;
    };
  }
}

const devtoolsScopeCache = new Map<string, DevtoolsScopeEvent>();
const devtoolsScopeRanges = new Map<string, { min: number; max: number }>();
const devtoolsScopeSeq = new Map<string, number>();
const devtoolsScopePinned = new Set<string>();
let devtoolsPanelListenerInstalled = false;

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

function forwardScopeEventToDevtools(event: unknown) {
  const payload = event as {
    source?: string;
    data?: unknown;
    sampleRate?: number;
  };

  if (!payload || typeof payload.source !== "string" || !Array.isArray(payload.data)) {
    return;
  }

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
    channelCount: payload.data.length,
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

export function installDevtoolsBridge() {
  ensureDevtoolsPanelListener();
  syncDevtoolsCacheToWindow();
}

export function wireRendererScopeEvents(renderer: { on: (event: string, handler: (event: unknown) => void) => void }, onScopeEvent?: (event: unknown) => void) {
  renderer.on("scope", (event: unknown) => {
    forwardScopeEventToDevtools(event);
    onScopeEvent?.(event);
  });
}
