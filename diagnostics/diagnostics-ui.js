/**
 * Diagnostics UI Component
 *
 * Provides an interactive UI for running diagnostics and displaying results.
 */

import {
  runDiagnostic,
  runAllDiagnostics,
  getAvailableDiagnostics,
  saveDiagnosticResults
} from "./diagnostic-runner.js";
import { createModernOutletRouting } from "./outlet-modernizer.js";
import { parseWup, normalizeModel } from "../wup-parser.js";

let currentModel = null;
let diagnosticsPanel = null;

/**
 * Initialize the diagnostics UI
 */
export function initDiagnosticsUI() {
  // Listen for model updates
  if (typeof document !== "undefined") {
    document.addEventListener("wup:model", event => {
      currentModel = event.detail.model;
      updateDiagnosticsState();
    });

    // Create and inject diagnostics panel
    createDiagnosticsPanel();
  }

  // Make globally available
  if (typeof window !== "undefined") {
    window.showDiagnostics = showDiagnostics;
    window.hideDiagnostics = hideDiagnostics;
  }
}

/**
 * Create the diagnostics panel UI
 */
function createDiagnosticsPanel() {
  const panel = document.createElement("div");
  panel.id = "diagnosticsPanel";
  panel.className = "diagnostics-panel hidden";

  panel.innerHTML = `
    <div class="diagnostics-header">
      <h2>Diagnostics</h2>
      <button id="closeDiagnostics" type="button" aria-label="Close diagnostics panel">&times;</button>
    </div>

    <div class="diagnostics-actions">
      <button id="runAllDiagnostics" type="button" disabled>Run All Diagnostics</button>
      <button id="saveDiagnostics" type="button" disabled>Save Report</button>
    </div>

    <div class="diagnostics-select">
      <label for="diagnosticSelector">Select Diagnostic:</label>
      <select id="diagnosticSelector" disabled>
        <option value="">-- Select a diagnostic --</option>
      </select>
      <button id="runSelectedDiagnostic" type="button" disabled>Run</button>
    </div>

    <div id="diagnosticsResults" class="diagnostics-results"></div>
  `;

  document.body.appendChild(panel);
  diagnosticsPanel = panel;

  // Populate diagnostic selector
  const selector = document.getElementById("diagnosticSelector");
  const availableDiagnostics = getAvailableDiagnostics();
  availableDiagnostics.forEach(diag => {
    const option = document.createElement("option");
    option.value = diag.key;
    option.textContent = diag.name;
    selector.appendChild(option);
  });

  // Event listeners
  document.getElementById("closeDiagnostics").addEventListener("click", hideDiagnostics);
  document.getElementById("runAllDiagnostics").addEventListener("click", handleRunAll);
  document.getElementById("runSelectedDiagnostic").addEventListener("click", handleRunSelected);
  document.getElementById("saveDiagnostics").addEventListener("click", handleSave);

  // Add button to main UI
  addDiagnosticsButton();
}

/**
 * Add a button to open diagnostics to the main UI
 */
function addDiagnosticsButton() {
  const controls = document.querySelector(".controls");
  if (!controls) return;

  const button = document.createElement("button");
  button.id = "openDiagnostics";
  button.type = "button";
  button.textContent = "Run Diagnostics";
  button.disabled = true;

  button.addEventListener("click", showDiagnostics);

  controls.appendChild(button);
}

/**
 * Update UI state based on whether a model is loaded
 */
function updateDiagnosticsState() {
  const hasModel = currentModel !== null;

  const openButton = document.getElementById("openDiagnostics");
  const runAllButton = document.getElementById("runAllDiagnostics");
  const runSelectedButton = document.getElementById("runSelectedDiagnostic");
  const selector = document.getElementById("diagnosticSelector");

  if (openButton) openButton.disabled = !hasModel;
  if (runAllButton) runAllButton.disabled = !hasModel;
  if (runSelectedButton) runSelectedButton.disabled = !hasModel;
  if (selector) selector.disabled = !hasModel;
}

/**
 * Show the diagnostics panel
 */
