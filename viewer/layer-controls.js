function normalizeLayerName(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value === "structure" || value === "pli" || value === "pla") {
    return value;
  }
  return null;
}

export function setupLayerControls({ viewer, container } = {}) {
  if (!viewer || !container) {
    return () => {};
  }

  const checkboxes = Array.from(
    container.querySelectorAll('input[type="checkbox"][data-layer]')
  );
  if (checkboxes.length === 0) {
    return () => {};
  }

  const syncFromViewer = visibility => {
    if (!visibility && typeof viewer.getLayerVisibility === "function") {
      visibility = viewer.getLayerVisibility();
    }
    if (!visibility) {
      return;
    }
    for (const input of checkboxes) {
      const layer = normalizeLayerName(input.dataset.layer);
      if (!layer) {
        continue;
      }
      const desired = Object.prototype.hasOwnProperty.call(visibility, layer)
        ? !!visibility[layer]
        : true;
      input.checked = desired;
    }
  };

  const handleChange = event => {
    const { target } = event;
    if (!target || target.tagName !== "INPUT") {
      return;
    }
    const layer = normalizeLayerName(target.dataset.layer);
    if (!layer || typeof viewer.setLayerVisibility !== "function") {
      return;
    }
    viewer.setLayerVisibility(layer, target.checked);
  };

  for (const input of checkboxes) {
    input.addEventListener("change", handleChange);
  }

  syncFromViewer();

  const previousHandler = typeof viewer.onLayerVisibilityChange === "function"
    ? viewer.onLayerVisibilityChange
    : null;

  const handler = visibility => {
    if (previousHandler) {
      previousHandler(visibility);
    }
    syncFromViewer(visibility);
  };

  viewer.onLayerVisibilityChange = handler;

  return () => {
    for (const input of checkboxes) {
      input.removeEventListener("change", handleChange);
    }
    if (viewer.onLayerVisibilityChange === handler) {
      viewer.onLayerVisibilityChange = previousHandler ?? null;
    }
  };
}
