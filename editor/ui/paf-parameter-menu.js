import {
  computeCutoutFootprint,
  DEFAULT_TOOL_RADIUS,
  extractControlCode,
  formatMillimetres,
  parseControlCode,
  resolveFootprintAdjustment
} from "../../utils/paf-control.js";

const REFERENCE_PLANES = {
  1: {
    label: "Plane 1",
    tooltip: "Plane 1: y↑, x→, z↓ (see spec 3.4.1 §1.3.4)."
  },
  2: {
    label: "Plane 2 (default)",
    tooltip: "Plane 2: y↑, x→, z← — default panel plane for PAF operations."
  },
  3: {
    label: "Plane 3",
    tooltip: "Plane 3: rotated about Z, y′ = -z (spec §1.3.4)."
  },
  4: {
    label: "Plane 4",
    tooltip: "Plane 4: y↑, x→, y↓ (spec §1.3.4)."
  },
  5: {
    label: "Plane 5",
    tooltip: "Plane 5: x↑, y← (viewed from y axis)."
  },
  6: {
    label: "Plane 6",
    tooltip: "Plane 6: y↑, x→ (viewed from x axis)."
  }
};

const TRIM_MODES = {
  0: {
    label: "Machine default",
    tooltip: "i = 0: Machine decides trimming based on contour complexity (legacy behaviour)."
  },
  1: {
    label: "No trimming",
    tooltip: "i = 1: Disable automatic trimming even for complex contours."
  },
  2: {
    label: "Force trimming",
    tooltip: "i = 2: Always trim the polygon (introduced in interface 3.4)."
  }
};

const TOOL_NUMBER_HINT =
  "T parameter: optional tool override number. 0 or omitted lets the machine choose the tool.";

const ROW_DEFINITIONS = [
  { id: "referencePlane", label: "Reference plane (e)" },
  { id: "trimMode", label: "Trimming mode (i)" },
  { id: "toolNumber", label: "Tool override (T)" },
  { id: "controlCode", label: "Control code" },
  { id: "toolCategory", label: "Tool category" },
  { id: "edgeMode", label: "Edge handling" },
  { id: "radiusMode", label: "Radius compensation" },
  { id: "rotationMode", label: "Rotation" },
  { id: "toolRadius", label: "Assumed tool radius" },
  { id: "cutoutSize", label: "Effective size" }
];

function describeReferencePlane(value) {
  if (!Number.isFinite(value)) {
    return {
      text: "Default (Plane 2)",
      tooltip: "No plane supplied — the specification defaults to reference plane 2."
    };
  }
  const normalized = Math.round(value);
  const entry = REFERENCE_PLANES[normalized];
  if (entry) {
    return { text: entry.label, tooltip: entry.tooltip };
  }
  return {
    text: `Plane ${normalized}`,
    tooltip: "This plane index is not enumerated in the streamlined spec; verify on the target machine."
  };
}

function describeTrimMode(value) {
  if (!Number.isFinite(value)) {
    return {
      text: "Machine default",
      tooltip: "No trimming parameter supplied — machine falls back to compatibility mode (i = 0)."
    };
  }
  const normalized = Math.round(value);
  const entry = TRIM_MODES[normalized];
  if (entry) {
    return { text: entry.label, tooltip: entry.tooltip };
  }
  return {
    text: `Mode ${normalized}`,
    tooltip: "This trimming flag is reserved; confirm supported values (0, 1, or 2)."
  };
}

function describeToolNumber(value) {
  if (!Number.isFinite(value) || value === 0) {
    return { text: "Machine selected", tooltip: TOOL_NUMBER_HINT };
  }
  return {
    text: `Tool ${Math.round(value)}`,
    tooltip: `${TOOL_NUMBER_HINT} Values above zero call a specific tool slot.`
  };
}

function computeCircularFootprint(segment, controlInfo) {
  if (!Number.isFinite(segment?.radius)) {
    return null;
  }
  const baseDiameter = Math.abs(segment.radius) * 2;
  const adjustment = resolveFootprintAdjustment(controlInfo, DEFAULT_TOOL_RADIUS);
  const expansion = adjustment?.expansion ?? 0;
  return {
    baseWidth: baseDiameter,
    baseHeight: baseDiameter,
    expansion,
    width: baseDiameter + expansion,
    height: baseDiameter + expansion,
    adjustment
  };
}

function formatSize(footprint) {
  if (!footprint || !Number.isFinite(footprint.width) || !Number.isFinite(footprint.height)) {
    return null;
  }
  const effective = `${formatMillimetres(footprint.width, 1)} × ${formatMillimetres(footprint.height, 1)}`;
  const tooltipParts = [];
  if (Number.isFinite(footprint.expansion) && footprint.expansion > 1e-3) {
    const base = `${formatMillimetres(footprint.baseWidth, 1)} × ${formatMillimetres(footprint.baseHeight, 1)}`;
    tooltipParts.push(`Effective pocket footprint; programmed path spans ${base}.`);
  } else {
    tooltipParts.push("Footprint derived directly from the programmed path (no expansion applied).");
  }
  if (footprint.adjustment?.description) {
    tooltipParts.push(footprint.adjustment.description);
  }
  return { text: effective, tooltip: tooltipParts.join(" ") };
}

function updateRow(row, payload) {
  if (!row || !row.element || !row.valueEl) {
    return;
  }
  const { element, valueEl } = row;
  const { text, tooltip } = payload ?? {};
  valueEl.textContent = text ?? "—";
  element.title = tooltip ?? "";
}