function showDiagnostics() {
  if (diagnosticsPanel) {
    diagnosticsPanel.classList.remove("hidden");
  }
}

/**
 * Hide the diagnostics panel
 */
function hideDiagnostics() {
  if (diagnosticsPanel) {
    diagnosticsPanel.classList.add("hidden");
  }
}

/**
 * Handle running all diagnostics
 */
function handleRunAll() {
  if (!currentModel) {
    alert("No model loaded. Please load a WUP file first.");
    return;
  }

  const results = runAllDiagnostics(currentModel);
  displayAllResults(results);

  // Enable save button
  const saveButton = document.getElementById("saveDiagnostics");
  if (saveButton) {
    saveButton.disabled = false;
    saveButton.dataset.results = JSON.stringify(results);
  }
}

/**
 * Handle running a selected diagnostic
 */
function handleRunSelected() {
  if (!currentModel) {
    alert("No model loaded. Please load a WUP file first.");
    return;
  }

  const selector = document.getElementById("diagnosticSelector");
  const diagnosticKey = selector.value;

  if (!diagnosticKey) {
    alert("Please select a diagnostic to run.");
    return;
  }

  const result = runDiagnostic(diagnosticKey, currentModel);
  displaySingleResult(result);

  // Enable save button
  const saveButton = document.getElementById("saveDiagnostics");
  if (saveButton) {
    saveButton.disabled = false;
    saveButton.dataset.results = JSON.stringify(result);
  }
}

/**
 * Handle saving diagnostic results
 */
function handleSave() {
  const saveButton = document.getElementById("saveDiagnostics");
  if (!saveButton || !saveButton.dataset.results) {
    return;
  }

  try {
    const results = JSON.parse(saveButton.dataset.results);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `diagnostics-${timestamp}.txt`;
    saveDiagnosticResults(results, filename);
  } catch (err) {
    alert(`Failed to save results: ${err.message}`);
  }
}

/**
 * Display results from all diagnostics
 */
function displayAllResults(allResults) {
  const container = document.getElementById("diagnosticsResults");
  if (!container) return;

  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "results-header";
  header.innerHTML = `
    <h3>All Diagnostics Results</h3>
    <p class="timestamp">Run at: ${new Date(allResults.timestamp).toLocaleString()}</p>
  `;
  container.appendChild(header);

  for (const [key, diagnostic] of Object.entries(allResults.diagnostics)) {
    if (diagnostic.success && diagnostic.results) {
      const section = createDiagnosticSection(diagnostic);
      container.appendChild(section);
    } else {
      const errorSection = document.createElement("div");
      errorSection.className = "diagnostic-error";
      errorSection.innerHTML = `
        <h4>${diagnostic.name}</h4>
        <p class="error">${diagnostic.error}</p>
      `;
      container.appendChild(errorSection);
    }
  }
}

/**
 * Display results from a single diagnostic
 */
function displaySingleResult(result) {
  const container = document.getElementById("diagnosticsResults");
  if (!container) return;

  container.innerHTML = "";

  if (result.success && result.results) {
    const section = createDiagnosticSection(result);
    container.appendChild(section);
  } else {
    const errorSection = document.createElement("div");
    errorSection.className = "diagnostic-error";
    errorSection.innerHTML = `
      <h4>${result.name}</h4>
      <p class="error">${result.error}</p>
    `;
    container.appendChild(errorSection);
  }
}

/**
 * Create a diagnostic results section with expandable checklists
 */
function createDiagnosticSection(diagnostic) {
  const section = document.createElement("div");
  section.className = "diagnostic-section";

  const header = document.createElement("div");
  header.className = "diagnostic-section-header";
  header.innerHTML = `
    <h3>${diagnostic.name}</h3>
    <p>${diagnostic.description}</p>
    <div class="summary">
      <span class="summary-stat">Total: ${diagnostic.results.summary.total}</span>
      <span class="summary-stat passed">Passed: ${diagnostic.results.summary.passed}</span>
      <span class="summary-stat failed">Failed: ${diagnostic.results.summary.failed}</span>
    </div>
  `;
  section.appendChild(header);

  // Create checklist for each check type
  diagnostic.results.checks.forEach(check => {
    const checkSection = createCheckSection(check);
    section.appendChild(checkSection);
  });

  return section;
}

