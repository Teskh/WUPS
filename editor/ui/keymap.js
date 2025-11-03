// Keymap for editor commands (scaffold).
// Binds 'G' (translate), then axis ('x'|'y'|'z'), then numeric input.

export class Keymap {
  constructor({ viewer, state, selection, commands, controller }) {
    this.viewer = viewer;
    this.state = state;
    this.selection = selection;
    this.commands = commands;
    this.controller = controller;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  attach() {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this._onKeyDown);
    }
  }

  detach() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this._onKeyDown);
    }
  }

  _onKeyDown(event) {
    if (!this.state.enabled) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    const targetTag = event.target?.tagName?.toLowerCase?.();
    if (targetTag === "input" || targetTag === "textarea" || targetTag === "select") {
      return;
    }
    const active = this.state.activeCommand;
    const key = event.key;
    if (active && typeof active.handleKey === "function") {
      const handled = active.handleKey(event);
      if (handled) {
        event.preventDefault();
      }
      return;
    }

    switch (key) {
      case "g":
      case "G":
        if (this.selection.getSelection().length > 0) {
          event.preventDefault();
          this.controller.startTranslateCommand();
        }
        break;
      case "Delete":
      case "Backspace":
        if (this.selection.getSelection().length > 0) {
          event.preventDefault();
          this.controller.startDeleteCommand();
        }
        break;
      case "Escape":
        if (this.selection.getSelection().length > 0) {
          event.preventDefault();
          this.selection.clear();
        }
        break;
      case "s":
      case "S":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          this.controller.saveModified();
        }
        break;
      default:
        break;
    }
  }
}
