import { EditorMode } from "../state/editor-state.js";

const VALID_AXIS = new Set(["x", "y", "z"]);

export class TranslateCommand {
  constructor({ state, selection, controller }) {
    this.state = state;
    this.selection = selection;
    this.controller = controller;
    this.axis = null;
    this.input = "";
    this.name = "translate";
  }

  begin() {
    this.axis = null;
    this.input = "";
    if (!this.selection.getSelection().length) {
      this.controller.showHudMessage("Select one or more items to move (press G).");
      return false;
    }
    this.state.setActiveCommand(this);
    this.state.setPendingCommand({ name: this.name, axis: null, value: null });
    this.state.setMode(EditorMode.CommandPending);
    this.controller.beginTranslatePreview();
    return true;
  }

  setAxis(axis) {
    if (!VALID_AXIS.has(axis)) {
      return;
    }
    if (this.axis !== axis) {
      this.input = "";
    }
    this.axis = axis;
    this.state.setPendingCommand({ name: this.name, axis, value: null });
    this.state.setMode(EditorMode.NumericInput);
    this.controller.updateTranslateHud({ axis, input: this.input });
    this.controller.updateTranslatePreview({ axis, value: this.getValue() });
  }

  appendInput(char) {
    if (!this.axis) {
      return;
    }
    if (char === "-" && this.input.length > 0) {
      return;
    }
    if (char === "-" && this.input.length === 0) {
      this.input = "-";
    } else if (char === ".") {
      if (this.input.includes(".")) {
        return;
      }
      if (this.input.length === 0) {
        this.input = "0.";
      } else if (this.input === "-") {
        this.input = "-0.";
      } else {
        this.input += char;
      }
    } else if (/\d/.test(char)) {
      this.input += char;
    }
    this.state.setPendingCommand({ name: this.name, axis: this.axis, value: this.getValue() });
    this.controller.updateTranslateHud({ axis: this.axis, input: this.input });
    this.controller.updateTranslatePreview({ axis: this.axis, value: this.getValue() });
  }

  removeInput() {
    if (!this.axis || this.input.length === 0) {
      return;
    }
    this.input = this.input.slice(0, -1);
    this.state.setPendingCommand({ name: this.name, axis: this.axis, value: this.getValue() });
    this.controller.updateTranslateHud({ axis: this.axis, input: this.input });
    this.controller.updateTranslatePreview({ axis: this.axis, value: this.getValue() });
  }

  getValue() {
    const parsed = Number.parseFloat(this.input);
    return Number.isFinite(parsed) ? parsed : null;
  }

  confirm() {
    const value = this.getValue();
    if (!this.axis || !Number.isFinite(value)) {
      this.controller.showHudMessage("Enter a numeric distance in mm, then press Enter.");
      return;
    }
    this.controller.applyTranslation({ axis: this.axis, value });
  }

  cancel() {
    this.controller.cancelActiveCommand();
  }

  handleKey(event) {
    const key = event.key;
    if (!this.axis && VALID_AXIS.has(key.toLowerCase())) {
      this.setAxis(key.toLowerCase());
      return true;
    }
    switch (key) {
      case "Enter":
        this.confirm();
        return true;
      case "Escape":
        this.cancel();
        return true;
      case "Backspace":
        this.removeInput();
        return true;
      default:
        if (/[-0-9.]/.test(key)) {
          this.appendInput(key);
          return true;
        }
        if (VALID_AXIS.has(key.toLowerCase())) {
          this.setAxis(key.toLowerCase());
          return true;
        }
        return false;
    }
  }
}