/**
 * Create an expandable checklist for a specific check
 */
function createCheckSection(check) {
  const checkDiv = document.createElement("div");
  checkDiv.className = "check-section";

  const passed = check.results.filter(r => r.passed).length;
  const failed = check.results.filter(r => !r.passed).length;
  const total = check.results.length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(0) : 0;

  const header = document.createElement("div");
  header.className = "check-header";
  header.innerHTML = `
    <button class="expand-toggle" type="button" aria-expanded="false">
      <span class="toggle-icon">▶</span>
      <span class="check-title">${check.name}</span>
      <span class="check-stats">
        <span class="badge ${failed === 0 ? 'passed' : 'failed'}">${passed}/${total} passed (${passRate}%)</span>
      </span>
    </button>
  `;

  const content = document.createElement("div");
  content.className = "check-content collapsed";

  const description = document.createElement("p");
  description.className = "check-description";
  description.textContent = check.description;
  content.appendChild(description);

  const resultsList = document.createElement("ul");
  resultsList.className = "check-results-list";

  check.results.forEach(result => {
    const item = document.createElement("li");
    item.className = `check-result-item ${result.passed ? 'passed' : 'failed'}`;

    const checkbox = result.passed ? "✓" : "✗";
    const statusClass = result.passed ? "check-pass" : "check-fail";

    // Add zoom button for items with position data (BOY operations, NR, or outlets)
    let zoomButton = '';
    if (!result.passed && result.boy) {
      zoomButton = `<button class="zoom-to-error" data-boy-x="${result.boy.x}" data-boy-z="${result.boy.z}" title="Zoom to this BOY">🔍</button>`;
    } else if (!result.passed && result.nr) {
      const nr = result.nr;
      const editorId = typeof nr.__editorId === "number" ? nr.__editorId : "";
      const layer = typeof nr.layer === "string" ? nr.layer : "";
      const startX = Number.isFinite(nr.start?.x) ? nr.start.x : "";
      const startY = Number.isFinite(nr.start?.y) ? nr.start.y : "";
      const endX = Number.isFinite(nr.end?.x) ? nr.end.x : "";
      const endY = Number.isFinite(nr.end?.y) ? nr.end.y : "";
      zoomButton = `<button class="zoom-to-nr" data-nr-id="${editorId}" data-layer="${layer}" data-start-x="${startX}" data-start-y="${startY}" data-end-x="${endX}" data-end-y="${endY}" title="Zoom to this NR">🔍</button>`;
    } else if (!result.passed && result.position) {
      // For outlets or other items with position data, only show zoom on failures
      const bx = Number.isFinite(result.position.x) ? result.position.x : (result.bounds?.center?.x ?? "");
      const by = Number.isFinite(result.position.y) ? result.position.y : (result.bounds?.center?.y ?? "");
      const cx = Number.isFinite(result.bounds?.center?.x) ? result.bounds.center.x : "";
      const cy = Number.isFinite(result.bounds?.center?.y) ? result.bounds.center.y : "";
      const outletLayer = result.routing?.layer ?? result.outlet?.layer ?? "";
      zoomButton = `<button class="zoom-to-outlet" data-x="${bx}" data-y="${by}" data-cx="${cx}" data-cy="${cy}" data-layer="${outletLayer}" title="Zoom to this location">🔍</button>`;
    }

    const actionButtons = `${zoomButton}`;

    item.innerHTML = `
      <div class="result-summary">
        <span class="${statusClass}">${checkbox}</span>
        <strong>${result.id}</strong>
        <span class="result-message">${result.message}</span>
        ${actionButtons}
      </div>
    `;

    // Add expandable details
    if (result.details && Object.keys(result.details).length > 0) {
      const detailsDiv = document.createElement("div");
      detailsDiv.className = "result-details collapsed";

      const detailsList = document.createElement("dl");
      for (const [key, value] of Object.entries(result.details)) {
        const dt = document.createElement("dt");
        dt.textContent = key;
        const dd = document.createElement("dd");
        dd.textContent = value;
        detailsList.appendChild(dt);
        detailsList.appendChild(dd);
      }

      detailsDiv.appendChild(detailsList);
      item.appendChild(detailsDiv);

      // Toggle details on click (but not on zoom button)
      item.querySelector(".result-summary").addEventListener("click", (e) => {
        if (!e.target.classList.contains("zoom-to-error") &&
            !e.target.classList.contains("zoom-to-nr") &&
            !e.target.classList.contains("zoom-to-outlet")) {
          detailsDiv.classList.toggle("collapsed");
        }
      });
    }

    // Add zoom button handlers
    const zoomBoyBtn = item.querySelector(".zoom-to-error");
    if (zoomBoyBtn) {
      zoomBoyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const boyX = parseFloat(zoomBoyBtn.dataset.boyX);
        const boyZ = parseFloat(zoomBoyBtn.dataset.boyZ);
        zoomToBoy(boyX, boyZ);
        hideDiagnostics();
      });
    }

    const zoomNrBtn = item.querySelector(".zoom-to-nr");
    if (zoomNrBtn) {
      zoomNrBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const editorIdRaw = parseFloat(zoomNrBtn.dataset.nrId);
        const startX = parseFloat(zoomNrBtn.dataset.startX);
        const startY = parseFloat(zoomNrBtn.dataset.startY);
        const endX = parseFloat(zoomNrBtn.dataset.endX);
        const endY = parseFloat(zoomNrBtn.dataset.endY);
        const detail = {
          editorId: Number.isFinite(editorIdRaw) ? editorIdRaw : null,
          start: Number.isFinite(startX) && Number.isFinite(startY) ? { x: startX, y: startY } : null,
          end: Number.isFinite(endX) && Number.isFinite(endY) ? { x: endX, y: endY } : null,
          layer: zoomNrBtn.dataset.layer || null
        };
        zoomToNailRow(detail);
        hideDiagnostics();
      });
    }

    const zoomOutletBtn = item.querySelector(".zoom-to-outlet");
    if (zoomOutletBtn) {
      zoomOutletBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const xPrimary = parseFloat(zoomOutletBtn.dataset.x);
        const yPrimary = parseFloat(zoomOutletBtn.dataset.y);
        const xCenter = parseFloat(zoomOutletBtn.dataset.cx);
        const yCenter = parseFloat(zoomOutletBtn.dataset.cy);
        const x = Number.isFinite(xPrimary) ? xPrimary : xCenter;
        const y = Number.isFinite(yPrimary) ? yPrimary : yCenter;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          alert("Unable to determine outlet location to zoom.");
          return;
        }
        const layer = zoomOutletBtn.dataset.layer || null;
        zoomToPosition(x, y, layer);
        hideDiagnostics();
      });
    }

    resultsList.appendChild(item);
  });

  content.appendChild(resultsList);
  checkDiv.appendChild(header);
  checkDiv.appendChild(content);

  // Toggle expand/collapse
  const toggleButton = header.querySelector(".expand-toggle");
  toggleButton.addEventListener("click", () => {
    const isExpanded = content.classList.toggle("collapsed");
    toggleButton.setAttribute("aria-expanded", !isExpanded);
    header.querySelector(".toggle-icon").textContent = isExpanded ? "▶" : "▼";
  });

  return checkDiv;
}

