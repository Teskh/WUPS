// Overlay manager (scaffold).
// Responsible for old/new/preview outlines and ghost geometry.

import * as THREE from "three";
import { OverlayColors } from "./outline-materials.js";

function createBoxHelper(object, colorHex, translation) {
  if (!object) {
    return null;
  }
  if (typeof object.updateWorldMatrix === "function") {
    object.updateWorldMatrix(true, true);
  }
  const box = new THREE.Box3();
  box.setFromObject(object);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    return null;
  }
  if (translation) {
    box.translate(translation);
  }
  // Expand very thin boxes slightly so outlines remain visible.
  const epsilon = 0.001;
  box.expandByScalar(epsilon);
  const helper = new THREE.Box3Helper(box, colorHex);
  const material = helper.material;
  if (material) {
    material.depthTest = false;
    material.transparent = true;
    material.opacity = 0.9;
  }
  helper.renderOrder = 2000;
  return helper;
}

export class OverlayManager {
  constructor({ viewer }) {
    this.viewer = viewer;
    this.layers = {
      selection: [],
      old: [],
      new: []
    };
  }

  _clearLayer(key) {
    const group = this.layers[key] ?? [];
    for (const helper of group) {
      this.viewer.removeEditorOverlay(helper);
      if (helper.geometry) {
        helper.geometry.dispose?.();
      }
      if (helper.material) {
        helper.material.dispose?.();
      }
    }
    this.layers[key] = [];
  }

  clearAll() {
    for (const key of Object.keys(this.layers)) {
      this._clearLayer(key);
    }
    this.viewer.requestRender();
  }

  clearSelection() {
    this._clearLayer("selection");
  }

  setSelection(objects) {
    this._clearLayer("selection");
    if (!Array.isArray(objects) || objects.length === 0) {
      return;
    }
    const helpers = [];
    for (const object of objects) {
      const helper = createBoxHelper(object, OverlayColors.new, null);
      if (!helper) {
        continue;
      }
      helpers.push(helper);
      this.viewer.addEditorOverlay(helper);
    }
    this.layers.selection = helpers;
  }

  showOldState(objects) {
    this._clearLayer("old");
    if (!Array.isArray(objects) || objects.length === 0) {
      return;
    }
    const helpers = [];
    for (const object of objects) {
      const helper = createBoxHelper(object, OverlayColors.old, null);
      if (!helper) {
        continue;
      }
      helpers.push(helper);
      this.viewer.addEditorOverlay(helper);
    }
    this.layers.old = helpers;
  }

  showNewState(objects, translationVector) {
    this._clearLayer("new");
    if (!Array.isArray(objects) || objects.length === 0) {
      return;
    }
    const helpers = [];
    const translation = translationVector
      ? new THREE.Vector3(translationVector.x, translationVector.y, translationVector.z)
      : null;
    for (const object of objects) {
      const helper = createBoxHelper(object, OverlayColors.new, translation);
      if (!helper) {
        continue;
      }
      helpers.push(helper);
      this.viewer.addEditorOverlay(helper);
    }
    this.layers.new = helpers;
  }

  clearCommandLayers() {
    this._clearLayer("old");
    this._clearLayer("new");
  }

  clearNewState() {
    this._clearLayer("new");
  }
}
