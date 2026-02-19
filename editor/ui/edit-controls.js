// UI creation for Edit Mode.
// Adds an Edit Mode toggle, selection filters, and command buttons.

const GROUPS = [
  { id: "structure", label: "Structure", kinds: ["stud", "blocking", "plate"] },
  { id: "sheathing", label: "Sheathing", kinds: ["sheathing"] },
  { id: "routings", label: "Operations", kinds: ["nailRow", "paf", "boy"] }
];

export function createEditControls({ container, state, controller } = {}) {
  if (!container || !state || !controller || typeof document === "undefined") {
    return { cleanup: () => {}, setEnabled: () => {}, updateSelectionCount: () => {} };
  }

  const root = document.createElement("section");
  root.className = "edit-controls-panel";

  const header = document.createElement("h2");
  header.textContent = "Edit Mode";
  root.appendChild(header);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "edit-toggle";
  toggle.textContent = "Enable";
  root.appendChild(toggle);

  const selectionInfo = document.createElement("div");
  selectionInfo.className = "edit-selection-info";
  const selectionCount = document.createElement("span");
  selectionCount.textContent = "No selection";
  selectionInfo.appendChild(selectionCount);
  root.appendChild(selectionInfo);

  const groupLegend = document.createElement("fieldset");
  groupLegend.className = "edit-group-filter";
  const legend = document.createElement("legend");
  legend.textContent = "Editable categories";
  groupLegend.appendChild(legend);

  const checkboxMap = new Map();
  for (const group of GROUPS) {
    const label = document.createElement("label");
    label.className = "edit-group-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = group.id;
    input.checked = state.allowedGroups.has(group.id);
    checkboxMap.set(group.id, input);
    label.appendChild(input);
    const span = document.createElement("span");
    span.textContent = group.label;
    label.appendChild(span);
    groupLegend.appendChild(label);
  }
  root.appendChild(groupLegend);

  const actions = document.createElement("div");
  actions.className = "edit-actions";

  const moveHint = document.createElement("span");
  moveHint.className = "edit-action-hint";
  moveHint.textContent = "Press G to translate";
  actions.appendChild(moveHint);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete selection";
  deleteBtn.className = "edit-btn-delete";
  actions.appendChild(deleteBtn);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save copy";
  saveBtn.className = "edit-btn-save";
  actions.appendChild(saveBtn);

  root.appendChild(actions);

  container.appendChild(root);

  const updateToggleText = enabled => {
    toggle.textContent = enabled ? "Disable" : "Enable";
    root.classList.toggle("enabled", enabled);
  };

  const updateSelectionCount = count => {
    if (!count) {
      selectionCount.textContent = "No selection";
    } else {
      selectionCount.textContent = `${count} selected`;
    }
  };

  const handleToggle = () => {
    if (state.enabled) {
      controller.disable();
    } else {
      controller.enable();
    }
  };

  const handleCheckboxChange = () => {
    const enabledGroups = [];
    for (const [id, input] of checkboxMap.entries()) {
      if (input.checked) {
        enabledGroups.push(id);
      }
    }
    if (!enabledGroups.length) {
      // Prevent empty selection; keep at least operations enabled.
      const operations = checkboxMap.get("routings");
      if (operations) {
        operations.checked = true;
        enabledGroups.push("routings");
      }
    }
    state.setAllowedGroups(enabledGroups);
  };

  const handleDelete = () => controller.startDeleteCommand();
  const handleSave = () => controller.saveModified();

  toggle.addEventListener("click", handleToggle);
  deleteBtn.addEventListener("click", handleDelete);
  saveBtn.addEventListener("click", handleSave);
  checkboxMap.forEach(input => {
    input.addEventListener("change", handleCheckboxChange);
  });

  const handleEnabled = value => {
    updateToggleText(Boolean(value));
    root.classList.toggle("is-disabled", !value);
    for (const input of checkboxMap.values()) {
      input.disabled = !value;
    }
    deleteBtn.disabled = !value;
  };

  const enabledListener = value => {
    handleEnabled(value);
  };

  const groupsListener = groups => {
    for (const [id, input] of checkboxMap.entries()) {
      input.checked = groups.has(id);
    }
  };

  state.on("enabled", enabledListener);
  state.on("groups", groupsListener);
  handleEnabled(state.enabled);
  groupsListener(state.allowedGroups);
  updateSelectionCount(0);

  return {
    cleanup() {
      toggle.removeEventListener("click", handleToggle);
      deleteBtn.removeEventListener("click", handleDelete);
      saveBtn.removeEventListener("click", handleSave);
      checkboxMap.forEach(input => {
        input.removeEventListener("change", handleCheckboxChange);
      });
      state.off("enabled", enabledListener);
      state.off("groups", groupsListener);
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    },
    setEnabled(enabled) {
      handleEnabled(enabled);
    },
    updateSelectionCount
  };
}
