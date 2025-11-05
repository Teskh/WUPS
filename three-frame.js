import { FrameViewer } from "./viewer/frame-viewer.js";
import { setupLayerControls } from "./viewer/layer-controls.js";
import { attachEditor } from "./editor/index.js";

const canvas = document.getElementById("threeCanvas");
const tooltip = document.getElementById("threeTooltip");

if (!canvas) {
  throw new Error("threeCanvas element missing from document");
}

const viewer = new FrameViewer({ canvas, tooltip });

let editorController = null;
if (typeof window !== "undefined") {
  window.__frameViewer = viewer;
}

const projectionToggle = document.getElementById("toggleProjection");
if (projectionToggle) {
  const updateProjectionButton = mode => {
    if (mode === "orthographic") {
      projectionToggle.textContent = "Switch to perspective view";
      projectionToggle.setAttribute("aria-label", "Switch to perspective view");
    } else {
      projectionToggle.textContent = "Switch to orthographic view";
      projectionToggle.setAttribute("aria-label", "Switch to orthographic view");
    }
  };
  projectionToggle.addEventListener("click", () => {
    viewer.toggleProjectionMode();
  });
  viewer.onProjectionModeChange = mode => {
    updateProjectionButton(mode);
  };
  updateProjectionButton(viewer.getProjectionMode());
}

const layerControls = document.getElementById("layerControls");
setupLayerControls({ viewer, container: layerControls });

const controlsContainer = document.querySelector(".controls");
editorController = attachEditor(viewer, { controlsContainer });
if (typeof window !== "undefined") {
  window.__editorController = editorController;
}

const initialModel = window.__lastWupModel;
if (initialModel?.model) {
  viewer.updateModel(initialModel.model);
}

document.addEventListener("wup:model", event => {
  viewer.updateModel(event.detail.model);
});

document.addEventListener("diagnostics:zoomToBoy", event => {
  const { x, z } = event.detail;
  viewer.zoomToBoy(x, z);
});

document.addEventListener("diagnostics:zoomToNailRow", event => {
  viewer.zoomToNailRow(event.detail || null);
});

document.addEventListener("diagnostics:zoomToPosition", event => {
  const { x, y } = event.detail;
  viewer.zoomToPosition(x, y);
});
