import { parseWup, normalizeModel } from "./wup-parser.js";

let statusEl = null;
let fileInput = null;

if (typeof document !== "undefined") {
  statusEl = document.getElementById("status");
  fileInput = document.getElementById("wupFile");
  const toggleMenuBtn = document.getElementById("toggleMenu");
  const uiOverlay = document.querySelector(".ui-overlay");

  if (fileInput) {
    fileInput.addEventListener("change", event => {
      const [file] = event.target.files;
      if (!file) {
        return;
      }
      readFileAsText(file)
        .then(text => handleWupText(text, file.name))
        .catch(err => reportError(`Unable to read ${file.name}: ${err.message}`));
    });
  }

  if (toggleMenuBtn && uiOverlay) {
    toggleMenuBtn.addEventListener("click", () => {
      uiOverlay.classList.toggle("hidden");
      toggleMenuBtn.textContent = uiOverlay.classList.contains("hidden") ? "+" : "−";
      toggleMenuBtn.title = uiOverlay.classList.contains("hidden") ? "Show menu" : "Hide menu";
    });
  }
}

function handleWupText(text, label) {
  try {
    const model = parseWup(text);
    const renderedModel = normalizeModel(model);
    if (typeof document !== "undefined") {
      document.dispatchEvent(
        new CustomEvent("wup:model", {
          detail: {
            model: renderedModel,
            label
          }
        })
      );
    }
    if (typeof window !== "undefined") {
      window.__lastWupModel = { model: renderedModel, label };
    }
    const studCount = model.studs.length;
    const blockingCount = model.blocking.length;
    const plateCount = model.plates.length;
    const sheathingCount = model.sheathing.length;
    const nailRowCount = model.nailRows.length;
    const boyCount = model.boyOperations?.length ?? 0;
    const pafCount = model.pafRoutings?.length ?? 0;
    const wallWidth = model.wall?.width ? model.wall.width.toFixed(0) : "?";
    const wallHeight = model.wall?.height ? model.wall.height.toFixed(0) : "?";
    reportInfo(
      `Loaded ${label} — studs: ${studCount}, blocking: ${blockingCount}, plates: ${plateCount}, sheathing: ${sheathingCount}, nail rows: ${nailRowCount}, BOY ops: ${boyCount}, PAF routings: ${pafCount}, wall: ${wallWidth}×${wallHeight} mm`
    );
  } catch (err) {
    reportError(`Failed to parse ${label}: ${err.message}`);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Unknown file read error"));
    reader.onload = e => resolve(e.target.result);
    reader.readAsText(file);
  });
}

function reportInfo(message) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.remove("error");
  }
}

function reportError(message) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.add("error");
  }
  console.error(message);
}
