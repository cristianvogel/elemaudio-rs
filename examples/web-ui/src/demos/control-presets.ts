export type ControlValue = string | boolean;

export type ControlLike = HTMLInputElement | HTMLSelectElement;
type ControlState = Record<string, ControlValue>;

export interface ControlPresetManager {
  loadCurrentState(): ControlState;
  saveCurrentState(state: ControlState): void;
  getPresetNames(): string[];
  getSelectedPreset(): string;
  setSelectedPreset(name: string): void;
  loadPreset(name: string): ControlState | null;
  savePreset(name: string, state: ControlState): void;
}

interface PresetStore {
  version: 1;
  current: ControlState;
  selectedPreset: string;
  presets: Record<string, ControlState>;
}

const PRESET_COUNT = 8;
const DEFAULT_PRESET = presetNameForIndex(0);

function presetNameForIndex(index: number): string {
  return `preset${String(index).padStart(2, "0")}`;
}

function defaultStore(): PresetStore {
  const presets: Record<string, ControlState> = {};
  for (let index = 0; index < PRESET_COUNT; index += 1) {
    presets[presetNameForIndex(index)] = {};
  }

  return {
    version: 1,
    current: {},
    selectedPreset: DEFAULT_PRESET,
    presets,
  };
}

export function createControlPresetManager(storageKey: string): ControlPresetManager {
  function readStore(): PresetStore {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultStore();

      const parsed = JSON.parse(raw) as Partial<PresetStore> | null;
      if (!parsed || typeof parsed !== "object") return defaultStore();

      const base = defaultStore();
      return {
        version: 1,
        current: parsed.current && typeof parsed.current === "object" ? parsed.current as ControlState : base.current,
        selectedPreset: typeof parsed.selectedPreset === "string" ? parsed.selectedPreset : base.selectedPreset,
        presets: parsed.presets && typeof parsed.presets === "object"
          ? { ...base.presets, ...parsed.presets }
          : base.presets,
      };
    } catch {
      return defaultStore();
    }
  }

  function writeStore(store: PresetStore) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(store));
    } catch {
      // Ignore quota/privacy failures during dev.
    }
  }

  return {
    loadCurrentState() {
      return readStore().current;
    },
    saveCurrentState(state) {
      const store = readStore();
      store.current = state;
      writeStore(store);
    },
    getPresetNames() {
      return Array.from({ length: PRESET_COUNT }, (_, index) => presetNameForIndex(index));
    },
    getSelectedPreset() {
      return readStore().selectedPreset;
    },
    setSelectedPreset(name) {
      const store = readStore();
      store.selectedPreset = name;
      writeStore(store);
    },
    loadPreset(name) {
      const store = readStore();
      return store.presets[name] ?? null;
    },
    savePreset(name, state) {
      const store = readStore();
      store.presets[name] = state;
      store.selectedPreset = name;
      writeStore(store);
    },
  };
}

export function controlStorageKey(control: ControlLike): string | null {
  return control.id || control.getAttribute("name");
}

export function readControlValue(control: ControlLike): ControlValue {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    return control.checked;
  }

  return control.value;
}

export function writeControlValue(control: ControlLike, value: ControlValue) {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    if (typeof value === "boolean") {
      control.checked = value;
    }
    return;
  }

  if (typeof value === "string") {
    control.value = value;
  }
}

export function snapshotControls(controls: ControlLike[]): ControlState {
  const state: ControlState = {};

  controls.forEach((control) => {
    const key = controlStorageKey(control);
    if (!key) return;
    state[key] = readControlValue(control);
  });

  return state;
}

export function applyControlState(controls: ControlLike[], state: ControlState) {
  controls.forEach((control) => {
    const key = controlStorageKey(control);
    if (!key) return;
    if (!(key in state)) return;
    writeControlValue(control, state[key]);
  });
}

export function attachPresetControls(options: {
  controlsHost: HTMLElement;
  controls: ControlLike[];
  storageKey: string;
  updateReadouts: () => void;
  rerender: () => Promise<void> | void;
  isAudioRunning: () => boolean;
  readExtraState?: () => ControlState;
  applyExtraState?: (state: ControlState) => void;
}) {
  const manager = createControlPresetManager(options.storageKey);
  const presetNames = manager.getPresetNames();
  const wrapper = document.createElement("div");
  wrapper.className = "preset-row";
  wrapper.innerHTML = `
    <label class="preset-label" for="preset-select">
      <span>Presets</span>
      <span class="preset-note">Browser-backed demo slots</span>
    </label>
    <div class="preset-controls">
      <select id="preset-select" class="toggle-select"></select>
      <button id="preset-load" class="secondary" type="button">Load</button>
      <button id="preset-save" class="secondary" type="button">Save</button>
    </div>
    <div id="preset-status" class="resource-status">Preset bank ready</div>
  `;

  options.controlsHost.appendChild(wrapper);

  const select = wrapper.querySelector<HTMLSelectElement>("#preset-select");
  const loadButton = wrapper.querySelector<HTMLButtonElement>("#preset-load");
  const saveButton = wrapper.querySelector<HTMLButtonElement>("#preset-save");
  const status = wrapper.querySelector<HTMLDivElement>("#preset-status");

  if (!select || !loadButton || !saveButton || !status) {
    throw new Error("Failed to create preset controls");
  }

  presetNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });

  const selectedPreset = manager.getSelectedPreset();
  select.value = presetNames.includes(selectedPreset) ? selectedPreset : presetNames[0];

  function setStatus(message: string) {
    status.textContent = message;
  }

  async function syncAfterStateChange(message: string) {
    manager.saveCurrentState({
      ...snapshotControls(options.controls),
      ...(options.readExtraState?.() ?? {}),
    });
    options.updateReadouts();
    setStatus(message);
    if (options.isAudioRunning()) {
      await options.rerender();
    }
  }

  select.addEventListener("change", () => {
    manager.setSelectedPreset(select.value);
    setStatus(`Selected ${select.value}`);
  });

  loadButton.addEventListener("click", async () => {
    const state = manager.loadPreset(select.value);
    if (!state || Object.keys(state).length === 0) {
      setStatus(`${select.value} is empty`);
      return;
    }

    applyControlState(options.controls, state);
    options.applyExtraState?.(state);
    await syncAfterStateChange(`Loaded ${select.value}`);
  });

  saveButton.addEventListener("click", () => {
    const state = {
      ...snapshotControls(options.controls),
      ...(options.readExtraState?.() ?? {}),
    };
    manager.savePreset(select.value, state);
    manager.saveCurrentState(state);
    setStatus(`Saved ${select.value}`);
  });

  return {
    manager,
    setStatus,
  };
}
