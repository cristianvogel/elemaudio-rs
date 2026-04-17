import { el } from "@elem-rs/core";
import type { NodeRepr_t } from "@elem-rs/core";
import WebRenderer from "../WebRenderer";
import "../style.css";

const resourceFeatureEnabled = import.meta.env.VITE_ELEMAUDIO_RESOURCES === "1";

const apiBase = "http://127.0.0.1:3030";
const bundledSampleUrl = new URL("../../../demo-resources/115bpm_808_Beat_mono.wav?url", import.meta.url);
const bundledSampleName = "bundled_808.wav";
const browserVfsRoot = "resource-manager";

type ResourceEntry = {
  id: string;
  kind: string;
  bytes: number;
};

type ResourceSnapshot = {
  active: string | null;
  resources: ResourceEntry[];
};

type ResourceMetadata = {
  duration_ms: number;
  channels: number;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

const root = app;

function mustQuery<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing control: ${selector}`);
  }

  return element;
}

if (!resourceFeatureEnabled) {
  app.innerHTML = `
    <div class="panel">
      <h1>elemaudio-rs resource manager demo</h1>
      <p>This demo is disabled in the base build. Re-run the app with the resource feature enabled to use Rust-managed resources.</p>
    </div>
  `;
  throw new Error("elemaudio-resources feature disabled");
}

app.innerHTML = `
  <div class="panel">
    <h1>elemaudio-rs resource manager demo</h1>
    <p>Uploads browser files into the Rust resource manager, then mirrors the selected Rust resource into the browser VFS for playback.</p>
    <div class="controls">
      <div class="row">
        <label>
          <span>Resource id</span>
          <span id="resource-count">0 resources</span>
        </label>
        <div id="resource-id" class="resource-status">No resource selected</div>
      </div>
      <div class="row">
        <label for="browser-file">
          <span>Browser file</span>
          <span id="selected-file-name">No file selected</span>
        </label>
        <input id="browser-file" type="file" accept="audio/wav" />
      </div>
      <div class="buttons">
        <button id="load-bundled">Load built-in sample</button>
        <button id="upload-file" class="secondary">Upload browser file</button>
      </div>
      <div class="buttons">
        <button id="rename-selected" class="secondary">Rename selected</button>
        <button id="delete-selected" class="secondary">Delete selected</button>
        <button id="prune-selected">Prune others</button>
      </div>
      <div class="buttons">
        <button id="play-selected">Mirror and play</button>
        <button id="stop-audio" class="secondary">Stop audio</button>
        <label class="inline-toggle">
          <input id="auto-play" type="checkbox" checked />
          <span>Auto-play selection</span>
        </label>
      </div>
      <div class="status" id="status">Idle</div>
      <div class="resource-status" id="metadata-status">Metadata not loaded</div>
      <div class="resource-status" id="mirror-status">Browser VFS idle</div>
      <div class="resource-status" id="binary-status">Binary snapshot not loaded</div>
      <div class="resource-list" id="resource-list"></div>
    </div>
  </div>
`;

const resourceIdLabel = mustQuery<HTMLDivElement>("#resource-id");
const browserFileInput = mustQuery<HTMLInputElement>("#browser-file");
const selectedFileName = mustQuery<HTMLSpanElement>("#selected-file-name");
const resourceCount = mustQuery<HTMLSpanElement>("#resource-count");
const loadBundledButton = mustQuery<HTMLButtonElement>("#load-bundled");
const uploadFileButton = mustQuery<HTMLButtonElement>("#upload-file");
const renameSelectedButton = mustQuery<HTMLButtonElement>("#rename-selected");
const deleteSelectedButton = mustQuery<HTMLButtonElement>("#delete-selected");
const pruneSelectedButton = mustQuery<HTMLButtonElement>("#prune-selected");
const playSelectedButton = mustQuery<HTMLButtonElement>("#play-selected");
const stopAudioButton = mustQuery<HTMLButtonElement>("#stop-audio");
const autoPlayCheckbox = mustQuery<HTMLInputElement>("#auto-play");
const status = mustQuery<HTMLDivElement>("#status");
const metadataStatus = mustQuery<HTMLDivElement>("#metadata-status");
const mirrorStatus = mustQuery<HTMLDivElement>("#mirror-status");
const binaryStatus = mustQuery<HTMLDivElement>("#binary-status");
const resourceList = mustQuery<HTMLDivElement>("#resource-list");

let selectedResourceId = "";
let audioContext: AudioContext | null = null;
let renderer: WebRenderer | null = null;
let isStopped = false;
let activeMirrorPath = `${browserVfsRoot}/active.wav`;
let activeMirrorChannels = 0;

function api(path: string) {
  return `${apiBase}${path}`;
}

async function post(path: string, body?: ArrayBuffer) {
  const response = await fetch(api(path), {
    method: "POST",
    mode: "cors",
    body,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response;
}

async function loadSnapshot() {
  const response = await fetch(api("/api/resources"), { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to list resources: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as ResourceSnapshot;
}

async function loadBinarySnapshotSize() {
  const response = await fetch(api("/api/resources.bin"), { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to load binary snapshot: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  binaryStatus.textContent = `Binary snapshot: ${bytes.byteLength} bytes`;
}

async function loadMetadata(resourceId: string) {
  const response = await fetch(api(`/api/resources/metadata?name=${encodeURIComponent(resourceId)}`), { mode: "cors" });

  if (!response.ok) {
    throw new Error(`Failed to load metadata: ${response.status} ${response.statusText}`);
  }

  const metadata = (await response.json()) as ResourceMetadata;
  metadataStatus.textContent = `Duration: ${metadata.duration_ms.toFixed(1)} ms, Channels: ${metadata.channels}`;
}

async function ensureAudio() {
  if (audioContext && renderer) {
    return;
  }

  audioContext = new AudioContext();
  renderer = new WebRenderer();

  const worklet = await renderer.initialize(audioContext);
  worklet.connect(audioContext.destination);
}

async function mirrorSelectedResource(resourceId: string) {
  await ensureAudio();

  const response = await fetch(api(`/api/resources/export.wav?name=${encodeURIComponent(resourceId)}`), { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to export resource: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  const buffer = await audioContext!.decodeAudioData(bytes);
  const mirrorPath = `${browserVfsRoot}/${encodeURIComponent(resourceId)}.wav`;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    new Float32Array(buffer.getChannelData(index)),
  );

  activeMirrorPath = mirrorPath;
  activeMirrorChannels = buffer.numberOfChannels;

  await renderer!.updateVirtualFileSystem({
    [mirrorPath]: buffer.numberOfChannels > 1 ? channels : channels[0],
  });

  mirrorStatus.textContent = `Mirrored ${resourceId} into browser VFS at ${mirrorPath}`;
}

function buildGraph(): NodeRepr_t[] {
  if (isStopped) {
    return [el.const({ value: 0 }), el.const({ value: 0 })];
  }

  const trigger = el.train(el.const({ value: 0.2 }));

  if (activeMirrorChannels > 1) {
    const roots = el.mc.sample({ path: activeMirrorPath, channels: activeMirrorChannels }, trigger);

    const left = roots[0] ? el.mul(el.const({ value: 0.5 }), roots[0]) : el.const({ value: 0 });
    const right = roots[1] ? el.mul(el.const({ value: 0.5 }), roots[1]) : left;

    return [left, right];
  }

  const sample = el.sample({ path: activeMirrorPath }, trigger, el.const({ value: 1 }));
  const left = el.mul(el.const({ value: 0.5 }), sample);
  const right = el.mul(el.const({ value: 0.5 }), sample);

  return [left, right];
}

async function renderCurrentGraph() {
  if (!renderer) {
    return;
  }

  await audioContext?.resume();
  await renderer.render(...buildGraph());
  await renderer.pruneVirtualFileSystem();
  status.textContent = isStopped ? "Audio stopped" : `Playing ${selectedResourceId}`;
}

async function stopAudio() {
  if (!renderer || !audioContext) return;

  isStopped = true;
  status.textContent = "Stopping audio...";

  // Render silence with a short fade-out
  await renderer.renderWithOptions(
    { rootFadeInMs: 0, rootFadeOutMs: 100 },
    ...[el.const({ value: 0 }), el.const({ value: 0 })]
  );

  // Give it a moment to fade out before suspending
  await new Promise((resolve) => setTimeout(resolve, 120));
  await audioContext.suspend();

  status.textContent = "Audio stopped";
}

function renderResources(snapshot: ResourceSnapshot) {
  resourceCount.textContent = `${snapshot.resources.length} resources`;
  mirrorStatus.textContent = snapshot.active ? `Active in Rust: ${snapshot.active}` : "Browser VFS idle";

  if (snapshot.resources.length === 0) {
    resourceList.innerHTML = `<div class="empty-state">No resources stored in Rust</div>`;
    return;
  }

  resourceList.innerHTML = `
    <table class="resource-table">
      <thead>
        <tr>
          <th>Selected</th>
          <th>Id</th>
          <th>Kind</th>
          <th>Bytes</th>
        </tr>
      </thead>
      <tbody>
        ${snapshot.resources
          .map(
            (resource) => `
              <tr data-resource-id="${resource.id}">
                <td><button class="select-resource" data-resource-id="${resource.id}">Select</button></td>
                <td>${resource.id}</td>
                <td>${resource.kind}</td>
                <td>${resource.bytes}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  resourceList.querySelectorAll<HTMLButtonElement>(".select-resource").forEach((button) => {
    button.addEventListener("click", () => {
      selectedResourceId = button.dataset.resourceId ?? selectedResourceId;
      resourceIdLabel.textContent = selectedResourceId;
      status.textContent = `Selected ${selectedResourceId}`;

      void loadMetadata(selectedResourceId).catch((error) => {
        metadataStatus.textContent = `Metadata failed: ${error instanceof Error ? error.message : String(error)}`;
      });

      if (autoPlayCheckbox.checked) {
        void playSelectedResource().catch((error) => {
          status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
        });
      }
    });
  });
}

async function refresh() {
  const snapshot = await loadSnapshot();
  renderResources(snapshot);
  await loadBinarySnapshotSize();

  if (snapshot.resources.length === 0) {
    selectedResourceId = "";
    resourceIdLabel.textContent = "No resource selected";
    metadataStatus.textContent = "Metadata not loaded";
    mirrorStatus.textContent = "Browser VFS idle";
    return;
  }

  if (!snapshot.resources.some((resource) => resource.id === selectedResourceId)) {
    selectedResourceId = snapshot.resources[0].id;
    resourceIdLabel.textContent = selectedResourceId;
  }

  if (selectedResourceId) {
    await loadMetadata(selectedResourceId).catch((error) => {
      metadataStatus.textContent = `Metadata failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  }
}

async function loadBundledSample() {
  const response = await fetch(bundledSampleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch bundled sample: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  await post(`/api/resources/load?name=${encodeURIComponent(bundledSampleName)}`, bytes);
  selectedResourceId = bundledSampleName;
  resourceIdLabel.textContent = selectedResourceId;
  status.textContent = `Loaded ${bundledSampleName} into Rust`;
  await refresh();

  if (autoPlayCheckbox.checked) {
    await playSelectedResource();
  }
}

async function uploadBrowserFile() {
  const file = browserFileInput.files?.[0];

  if (!file) {
    throw new Error("Choose a browser file first");
  }

  const bytes = await file.arrayBuffer();
  const resourceId = file.name.replace(/\s+/g, "_");
  const snapshot = await loadSnapshot();

  if (snapshot.resources.some((resource) => resource.id === resourceId)) {
    const confirmed = window.confirm(`Resource id with the same name exists (${resourceId}). Overwrite it?`);

    if (!confirmed) {
      status.textContent = `Upload cancelled for ${resourceId}`;
      return;
    }
  }

  await post(`/api/resources/load?name=${encodeURIComponent(resourceId)}`, bytes);
  selectedResourceId = resourceId;
  resourceIdLabel.textContent = selectedResourceId;
  selectedFileName.textContent = file.name;
  status.textContent = `Uploaded ${file.name} as ${resourceId}`;
  await refresh();

  if (autoPlayCheckbox.checked) {
    await playSelectedResource();
  }
}

async function playSelectedResource() {
  if (!selectedResourceId) {
    throw new Error("Select a resource first");
  }

  await mirrorSelectedResource(selectedResourceId);
  await renderCurrentGraph();
}

async function renameSelected() {
  const nextId = prompt("Rename resource to:", `${selectedResourceId}-renamed`);

  if (!nextId) {
    return;
  }

  await post(`/api/resources/rename?from=${encodeURIComponent(selectedResourceId)}&to=${encodeURIComponent(nextId)}`);
  selectedResourceId = nextId;
  resourceIdLabel.textContent = selectedResourceId;
  status.textContent = `Renamed to ${nextId}`;
  await refresh();

  if (autoPlayCheckbox.checked) {
    await playSelectedResource();
  }
}

async function deleteSelected() {
  await post(`/api/resources/delete?name=${encodeURIComponent(selectedResourceId)}`);
  status.textContent = `Deleted ${selectedResourceId}`;
  await refresh();
}

async function pruneSelected() {
  await post(`/api/resources/prune?keep=${encodeURIComponent(selectedResourceId)}`);
  status.textContent = `Pruned all but ${selectedResourceId}`;
  await refresh();
}

loadBundledButton.addEventListener("click", () => {
  void loadBundledSample().catch((error) => {
    status.textContent = `Failed to load built-in sample: ${error instanceof Error ? error.message : String(error)}`;
  });
});

uploadFileButton.addEventListener("click", () => {
  void uploadBrowserFile().catch((error) => {
    status.textContent = `Failed to upload browser file: ${error instanceof Error ? error.message : String(error)}`;
  });
});

renameSelectedButton.addEventListener("click", () => {
  void renameSelected().catch((error) => {
    status.textContent = `Failed to rename resource: ${error instanceof Error ? error.message : String(error)}`;
  });
});

deleteSelectedButton.addEventListener("click", () => {
  void deleteSelected().catch((error) => {
    status.textContent = `Failed to delete resource: ${error instanceof Error ? error.message : String(error)}`;
  });
});

pruneSelectedButton.addEventListener("click", () => {
  void pruneSelected().catch((error) => {
    status.textContent = `Failed to prune resources: ${error instanceof Error ? error.message : String(error)}`;
  });
});

playSelectedButton.addEventListener("click", () => {
  isStopped = false;
  void playSelectedResource().catch((error) => {
    status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});

stopAudioButton.addEventListener("click", () => {
  void stopAudio().catch((error) => {
    status.textContent = `Stop failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});

browserFileInput.addEventListener("change", () => {
  const file = browserFileInput.files?.[0];
  selectedFileName.textContent = file ? file.name : "No file selected";
});

void refresh().catch((error) => {
  status.textContent = `Failed to load resources: ${error instanceof Error ? error.message : String(error)}`;
});
