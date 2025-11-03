// Central editor state container (scaffold).

export const EditorMode = Object.freeze({
  Disabled: "disabled",
  Idle: "idle",
  Selecting: "selecting",
  CommandPending: "command-pending", // e.g., after pressing 'G'
  AxisPending: "axis-pending",       // waiting for X/Y/Z
  NumericInput: "numeric-input",     // collecting magnitude
  Preview: "preview",                // showing ghost overlays
  Confirm: "confirm"                 // awaiting apply/cancel
});

const ALL_KINDS = ["stud", "blocking", "plate", "sheathing", "nailRow", "paf", "boy"];
const GROUP_TO_KINDS = {
  structure: ["stud", "blocking", "plate"],
  sheathing: ["sheathing"],
  routings: ["nailRow", "paf", "boy"]
};

export class EditorState {
  constructor() {
    this.enabled = false;
    this.mode = EditorMode.Disabled;
    this.allowedKinds = new Set(ALL_KINDS);
    this.allowedGroups = new Set(["routings"]);
    this.pendingCommand = null; // e.g., { name: 'translate', axis: 'x', value: 0 }
    this.activeCommand = null;
    this.hudMessage = "";
    this.dirty = false;
    this.listeners = new Map();

    this.setAllowedGroups(["routings"]);
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  emit(event, detail) {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        handler(detail);
      } catch (err) {
        console.error("EditorState listener error", err);
      }
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.mode = enabled ? EditorMode.Idle : EditorMode.Disabled;
    this.emit("enabled", this.enabled);
  }

  setMode(mode) {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.emit("mode", mode);
  }

  setAllowedKinds(kindsArray) {
    this.allowedKinds = new Set(Array.isArray(kindsArray) ? kindsArray : []);
    this.emit("kinds", this.allowedKinds);
  }

  setAllowedGroups(groupsArray) {
    this.allowedGroups = new Set(Array.isArray(groupsArray) ? groupsArray : []);
    const kinds = new Set();
    for (const group of this.allowedGroups) {
      const bucket = GROUP_TO_KINDS[group];
      if (bucket) {
        for (const kind of bucket) {
          kinds.add(kind);
        }
      }
    }
    if (kinds.size === 0) {
      ALL_KINDS.forEach(kind => kinds.add(kind));
    }
    this.setAllowedKinds(Array.from(kinds));
    this.emit("groups", this.allowedGroups);
  }

  setPendingCommand(commandState) {
    this.pendingCommand = commandState;
    this.emit("pendingCommand", commandState);
  }

  setActiveCommand(command) {
    this.activeCommand = command;
    this.emit("activeCommand", command);
  }

  setHudMessage(message) {
    if (this.hudMessage === message) {
      return;
    }
    this.hudMessage = message;
    this.emit("hud", message);
  }

  setDirty(isDirty) {
    this.dirty = !!isDirty;
    this.emit("dirty", this.dirty);
  }
}

EditorState.ALL_KINDS = ALL_KINDS;