/**
 * Zoom the 3D viewer to a specific BOY operation
 */
function zoomToBoy(boyX, boyZ) {
  // Dispatch event for the 3D viewer to handle
  if (typeof document !== "undefined") {
    document.dispatchEvent(
      new CustomEvent("diagnostics:zoomToBoy", {
        detail: { x: boyX, z: boyZ }
      })
    );
  }
}

/**
 * Zoom the 3D viewer to a specific nail row
 */
function zoomToNailRow(nrData) {
  if (typeof document !== "undefined") {
    document.dispatchEvent(
      new CustomEvent("diagnostics:zoomToNailRow", {
        detail: {
          editorId: Number.isFinite(nrData?.editorId) ? nrData.editorId : null,
          start: nrData?.start ?? null,
          end: nrData?.end ?? null,
          layer: nrData?.layer ?? null
        }
      })
    );
  }
}

/**
 * Zoom the 3D viewer to a specific position (e.g., outlet)
 */
function zoomToPosition(x, y, layer) {
  // Dispatch event for the 3D viewer to handle
  if (typeof document !== "undefined") {
    document.dispatchEvent(
      new CustomEvent("diagnostics:zoomToPosition", {
        detail: { x, y, layer: layer ?? null }
      })
    );
  }
}

function handleReplaceOutlet(result) {
  if (!currentModel) {
    alert("No model loaded. Please load a WUP file first.");
    return;
  }

  const replacement = result?.replacement;
  if (!replacement) {
    alert("Replacement data is not available for this outlet.");
    return;
  }

  const orientation = replacement.orientation;
  if (orientation !== "horizontal" && orientation !== "vertical") {
    alert("Outlet replacement is not supported for this outlet orientation.");
    return;
  }

  try {
    // Store the expanded state of check sections before re-rendering
    const expandedStates = new Map();
    const checkHeaders = document.querySelectorAll(".check-header .expand-toggle");
    checkHeaders.forEach(header => {
      const isExpanded = header.getAttribute("aria-expanded") === "true";
      const checkTitle = header.querySelector(".check-title")?.textContent || "";
      expandedStates.set(checkTitle, isExpanded);
    });

    const updatedModel = applyOutletReplacement(currentModel, replacement);
    currentModel = updatedModel;

    const label = window.__lastWupModel?.label ?? "model.wup";
    if (window.__lastWupModel) {
      window.__lastWupModel.model = updatedModel;
      window.__lastWupModel.label = label;
    } else {
      window.__lastWupModel = { model: updatedModel, label };
    }

    const editorController = window.__editorController;
    if (editorController?.setModel) {
      editorController.setModel(updatedModel, label);
    } else {
      refreshModelInViewer(updatedModel);
    }

    const updatedResult = runDiagnostic("outlet", updatedModel);
    displaySingleResult(updatedResult);

    // Restore the expanded state of check sections
    const newCheckHeaders = document.querySelectorAll(".check-header .expand-toggle");
    newCheckHeaders.forEach(header => {
      const checkTitle = header.querySelector(".check-title")?.textContent || "";
      const shouldBeExpanded = expandedStates.get(checkTitle);
      if (shouldBeExpanded !== undefined) {
        const checkContent = header.closest(".check-header").nextElementSibling;
        if (shouldBeExpanded && checkContent?.classList.contains("collapsed")) {
          checkContent.classList.remove("collapsed");
          header.setAttribute("aria-expanded", "true");
          header.querySelector(".toggle-icon").textContent = "▼";
        }
      }
    });

    const saveButton = document.getElementById("saveDiagnostics");
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.dataset.results = JSON.stringify(updatedResult);
    }
  } catch (err) {
    console.error("Failed to replace legacy outlet:", err);
    alert(`Failed to replace outlet: ${err.message}`);
  }
}

