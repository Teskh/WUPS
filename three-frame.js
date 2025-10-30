import { FrameViewer } from "./viewer/frame-viewer.js";

const canvas = document.getElementById("threeCanvas");
const tooltip = document.getElementById("threeTooltip");

if (!canvas) {
  throw new Error("threeCanvas element missing from document");
}

const viewer = new FrameViewer({ canvas, tooltip });

if (typeof window !== "undefined") {
  window.__frameViewer = viewer;
}

const initialModel = window.__lastWupModel;
if (initialModel?.model) {
  viewer.updateModel(initialModel.model);
}

document.addEventListener("wup:model", event => {
  viewer.updateModel(event.detail.model);
});