export function createPafParameterMenu({ container, onViewSource } = {}) {
  if (!container || typeof document === "undefined") {
    return {
      updateSelection: () => {},
      cleanup: () => {}
    };
  }

  const root = document.createElement("section");
  root.className = "paf-parameter-menu hidden";

  const header = document.createElement("div");
  header.className = "paf-parameter-menu-header";

  const heading = document.createElement("h3");
  heading.textContent = "PAF Parameters";
  header.appendChild(heading);

  const viewSourceBtn = document.createElement("button");
  viewSourceBtn.type = "button";
  viewSourceBtn.className = "paf-view-source-btn";
  viewSourceBtn.textContent = "View Source";
  viewSourceBtn.title = "View the WUP source code for this operation";
  header.appendChild(viewSourceBtn);

  root.appendChild(header);

  const list = document.createElement("div");
  list.className = "paf-param-list";
  root.appendChild(list);

  const rows = new Map();
  for (const def of ROW_DEFINITIONS) {
    const row = document.createElement("div");
    row.className = "paf-param-row";
    const label = document.createElement("span");
    label.className = "paf-param-label";
    label.textContent = def.label;
    const value = document.createElement("span");
    value.className = "paf-param-value";
    value.textContent = "—";
    row.appendChild(label);
    row.appendChild(value);
    list.appendChild(row);
    rows.set(def.id, { element: row, valueEl: value });
  }

  container.appendChild(root);

  function hide() {
    root.classList.add("hidden");
  }

  function show() {
    root.classList.remove("hidden");
  }

  let currentSelection = null;

  function updateSelection(selection) {
    currentSelection = selection;
    const pafObject = Array.isArray(selection)
      ? selection.find(item => item?.userData?.kind === "paf")
      : null;
    if (!pafObject) {
      hide();
      return;
    }

    const routing = pafObject.userData?.routing ?? null;
    const segment = pafObject.userData?.segment ?? null;
    const controlCode = extractControlCode(segment);
    const controlInfo = parseControlCode(controlCode);
    const adjustment = resolveFootprintAdjustment(controlInfo, DEFAULT_TOOL_RADIUS);

    const refPlane = describeReferencePlane(routing?.tool);
    const trimMode = describeTrimMode(routing?.face);
    const toolNumber = describeToolNumber(routing?.passes);
    const controlCodeText = Number.isFinite(controlCode)
      ? {
          text: controlCode.toString(),
          tooltip:
            "Control code applied to polygon points (i parameter). Format: thousands = rotation, hundreds = radius compensation, tens = over/undercut, ones = tool category."
        }
      : {
          text: "Not specified",
          tooltip: "No control code detected on this routing."
        };

    updateRow(rows.get("referencePlane"), refPlane);
    updateRow(rows.get("trimMode"), trimMode);
    updateRow(rows.get("toolNumber"), toolNumber);
    updateRow(rows.get("controlCode"), controlCodeText);

    const toolCategory = controlInfo?.toolCategory ?? { label: "Unknown", description: "" };
    updateRow(rows.get("toolCategory"), {
      text: toolCategory.label,
      tooltip: toolCategory.description
    });

    const edgeMode = controlInfo?.edgeMode ?? { label: "Standard contour", description: "" };
    updateRow(rows.get("edgeMode"), {
      text: edgeMode.label,
      tooltip: edgeMode.description
    });

    const radiusMode = controlInfo?.radiusMode ?? { label: "Machine default", description: "", side: "auto" };
    const radiusTooltipParts = [radiusMode.description];
    if (adjustment?.description) {
      radiusTooltipParts.push(adjustment.description);
    }
    updateRow(rows.get("radiusMode"), {
      text: radiusMode.label,
      tooltip: radiusTooltipParts.filter(Boolean).join(" ")
    });

    const rotationMode = controlInfo?.rotationMode ?? { label: "Machine default", description: "" };
    updateRow(rows.get("rotationMode"), {
      text: rotationMode.label,
      tooltip: rotationMode.description
    });

    let radiusText = "n/a";
    let radiusTooltip = "No radius-based expansion applied.";
    if (adjustment?.mode === "diameter") {
      radiusText = formatMillimetres(DEFAULT_TOOL_RADIUS * 2, 1);
      radiusTooltip = "Adds 16 mm per side (32 mm total) because hundreds digit is 1 (tool offset left).";
    } else if (adjustment?.mode === "radius") {
      radiusText = formatMillimetres(DEFAULT_TOOL_RADIUS, 1);
      radiusTooltip = "Adds 8 mm per side (16 mm total) because hundreds digit is 3 (no compensation).";
    } else if (adjustment?.mode === "internal") {
      radiusText = "n/a";
      radiusTooltip = "Hundreds digit is 2, so the routing stays inside the contour and no expansion is used.";
    }
    updateRow(rows.get("toolRadius"), {
      text: radiusText,
      tooltip: radiusTooltip
    });

    let footprint = null;
    if (segment?.kind === "polygon") {
      footprint = computeCutoutFootprint(segment.points, controlInfo, DEFAULT_TOOL_RADIUS);
    } else if (segment?.radius) {
      footprint = computeCircularFootprint(segment, controlInfo);
    } else if (pafObject.userData?.cutoutFootprint) {
      footprint = pafObject.userData.cutoutFootprint;
    }

    if (footprint && !footprint.adjustment) {
      footprint.adjustment = adjustment;
    }

    const sizeDescriptor = formatSize(footprint) ?? {
      text: "Unavailable",
      tooltip: "Could not derive a footprint for this routing segment."
    };
    updateRow(rows.get("cutoutSize"), sizeDescriptor);

    show();
  }

  function handleViewSource() {
    if (onViewSource && currentSelection) {
      onViewSource(currentSelection);
    }
  }

  viewSourceBtn.addEventListener("click", handleViewSource);

  return {
    updateSelection,
    cleanup() {
      viewSourceBtn.removeEventListener("click", handleViewSource);
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }
  };
}
