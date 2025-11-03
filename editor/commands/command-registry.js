// Command registry (scaffold).
// Registers and instantiates edit commands (translate/delete/etc.).

export class CommandRegistry {
  constructor({ viewer, state, selection, controller }) {
    this.viewer = viewer;
    this.state = state;
    this.selection = selection;
    this.controller = controller;
    this.registry = new Map(); // name -> ctor
  }

  register(name, ctor) {
    this.registry.set(name, ctor);
  }

  has(name) {
    return this.registry.has(name);
  }

  create(name, options = {}) {
    const Ctor = this.registry.get(name);
    if (!Ctor) return null;
    return new Ctor({
      viewer: this.viewer,
      state: this.state,
      selection: this.selection,
      controller: this.controller,
      ...options
    });
  }
}