function applyOutletReplacement(model, replacement) {
  if (!model || !Array.isArray(model.pafRoutings)) {
    throw new Error("Model does not contain any PAF routings.");
  }

  if (!Array.isArray(model.__statements) || model.__statements.length === 0) {
    throw new Error("Model source statements are unavailable; cannot apply replacement.");
  }

  const boxId = replacement.boxRoutingEditorId;
  if (typeof boxId !== "number") {
    throw new Error("Legacy outlet routing identifier is missing.");
  }

  const targetRouting = model.pafRoutings.find(
    routing => routing && typeof routing.__editorId === "number" && routing.__editorId === boxId
  );

  if (!targetRouting) {
    throw new Error("Legacy outlet routing could not be located in the current model.");
  }

  const legacyParams = extractLegacyRoutingParams(targetRouting);
  const depthValue = Number.isFinite(replacement.depth) ? replacement.depth : legacyParams.depth;
  const orientationValue = Number.isFinite(replacement.orientationValue)
    ? replacement.orientationValue
    : legacyParams.orientation;
  const zValue = Number.isFinite(replacement.zValue) ? replacement.zValue : legacyParams.zValue;
  const headerSource = Array.isArray(replacement.headerSource) && replacement.headerSource.length > 0
    ? replacement.headerSource.filter(num => Number.isFinite(num))
    : (Array.isArray(targetRouting.source)
        ? targetRouting.source.filter(num => Number.isFinite(num))
        : []);

  const circleRoutings = (replacement.circleRoutingEditorIds ?? [])
    .map(id => model.pafRoutings.find(routing => routing?.__editorId === id))
    .filter(Boolean);

  const statementIndexSet = new Set();
  for (const routing of [targetRouting, ...circleRoutings]) {
    for (const index of routing?.__statementIndices ?? []) {
      if (Number.isInteger(index) && index >= 0) {
        statementIndexSet.add(index);
      }
    }
  }

  if (statementIndexSet.size === 0) {
    throw new Error("Unable to resolve source statements for the legacy outlet routings.");
  }

  const sortedIndices = Array.from(statementIndexSet).sort((a, b) => a - b);
  const insertionIndex = sortedIndices[0];

  const orientationType = typeof replacement.orientation === "string"
    ? replacement.orientation
    : "horizontal";

  const { statements: modernStatements } = createModernOutletRouting({
    center: replacement.center,
    depth: depthValue,
    zValue,
    orientationValue,
    headerSource,
    tool: replacement.tool ?? targetRouting.tool ?? null,
    face: replacement.face ?? targetRouting.face ?? null,
    passes: replacement.passes ?? targetRouting.passes ?? null,
    layer: replacement.layer ?? targetRouting.layer ?? null,
    command: replacement.command ?? targetRouting.__command ?? "PAF",
    body: replacement.body ?? targetRouting.body ?? "",
    orientationType
  });

  const updatedStatements = [];
  let inserted = false;
  const indexSet = new Set(sortedIndices);

  for (let i = 0; i < model.__statements.length; i += 1) {
    if (!inserted && i === insertionIndex) {
      updatedStatements.push(...modernStatements);
      inserted = true;
    }
    if (indexSet.has(i)) {
      continue;
    }
    updatedStatements.push(model.__statements[i]);
  }

  if (!inserted) {
    updatedStatements.push(...modernStatements);
  }

  const updatedText = `${updatedStatements.map(stmt => `${stmt.trim()};`).join("\n")}\n`;

  const parsed = parseWup(updatedText);
  const normalized = normalizeModel(parsed);
  return normalized;
}

