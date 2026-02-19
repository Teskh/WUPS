import { EditorMode } from "../state/editor-state.js";

export class DeleteCommand {
  constructor({ state, selection, controller }) {
    this.state = state;
    this.selection = selection;
    this.controller = controller;
    this.name = "delete";
  }

  begin() {
    const items = this.selection.getSelection();
    if (!items.length) {
      this.controller.showHudMessage("Select one or more items to delete.");
      return false;
    }
    this.state.setPendingCommand({ name: this.name, count: items.length });
    this.state.setActiveCommand(this);
    this.state.setMode(EditorMode.Confirm);
    this.controller.showDeletePreview(items);
    return true;
  }

  confirm() {
    this.controller.applyDeletion();
  }

  cancel() {
    this.controller.cancelActiveCommand();
  }

  handleKey(event) {
    switch (event.key) {
      case "Enter":
        this.confirm();
        return true;
      case "Escape":
        this.cancel();
        return true;
      default:
        return false;
    }
  }
}

