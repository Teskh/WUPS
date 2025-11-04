import { EditorMode } from "../state/editor-state.js";

const VALID_AXIS = new Set(["x", "y", "z"]);
const MODE_OFFSET = "offset";
const MODE_ABSOLUTE = "absolute";

export class TranslateCommand {
  constructor({
    state,
    selection,
    controller,
    mode = MODE_OFFSET,
    initialAxis = null,
    originValue = null,
    label = null,
    initialInput = "",
    context = null
  }) {
    this.state = state;
    this.selection = selection;
    this.controller = controller;
    this.mode = mode === MODE_ABSOLUTE ? MODE_ABSOLUTE : MODE_OFFSET;
    this.axis = VALID_AXIS.has(initialAxis) ? initialAxis : null;
    this.originValue = Number.isFinite(originValue) ? originValue : null;
    this.label = typeof label === "string" && label.length ? label : null;
    this.initialInput = typeof initialInput === "string" ? initialInput : "";
    this.input = this.initialInput;
    this.context = context;
    this.name = "translate";
  }

  begin() {
    if (!this.selection.getSelection().length) {
      this.controller.showHudMessage("Select one or more items to move (press G).");
      return false;
    }
    this.state.setActiveCommand(this);
    this.state.setMode(this.axis ? EditorMode.NumericInput : EditorMode.CommandPending);
    this.controller.beginTranslatePreview();
    this.updateFeedback();
    return true;
  }

  setAxis(axis) {
    if (!VALID_AXIS.has(axis)) {
      return;
    }
    if (this.axis !== axis) {
      this.input = "";
      this.axis = axis;
    }
    if (this.mode === MODE_ABSOLUTE && !Number.isFinite(this.originValue)) {
      // Absolute edits require a baseline value; bail out gracefully.
      this.controller.showHudMessage("Cannot edit coordinate — original value missing.");
      return;
    }
    this.state.setPendingCommand({ name: this.name, axis, value: null });
    this.state.setMode(EditorMode.NumericInput);
    this.updateFeedback();
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
    this.updateFeedback();
  }

  removeInput() {
    if (!this.axis || this.input.length === 0) {
      return;
    }
    this.input = this.input.slice(0, -1);
    this.updateFeedback();
  }

  getValue() {
    const parsed = Number.parseFloat(this.input);
    return Number.isFinite(parsed) ? parsed : null;
  }

  getTranslationValue() {
    const value = this.getValue();
    if (!Number.isFinite(value)) {
      return null;
    }
    if (this.mode === MODE_ABSOLUTE) {
      if (!Number.isFinite(this.originValue)) {
        return null;
      }
      return value - this.originValue;
    }
    return value;
  }

  updateFeedback() {
    if (!this.state) {
      return;
    }
    if (!this.axis) {
      this.state.setPendingCommand({
        name: this.name,
        axis: null,
        value: null,
        mode: this.mode,
        context: this.context
      });
      this.controller.updateTranslateHud({
        axis: null,
        input: this.input,
        mode: this.mode,
        origin: this.originValue,
        label: this.label,
        rawValue: null,
        translationValue: null
      });
      return;
    }
    const rawValue = this.getValue();
    const translationValue = this.getTranslationValue();
    this.state.setPendingCommand({
      name: this.name,
      axis: this.axis,
      value: translationValue,
      mode: this.mode,
      rawValue,
      context: this.context
    });
    this.controller.updateTranslateHud({
      axis: this.axis,
      input: this.input,
      mode: this.mode,
      origin: this.originValue,
      label: this.label,
      rawValue,
      translationValue
    });
    if (translationValue !== null) {
      this.controller.updateTranslatePreview({ axis: this.axis, value: translationValue });
    } else {
      this.controller.updateTranslatePreview({ axis: this.axis, value: null });
    }
  }

  confirm() {
    if (!this.axis) {
      if (this.mode === MODE_ABSOLUTE) {
        this.controller.showHudMessage("Select an axis to edit before entering a coordinate.");
      } else {
        this.controller.showHudMessage("Translate — press X, Y, or Z to pick an axis.");
      }
      return;
    }
    const rawValue = this.getValue();
    if (!Number.isFinite(rawValue)) {
      const message =
        this.mode === MODE_ABSOLUTE
          ? "Enter a numeric coordinate in mm, then press Enter."
          : "Enter a numeric distance in mm, then press Enter.";
      this.controller.showHudMessage(message);
      return;
    }
    const translationValue = this.getTranslationValue();
    if (!Number.isFinite(translationValue)) {
      this.controller.showHudMessage("Cannot determine translation distance for that coordinate.");
      return;
    }
    if (translationValue === 0) {
      this.controller.cancelActiveCommand();
      this.controller.showHudMessage("No change — coordinate remains the same.");
      return;
    }
    const payload = {
      axis: this.axis,
      value: translationValue,
      mode: this.mode,
      context: this.context,
      rawValue,
      label: this.label
    };
    this.controller.applyTranslation(payload);
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
