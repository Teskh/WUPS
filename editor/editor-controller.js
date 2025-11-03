// High-level editor orchestrator.
// Manages editor state, selection, commands, overlays, HUD, and persistence.

import { EditorState, EditorMode } from "./state/editor-state.js";
import { SelectionManager } from "./selection/selection-manager.js";
import { CommandRegistry } from "./commands/command-registry.js";
import { OverlayManager } from "./overlays/overlay-manager.js";
import { Keymap } from "./ui/keymap.js";
import { createEditControls } from "./ui/edit-controls.js";
import { createHud } from "./ui/hud.js";
import { DeleteCommand } from "./commands/delete.js";
import { TranslateCommand } from "./commands/move-translate.js";
import { saveAsModified } from "./io/save.js";

const KIND_TO_COLLECTION = {
  nailRow: "nailRows",
  boy: "boyOperations",
  paf: "pafRoutings"
};

function cloneModel(model) {
  if (typeof structuredClone === "function") {
    return structuredClone(model);
  }
  return JSON.parse(JSON.stringify(model));
}

function uniqueByReference(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const fixed = value.toFixed(3);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1").replace(/\.0$/, "");
}

function ensureModelMetadata(model) {
  if (!model || typeof model !== "object") {
    return;
  }
  if (!Array.isArray(model.__statements)) {
    model.__statements = [];
  }
  if (typeof model.__nextEditorId !== "number") {
    model.__nextEditorId = 1;
  }
  const assignId = element => {
    if (!element || typeof element !== "object") {
      return;
    }
    if (typeof element.__editorId !== "number") {
      element.__editorId = model.__nextEditorId;
      model.__nextEditorId += 1;
    }
  };
  for (const row of model.nailRows ?? []) {
    assignId(row);
  }
  for (const op of model.boyOperations ?? []) {
    assignId(op);
  }
  for (const routing of model.pafRoutings ?? []) {
    assignId(routing);
  }
}

function buildStatement(command, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return command;
  }
  const parts = values.map(formatNumber);
  return `${command} ${parts.join(",")}`;
}

function buildNailRowStatement(row) {
  return buildStatement(row.__command ?? "NR", row.source ?? []);
}

function buildBoyStatement(operation) {
  return buildStatement(operation.__command ?? "BOY", operation.source ?? []);
}

