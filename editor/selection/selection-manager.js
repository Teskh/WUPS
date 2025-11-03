// Selection management (scaffold).
// Keeps track of selected objects and enforces filter rules.

import { buildFilters } from "./filters.js";

export class SelectionManager {
  constructor({ viewer, state }) {
    this.viewer = viewer;
    this.state = state;
    this.filters = buildFilters();
    this.selected = new Set();
    this.listeners = new Set();
  }

  onChange(callback) {
    this.listeners.add(callback);
  }

  offChange(callback) {
    this.listeners.delete(callback);
  }

  emit() {
    const list = this.getSelection();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (err) {
        console.error("Selection listener error", err);
      }
    }
  }

  clear() {
    if (this.selected.size === 0) {
      return;
    }
    this.selected.clear();
    this.emit();
  }

  getSelection() {
    return Array.from(this.selected);
  }

  isSelectable(object) {
    if (!object?.userData?.kind) {
      return false;
    }
    const kind = object.userData.kind;
    if (!this.state.allowedKinds.has(kind)) {
      return false;
    }
    return this.filters.matches(object, this.state.allowedGroups);
  }

  toggle(object) {
    if (!this.isSelectable(object)) {
      return false;
    }
    let added = false;
    if (this.selected.has(object)) {
      this.selected.delete(object);
    } else {
      this.selected.add(object);
      added = true;
    }
    this.emit();
    return added;
  }

  replace(object, additive = false) {
    if (!this.isSelectable(object)) {
      if (!additive) {
        this.clear();
      }
      return false;
    }
    if (!additive) {
      this.selected.clear();
    }
    this.selected.add(object);
    this.emit();
    return true;
  }

  set(objects) {
    this.selected.clear();
    for (const obj of objects) {
      if (this.isSelectable(obj)) {
        this.selected.add(obj);
      }
    }
    this.emit();
  }
}

