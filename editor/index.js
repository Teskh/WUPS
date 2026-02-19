// Entry point to attach the editor to an existing FrameViewer.
// This is a scaffold only; no behavior is implemented yet.

import { EditorController } from "./editor-controller.js";

/**
 * Creates an editor controller bound to a viewer.
 * @param {import('../viewer/frame-viewer.js').FrameViewer} viewer
 * @param {object} [options]
 * @returns {EditorController}
 */
export function attachEditor(viewer, options = {}) {
  const controller = new EditorController(viewer, options);
  return controller;
}

export { EditorController } from "./editor-controller.js";

