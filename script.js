import { parseWup, normalizeModel } from "./wup-parser.js";

const appState = {
  entries: [],
  activeId: null,
  nextId: 1
};

let statusEl = null;
let viewToastEl = null;
let fileInput = null;
let directoryInput = null;
let loadedWupListEl = null;
let toastHideTimer = null;
let persistentStatus = {
  message: "",
  isError: false
};

if (typeof document !== "undefined") {
  statusEl = document.getElementById("status");
  viewToastEl = document.getElementById("viewToast");
  fileInput = document.getElementById("wupFile");
  directoryInput = document.getElementById("wupDirectory");
  loadedWupListEl = document.getElementById("loadedWupList");
  const toggleMenuBtn = document.getElementById("toggleMenu");
  const uiOverlay = document.querySelector(".ui-overlay");

  if (fileInput) {
    fileInput.addEventListener("change", event => {
      const files = Array.from(event.target.files || []);
      void handleIncomingFiles(files, { source: "file" });
    });
  }

  if (directoryInput) {
    directoryInput.addEventListener("change", event => {
      const files = Array.from(event.target.files || []);
      void handleIncomingFiles(files, { source: "directory" });
    });
  }

  if (toggleMenuBtn && uiOverlay) {
    toggleMenuBtn.addEventListener("click", () => {
      uiOverlay.classList.toggle("hidden");
      toggleMenuBtn.textContent = uiOverlay.classList.contains("hidden") ? "+" : "−";
      toggleMenuBtn.title = uiOverlay.classList.contains("hidden") ? "Show menu" : "Hide menu";
    });
  }

  document.addEventListener("viewer:hint", event => {
    const message = event?.detail?.message;
    if (typeof message === "string" && message.length > 0) {
      showViewToast(message);
    }
  });
}

initializeSessionApi();
renderLoadedWupList();
emitCollectionEvent();

async function handleIncomingFiles(files, { source }) {
  if (!Array.isArray(files) || files.length === 0) {
    return;
  }

  if (!confirmDiscardUnsavedChanges("load a different WUP selection")) {
    resetInputs();
    return;
  }

  const wupFiles = files.filter(file => file?.name?.toLowerCase().endsWith(".wup"));
  if (wupFiles.length === 0) {
    replaceLoadedEntries([]);
    reportError("Selection contains no .wup files.");
    resetInputs();
    return;
  }

  const parsedEntries = [];
  let parseFailures = 0;

  for (const file of wupFiles) {
    const label = buildFileLabel(file);
    try {
      const text = await readFileAsText(file);
      const model = normalizeModel(parseWup(text));
      parsedEntries.push({
        id: appState.nextId++,
        label,
        model,
        error: null
      });
    } catch (err) {
      parseFailures += 1;
      parsedEntries.push({
        id: appState.nextId++,
        label,
        model: null,
        error: err?.message ?? "Unknown parse error"
      });
    }
  }

  replaceLoadedEntries(parsedEntries);

  const loadedCount = parsedEntries.length - parseFailures;
  const sourceLabel = source === "directory" ? "directory" : "selection";
  if (loadedCount === 0) {
    reportError(`No valid WUP files could be loaded from the ${sourceLabel}.`);
  } else if (parseFailures > 0) {
    reportInfo(`Loaded ${loadedCount} WUPs (${parseFailures} failed parsing).`);
  } else {
    reportInfo(`Loaded ${loadedCount} WUP${loadedCount === 1 ? "" : "s"} from ${sourceLabel}.`);
  }

  resetInputs();
}

function replaceLoadedEntries(entries) {
  appState.entries = Array.isArray(entries) ? entries : [];
  const firstValid = appState.entries.find(entry => entry?.model);
  appState.activeId = firstValid ? firstValid.id : null;

  renderLoadedWupList();
  emitCollectionEvent();

  if (firstValid) {
    emitActiveModel(firstValid);
    reportModelStats(firstValid.model, firstValid.label);
  } else {
    if (typeof window !== "undefined") {
      window.__lastWupModel = null;
    }
    reportError("No viewable WUP is currently loaded.");
  }
}

function setActiveWupById(id, options = {}) {
  const target = appState.entries.find(entry => entry?.id === id && entry.model);
  if (!target) {
    return false;
  }

  if (appState.activeId === id) {
    return true;
  }

  if (options.promptIfDirty !== false && !confirmDiscardUnsavedChanges("switch WUPs")) {
    return false;
  }

  appState.activeId = id;
  renderLoadedWupList();
  emitCollectionEvent();
  emitActiveModel(target);
  reportModelStats(target.model, target.label);
  return true;
}

function updateActiveModel(model, options = {}) {
  if (!model) {
    return false;
  }

  const activeEntry = getActiveEntry();
  if (!activeEntry) {
    return false;
  }

  activeEntry.model = model;
  if (typeof options.label === "string" && options.label.trim().length > 0) {
    activeEntry.label = options.label;
  }

  renderLoadedWupList();
  emitCollectionEvent();

  if (options.emitModelEvent !== false) {
    emitActiveModel(activeEntry);
  } else if (typeof window !== "undefined") {
    window.__lastWupModel = { model, label: activeEntry.label };
  }

  return true;
}