function extractLegacyRoutingParams(routing) {
  const segment = routing?.segments?.[0];
  const firstEntry = Array.isArray(segment?.source) ? segment.source.find(entry => Array.isArray(entry?.numbers)) : null;
  const numbers = firstEntry?.numbers ?? [];
  const depth = numbers.length >= 3 && Number.isFinite(numbers[2])
    ? numbers[2]
    : (Number.isFinite(segment?.depthRaw) ? segment.depthRaw : null);
  const orientation = numbers.length >= 5 && Number.isFinite(numbers[4])
    ? numbers[4]
    : (Number.isFinite(segment?.orientation) ? segment.orientation : 0);
  const zValue = numbers.length >= 6 && Number.isFinite(numbers[5]) ? numbers[5] : null;
  return {
    depth: Number.isFinite(depth) ? depth : -13,
    orientation: Number.isFinite(orientation) ? orientation : 0,
    zValue
  };
}

function refreshModelInViewer(model) {
  if (typeof window === "undefined") {
    return;
  }
  const viewer = window.__frameViewer;
  if (viewer?.updateModel) {
    const clone = typeof structuredClone === "function"
      ? structuredClone(model)
      : JSON.parse(JSON.stringify(model));
    viewer.updateModel(clone, { maintainCamera: true });
  }
  if (window.__lastWupModel) {
    window.__lastWupModel.model = model;
  } else {
    window.__lastWupModel = { model, label: "model.wup" };
  }
}

// Auto-initialize when loaded
if (typeof document !== "undefined" && document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDiagnosticsUI);
} else if (typeof document !== "undefined") {
  initDiagnosticsUI();
}
