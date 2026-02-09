function normalizeLayerName(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value === "structure" || value === "pli" || value === "pla") {
    return value;
  }
  if (/^(pli|pla)\d+$/.test(value)) {
    return value;
  }
  return null;
}

function getLayerLabel(layer) {
  if (layer === "structure") {
    return "Structure & BOY";
  }
  if (layer === "pli") {
    return "All PLI";
  }
  if (layer === "pla") {
    return "All PLA";
  }
  const match = layer.match(/^(pli|pla)(\d+)$/);
  if (match) {
    const side = match[1].toUpperCase();
    const index = match[2];
    return `${side}${index} sheathing, NR, PAF`;
  }
  return layer.toUpperCase();
}

export function setupLayerControls({ viewer, container } = {}) {
  if (!viewer || !container) {
    return () => {};
  }

  const legend = container.querySelector("legend") ?? null;

  const renderControls = visibility => {
    const keys = Object.keys(visibility ?? {});
    if (keys.length === 0) {
      return;
    }

    for (const label of Array.from(container.querySelectorAll("label"))) {
      label.remove();
    }

    for (const layer of keys) {
      const normalized = normalizeLayerName(layer);
      if (!normalized) {
        continue;
      }
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.layer = normalized;
      input.checked = visibility[normalized] !== false;
      label.append(input, ` ${getLayerLabel(normalized)}`);
      if (legend && legend.parentElement === container) {
        container.appendChild(label);
      } else {
        container.prepend(label);
      }
    }
  }

  const syncFromViewer = visibility => {
    if (!visibility && typeof viewer.getLayerVisibility === "function") {
      visibility = viewer.getLayerVisibility();
    }
    if (!visibility) {
      return;
    }
    renderControls(visibility);
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

  container.addEventListener("change", handleChange);

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
    container.removeEventListener("change", handleChange);
    if (viewer.onLayerVisibilityChange === handler) {
      viewer.onLayerVisibilityChange = previousHandler ?? null;
    }
  };
}