function buildPafStatement(routing) {
  const command = routing.__command ?? "PAF";
  const lines = [];

  // Build PAF header line with parameters
  if (Array.isArray(routing.source) && routing.source.length > 0) {
    lines.push(buildStatement(command, routing.source));
  } else {
    lines.push(command);
  }

  // Build polygon point lines (PP, KB, MP) from each segment
  if (Array.isArray(routing.segments)) {
    for (const segment of routing.segments) {
      if (!segment) {
        continue;
      }

      // Handle MP (circle) segments - source is a direct numbers array
      if (segment.position && Array.isArray(segment.source)) {
        lines.push(buildStatement("MP", segment.source));
      }
      // Handle PP/KB (polygon/polyline) segments - source is array of {command, numbers, type}
      else if (Array.isArray(segment.source)) {
        for (const sourceEntry of segment.source) {
          if (sourceEntry && sourceEntry.command && Array.isArray(sourceEntry.numbers)) {
            let line = buildStatement(sourceEntry.command, sourceEntry.numbers);
            // For KB commands, we need to preserve the arc type token
            if (sourceEntry.command === "KB" && sourceEntry.type) {
              // Replace the 4th parameter with the original type token
              const parts = sourceEntry.numbers.map(formatNumber);
              if (parts.length >= 4) {
                parts[3] = sourceEntry.type;
              }
              line = `${sourceEntry.command} ${parts.join(",")}`;
            }
            lines.push(line);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

function ensureStatementArray(model) {
  ensureModelMetadata(model);
  return model.__statements;
}

export class EditorController {
  /**
   * @param {import('../viewer/frame-viewer.js').FrameViewer} viewer
   * @param {object} [options]
   */
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.options = options;
    this.canvas = viewer?.canvas ?? null;

    this.state = new EditorState();
    this.selection = new SelectionManager({ viewer, state: this.state });
    this.commands = new CommandRegistry({
      viewer,
      state: this.state,
      selection: this.selection,
      controller: this
    });
    this.overlays = new OverlayManager({ viewer });
    this.keymap = new Keymap({
      viewer,
      state: this.state,
      selection: this.selection,
      commands: this.commands,
      controller: this
    });

    // Set up viewer hotkey blocking for editor modes that need keyboard input
    if (this.viewer) {
      this.viewer.shouldBlockViewerHotkeys = () => {
        return this.state.mode === EditorMode.NumericInput ||
               this.state.mode === EditorMode.CommandPending;
      };
    }

    this.commands.register("delete", DeleteCommand);
    this.commands.register("translate", TranslateCommand);

    this.originalModel = null;
    this.workingModel = null;
    this.originalLabel = null;
    this.originalText = null;
    this.hud = typeof document !== "undefined" ? createHud() : null;
    this.controls = null;
    this.activeCommand = null;
    this.workingStatements = [];

    this.selection.onChange(selection => {
      this.overlays.setSelection(selection);
      this.updateSelectionHud(selection);
      if (this.controls?.updateSelectionCount) {
        this.controls.updateSelectionCount(selection.length);
      }
    });

    this.state.on("groups", () => {
      this.pruneSelectionByGroup();
    });

    this.state.on("hud", message => {
      if (this.hud) {
        this.hud.setMessage(message);
      }
    });

    this.handleCanvasClick = this.handleCanvasClick.bind(this);
    this.handleModelEvent = this.handleModelEvent.bind(this);

    if (typeof document !== "undefined") {
      document.addEventListener("wup:model", this.handleModelEvent);
    }

    if (typeof document !== "undefined") {
      const container =
        options.controlsContainer ?? document.querySelector(".controls");
      this.controls = createEditControls({
        container,
        state: this.state,
        selection: this.selection,
        controller: this
      });
    }

    const initialModel = viewer.getCurrentModel?.();
    if (initialModel) {
      const fallbackLabel =
        options.initialLabel ?? (typeof window !== "undefined" ? window.__lastWupModel?.label : null);
      this.setModel(initialModel, fallbackLabel ?? "model.wup");
    }
  }

  destroy() {
    this.disable();
    if (typeof document !== "undefined") {
      document.removeEventListener("wup:model", this.handleModelEvent);
    }
    if (this.controls?.cleanup) {
      this.controls.cleanup();
    }
    if (this.hud?.destroy) {
      this.hud.destroy();
    }
    // Clean up viewer hotkey blocking callback
    if (this.viewer && this.viewer.shouldBlockViewerHotkeys) {
      this.viewer.shouldBlockViewerHotkeys = null;
    }
  }

  setModel(model, label) {
    if (!model) {
      return;
    }
    const original = cloneModel(model);
    ensureModelMetadata(original);
    this.originalModel = original;
    this.originalLabel = label ?? "model.wup";
    this.originalText = original.__sourceText ?? null;

    const working = cloneModel(original);
    ensureModelMetadata(working);
    this.workingModel = working;
    this.workingStatements = ensureStatementArray(working);

    this.state.setDirty(false);
    this.selection.clear();
    this.overlays.clearAll();
    this.showHudMessage("Loaded model ready for editing.");

    this.viewer.updateModel(cloneModel(this.workingModel));
  }

  handleModelEvent(event) {
    const detail = event?.detail;
    if (!detail?.model) {
      return;
    }
    this.setModel(detail.model, detail.label ?? this.originalLabel);
  }

  enable() {
    if (this.state.enabled) {
      return;
    }
    this.state.setEnabled(true);
    if (this.canvas) {
      this.canvas.addEventListener("click", this.handleCanvasClick);
    }
    this.keymap.attach();
    this.showHudMessage("Edit mode enabled — click to select, press G to move, Delete to remove.");
    if (this.controls?.setEnabled) {
      this.controls.setEnabled(true);
    }
  }

  disable() {
    if (!this.state.enabled) {
      return;
    }
    if (this.canvas) {
      this.canvas.removeEventListener("click", this.handleCanvasClick);
    }
    this.keymap.detach();
    this.cancelActiveCommand();
    this.selection.clear();
    this.overlays.clearAll();
    this.state.setEnabled(false);
    this.showHudMessage("Edit mode disabled.");
    if (this.controls?.setEnabled) {
      this.controls.setEnabled(false);
    }
  }

  handleCanvasClick(event) {
    if (!this.state.enabled) {
      return;
    }
    const hit = this.viewer.pickObjectAt(event.clientX, event.clientY);
    if (!hit) {
      if (!event.shiftKey && !event.metaKey) {
        this.selection.clear();
      }
      return;
    }
    if (event.shiftKey || event.metaKey) {
      this.selection.toggle(hit);
    } else {
      this.selection.replace(hit, false);
    }
  }

  pruneSelectionByGroup() {
    const filtered = this.selection
      .getSelection()
      .filter(object => this.selection.isSelectable(object));
    if (filtered.length !== this.selection.getSelection().length) {
      this.selection.set(filtered);
    }
  }

  updateSelectionHud(selection) {
    if (!selection.length) {
      this.showHudMessage("No items selected.");
      return;
    }
    const kinds = uniqueByReference(selection.map(obj => obj.userData?.kind ?? "unknown"));
    this.showHudMessage(`Selected ${selection.length} item${selection.length === 1 ? "" : "s"} (${kinds.join(", ")}).`);
  }

  showHudMessage(message) {
    this.state.setHudMessage(message ?? "");
  }

  cancelActiveCommand() {
    if (this.activeCommand?.cleanup) {
      try {
        this.activeCommand.cleanup();
      } catch (err) {
        console.error("Editor command cleanup error", err);
      }
    }
    this.activeCommand = null;
    this.state.setActiveCommand(null);
    this.state.setPendingCommand(null);
    this.state.setMode(this.state.enabled ? EditorMode.Idle : EditorMode.Disabled);
    if (typeof this.overlays.clearCommandLayers === "function") {
      this.overlays.clearCommandLayers();
    }
  }

  startTranslateCommand() {
    const command = this.commands.create("translate");
    if (command && command.begin()) {
      this.activeCommand = command;
      this.showHudMessage("Translate — press X, Y, or Z to pick an axis.");
    }
  }

  beginTranslatePreview() {
    const selection = this.selection.getSelection();
    if (selection.length) {
      this.overlays.showOldState(selection);
      this.overlays.showNewState(selection, { x: 0, y: 0, z: 0 });
    }
  }

  updateTranslateHud({ axis, input }) {
    if (!axis) {
      this.showHudMessage("Translate — press X, Y, or Z to pick an axis.");
      return;
    }
    const label = input ? `${input} mm` : "type distance";
    this.showHudMessage(`Translate along ${axis.toUpperCase()} — ${label}, Enter to apply, Esc to cancel.`);
  }

  updateTranslatePreview({ axis, value }) {
    const selection = this.selection.getSelection();
    if (!selection.length) {
      return;
    }
    const scale = this.viewer.getScale?.() ?? 1;
    const wallDir = this.viewer.getWallDirection?.() ?? 1;
    const mm = Number.isFinite(value) ? value : 0;
    let translation = { x: 0, y: 0, z: 0 };
    if (axis === "x") {
      translation = { x: mm * scale, y: 0, z: 0 };
    } else if (axis === "y") {
      translation = { x: 0, y: mm * scale, z: 0 };
    } else if (axis === "z") {
      translation = { x: 0, y: 0, z: mm * scale * (wallDir >= 0 ? 1 : -1) };
    }
    this.overlays.showNewState(selection, translation);
  }

  applyTranslation({ axis, value }) {
    if (!this.workingModel) {
      return;
    }
    const mm = Number(value);
    if (!Number.isFinite(mm) || mm === 0) {
      this.showHudMessage("Enter a non-zero distance in millimetres.");
      return;
    }
    const selection = this.selection.getSelection();
    if (!selection.length) {
      this.showHudMessage("Select one or more items to translate.");
      return;
    }
    const translated = this.translateModelElements(selection, axis, mm);
    if (translated === 0) {
      this.showHudMessage("No selected items support translation along that axis.");
      return;
    }
    this.recalculateBounds();
    this.refreshViewer();
    this.selection.clear();
    this.cancelActiveCommand();
    this.state.setDirty(true);
    this.showHudMessage(`Moved ${translated} item${translated === 1 ? "" : "s"} ${mm} mm along ${axis.toUpperCase()}.`);
  }

  translateModelElements(selection, axis, mm) {
    let count = 0;
    for (const object of selection) {
      const resolved = this.resolveWorkingElement(object);
      if (!resolved) {
        continue;
      }
      if (resolved.kind === "nailRow") {
        const updated = this.translateNailRow(resolved.item, axis, mm);
        if (updated) {
          count += 1;
        }
      } else if (resolved.kind === "boy") {
        const updated = this.translateBoyOperation(resolved.item, axis, mm);
        if (updated) {
          count += 1;
        }
      } else if (resolved.kind === "paf") {
        const updated = this.translatePafRouting(resolved.item, axis, mm);
        if (updated) {
          count += 1;
        }
      }
    }
    return count;
  }

  translateNailRow(row, axis, mm) {
    if (!row || typeof row !== "object") {
      return false;
    }
    if (!Array.isArray(row.source) || row.source.length < 4) {
      return false;
    }
    if (axis === "x") {
      row.start.x += mm;
      row.end.x += mm;
      row.source[0] = Number.isFinite(row.source[0]) ? row.source[0] + mm : row.start.x;
      row.source[2] = Number.isFinite(row.source[2]) ? row.source[2] + mm : row.end.x;
    } else if (axis === "y") {
      row.start.y += mm;
      row.end.y += mm;
      row.source[1] = Number.isFinite(row.source[1]) ? row.source[1] + mm : row.start.y;
      row.source[3] = Number.isFinite(row.source[3]) ? row.source[3] + mm : row.end.y;
    } else {
      return false;
    }
    this.setStatementText(row.__statementIndex, buildNailRowStatement(row));
    return true;
  }

  translateBoyOperation(operation, axis, mm) {
    if (!operation || typeof operation !== "object") {
      return false;
    }
    if (!Array.isArray(operation.source) || operation.source.length < 2) {
      return false;
    }
    if (axis === "x") {
      operation.x += mm;
      operation.source[0] = Number.isFinite(operation.source[0])
        ? operation.source[0] + mm
        : operation.x;
      if (Number.isFinite(operation.localX)) {
        operation.localX += mm;
      }
    } else if (axis === "z") {
      operation.z += mm;
      operation.source[1] = Number.isFinite(operation.source[1])
        ? operation.source[1] + mm
        : operation.z;
      if (Number.isFinite(operation.localZ)) {
        operation.localZ += mm;
      }
    } else {
      return false;
    }
    this.setStatementText(operation.__statementIndex, buildBoyStatement(operation));
    return true;
  }

  translatePafRouting(routing, axis, mm) {
    if (!routing || typeof routing !== "object") {
      return false;
    }
    if (!Array.isArray(routing.segments) || routing.segments.length === 0) {
      return false;
    }
    if (axis !== "x" && axis !== "y") {
      return false;
    }

    let pointsModified = false;
    const axisIndex = axis === "x" ? 0 : 1;

    for (const segment of routing.segments) {
      if (!segment || typeof segment !== "object") {
        continue;
      }

      // Handle circle segments (MP) - have position instead of points
      if (segment.position && typeof segment.position === "object") {
        if (axis === "x" && Number.isFinite(segment.position.x)) {
          segment.position.x += mm;
          if (Array.isArray(segment.source) && segment.source.length > 0) {
            segment.source[0] = Number.isFinite(segment.source[0]) ? segment.source[0] + mm : segment.position.x;
          }
          pointsModified = true;
        } else if (axis === "y" && Number.isFinite(segment.position.y)) {
          segment.position.y += mm;
          if (Array.isArray(segment.source) && segment.source.length > 1) {
            segment.source[1] = Number.isFinite(segment.source[1]) ? segment.source[1] + mm : segment.position.y;
          }
          pointsModified = true;
        }
      }

      // Handle polygon/polyline segments (PP/KB) - have points array
      if (Array.isArray(segment.points)) {
        for (const point of segment.points) {
          if (point && typeof point === "object") {
            if (axis === "x" && Number.isFinite(point.x)) {
              point.x += mm;
              pointsModified = true;
            } else if (axis === "y" && Number.isFinite(point.y)) {
              point.y += mm;
              pointsModified = true;
            }
          }
        }

        // Update pathSegments (used for rendering)
        if (Array.isArray(segment.pathSegments)) {
          for (const pathSeg of segment.pathSegments) {
            if (!pathSeg || typeof pathSeg !== "object") {
              continue;
            }
            if (pathSeg.from && typeof pathSeg.from === "object") {
              if (axis === "x" && Number.isFinite(pathSeg.from.x)) {
                pathSeg.from.x += mm;
              } else if (axis === "y" && Number.isFinite(pathSeg.from.y)) {
                pathSeg.from.y += mm;
              }
            }
            if (pathSeg.to && typeof pathSeg.to === "object") {
              if (axis === "x" && Number.isFinite(pathSeg.to.x)) {
                pathSeg.to.x += mm;
              } else if (axis === "y" && Number.isFinite(pathSeg.to.y)) {
                pathSeg.to.y += mm;
              }
            }
            if (pathSeg.center && typeof pathSeg.center === "object") {
              if (axis === "x" && Number.isFinite(pathSeg.center.x)) {
                pathSeg.center.x += mm;
              } else if (axis === "y" && Number.isFinite(pathSeg.center.y)) {
                pathSeg.center.y += mm;
              }
            }
          }
        }

        // Update source records (PP/KB statements) - only for polygon/polyline segments
        if (Array.isArray(segment.source)) {
          for (const sourceEntry of segment.source) {
            if (sourceEntry && Array.isArray(sourceEntry.numbers) && sourceEntry.numbers.length > axisIndex) {
              if (Number.isFinite(sourceEntry.numbers[axisIndex])) {
                sourceEntry.numbers[axisIndex] += mm;
              }
            }
          }
        }
      }
    }

    if (pointsModified) {
      this.setStatementText(routing.__statementIndex, buildPafStatement(routing));
    }

    return pointsModified;
  }

  startDeleteCommand() {
    const command = this.commands.create("delete");
    if (command && command.begin()) {
      this.activeCommand = command;
      const total = this.selection.getSelection().length;
      this.showHudMessage(`Delete ${total} selected item${total === 1 ? "" : "s"}? Press Enter to confirm or Esc to cancel.`);
    }
  }

  showDeletePreview(selection) {
    this.overlays.showOldState(selection);
    if (typeof this.overlays.clearNewState === "function") {
      this.overlays.clearNewState();
    }
  }

  applyDeletion() {
    if (!this.workingModel) {
      this.cancelActiveCommand();
      return;
    }
    const selection = this.selection.getSelection();
    if (!selection.length) {
      this.cancelActiveCommand();
      return;
    }
    const removed = this.removeModelElements(selection);
    this.recalculateBounds();
    this.refreshViewer();
    this.selection.clear();
    this.cancelActiveCommand();
    this.state.setDirty(true);
    this.showHudMessage(`Deleted ${removed} item${removed === 1 ? "" : "s"}.`);
  }

  removeModelElements(selection) {
    let removed = 0;
    for (const object of selection) {
      const resolved = this.resolveWorkingElement(object);
      if (!resolved) {
        continue;
      }
      const collection = this.workingModel[resolved.collection];
      const index = collection.indexOf(resolved.item);
      if (index >= 0) {
        collection.splice(index, 1);
        this.setStatementText(resolved.item.__statementIndex, null);
        removed += 1;
      }
    }
    return removed;
  }

  resolveWorkingElement(object) {
    if (!object || !this.workingModel) {
      return null;
    }
    const kind = object.userData?.kind;
    const id = object.userData?.editorId;
    const collectionName = KIND_TO_COLLECTION[kind];
    if (!collectionName || typeof id !== "number") {
      return null;
    }
    const collection = this.workingModel[collectionName];
    if (!Array.isArray(collection)) {
      return null;
    }
    const item = collection.find(entry => entry?.__editorId === id);
    if (!item) {
      return null;
    }
    return { kind, collection: collectionName, item };
  }

  setStatementText(index, text) {
    if (!Array.isArray(this.workingStatements) || !Number.isInteger(index) || index < 0) {
      return;
    }
    this.workingStatements[index] = text;
  }

  recalculateBounds() {
    if (!this.workingModel) {
      return;
    }
    const bounds = {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    };

    const considerRect = (x, y, width, height) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x + width);
      bounds.maxY = Math.max(bounds.maxY, y + height);
    };

    const considerPoint = (x, y) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    };

    for (const rect of this.workingModel.studs ?? []) {
      considerRect(rect.x, rect.y, rect.width, rect.height);
    }
    for (const rect of this.workingModel.blocking ?? []) {
      considerRect(rect.x, rect.y, rect.width, rect.height);
    }
    for (const rect of this.workingModel.plates ?? []) {
      considerRect(rect.x, rect.y, rect.width, rect.height);
    }
    for (const panel of this.workingModel.sheathing ?? []) {
      considerRect(panel.x, panel.y, panel.width, panel.height);
      for (const point of panel.points ?? []) {
        if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
          considerPoint(point.x, point.y);
        }
      }
    }
    for (const row of this.workingModel.nailRows ?? []) {
      considerPoint(row.start?.x ?? 0, row.start?.y ?? 0);
      considerPoint(row.end?.x ?? 0, row.end?.y ?? 0);
    }
    for (const op of this.workingModel.boyOperations ?? []) {
      considerPoint(op.x ?? 0, op.z ?? 0);
    }

    if (!Number.isFinite(bounds.minX)) {
      bounds.minX = 0;
      bounds.minY = 0;
      bounds.maxX = 0;
      bounds.maxY = 0;
    }
    this.workingModel.bounds = bounds;
  }

  refreshViewer() {
    if (!this.workingModel) {
      return;
    }
    this.viewer.updateModel(cloneModel(this.workingModel), { maintainCamera: true });
  }

  saveModified() {
    if (!this.workingModel) {
      this.showHudMessage("Nothing to save yet.");
      return;
    }
    const result = saveAsModified(this.workingModel, this.originalLabel ?? "model.wup");
    if (result?.filename) {
      this.showHudMessage(`Saved ${result.filename}.`);
    } else {
      this.showHudMessage("Saved modified copy.");
    }
  }
}