function getActiveEntry() {
  return appState.entries.find(entry => entry?.id === appState.activeId) ?? null;
}

function emitCollectionEvent() {
  if (typeof document === "undefined") {
    return;
  }
  document.dispatchEvent(
    new CustomEvent("wup:collection", {
      detail: {
        entries: appState.entries,
        activeId: appState.activeId
      }
    })
  );
}

function emitActiveModel(entry) {
  if (!entry?.model) {
    return;
  }

  if (typeof window !== "undefined") {
    window.__lastWupModel = { model: entry.model, label: entry.label };
  }

  if (typeof document !== "undefined") {
    document.dispatchEvent(
      new CustomEvent("wup:model", {
        detail: {
          id: entry.id,
          model: entry.model,
          label: entry.label
        }
      })
    );
  }
}

function renderLoadedWupList() {
  if (!loadedWupListEl) {
    return;
  }

  loadedWupListEl.innerHTML = "";
  if (appState.entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "loaded-wup-empty";
    empty.textContent = "No WUPs loaded.";
    loadedWupListEl.appendChild(empty);
    return;
  }

  appState.entries.forEach(entry => {
    const item = document.createElement("li");
    item.className = "loaded-wup-item";
    if (entry.id === appState.activeId) {
      item.classList.add("active");
    }
    if (!entry.model) {
      item.classList.add("error");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "loaded-wup-button";
    button.disabled = !entry.model;
    button.title = entry.label;
    if (entry.id === appState.activeId) {
      button.setAttribute("aria-current", "true");
    }

    const marker = document.createElement("span");
    marker.className = "loaded-wup-marker";
    marker.textContent = entry.model ? "•" : "!";

    const name = document.createElement("span");
    name.className = "loaded-wup-name";
    name.textContent = formatListLabel(entry);

    button.addEventListener("click", () => {
      setActiveWupById(entry.id, { promptIfDirty: true });
    });

    button.append(marker, name);
    item.appendChild(button);

    loadedWupListEl.appendChild(item);
  });
}

function initializeSessionApi() {
  if (typeof window === "undefined") {
    return;
  }

  window.__wupSession = {
    getEntries: () => appState.entries,
    getActiveId: () => appState.activeId,
    getActiveEntry,
    setActiveById: id => setActiveWupById(id, { promptIfDirty: true }),
    updateActiveModel
  };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Unknown file read error"));
    reader.onload = e => resolve(e.target.result);
    reader.readAsText(file);
  });
}

function buildFileLabel(file) {
  return file.name ?? "model.wup";
}

function formatListLabel(entry) {
  return typeof entry?.label === "string" ? entry.label : "model.wup";
}

function hasUnsavedEditorChanges() {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(window.__editorController?.state?.dirty);
}

function confirmDiscardUnsavedChanges(actionLabel) {
  if (typeof window === "undefined") {
    return true;
  }
  if (!hasUnsavedEditorChanges()) {
    return true;
  }
  return window.confirm(
    `You have unsaved editor changes on the current WUP. Continue and discard them to ${actionLabel}?`
  );
}

function resetInputs() {
  if (fileInput) {
    fileInput.value = "";
  }
  if (directoryInput) {
    directoryInput.value = "";
  }
}

function reportModelStats(model, label) {
  if (!model) {
    return;
  }
  const studCount = model.studs?.length ?? 0;
  const blockingCount = model.blocking?.length ?? 0;
  const plateCount = model.plates?.length ?? 0;
  const sheathingCount = model.sheathing?.length ?? 0;
  const nailRowCount = model.nailRows?.length ?? 0;
  const boyCount = model.boyOperations?.length ?? 0;
  const pafCount = model.pafRoutings?.length ?? 0;
  const wallWidth = model.wall?.width ? model.wall.width.toFixed(0) : "?";
  const wallHeight = model.wall?.height ? model.wall.height.toFixed(0) : "?";
  reportInfo(
    `Viewing ${label} — studs: ${studCount}, blocking: ${blockingCount}, plates: ${plateCount}, sheathing: ${sheathingCount}, nail rows: ${nailRowCount}, BOY ops: ${boyCount}, PAF routings: ${pafCount}, wall: ${wallWidth}×${wallHeight} mm`
  );
}

function reportInfo(message) {
  persistentStatus = {
    message,
    isError: false
  };
  applyStatus(message, false);
}

function reportError(message) {
  persistentStatus = {
    message,
    isError: true
  };
  applyStatus(message, true);
  console.error(message);
}

function showViewToast(message, durationMs = 1100) {
  if (!viewToastEl || typeof message !== "string" || message.length === 0) {
    return;
  }
  clearToastTimer();
  viewToastEl.textContent = message;
  viewToastEl.classList.add("show");
  toastHideTimer = globalThis.setTimeout(() => {
    toastHideTimer = null;
    viewToastEl.classList.remove("show");
  }, durationMs);
}

function applyStatus(message, isError) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function clearToastTimer() {
  if (toastHideTimer !== null) {
    globalThis.clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }
}
