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

    // Add zoom button for failed items with BOY operations
    const zoomButton = !result.passed && result.boy ?
      `<button class="zoom-to-error" data-boy-x="${result.boy.x}" data-boy-z="${result.boy.z}" title="Zoom to this BOY">🔍</button>` : '';

    item.innerHTML = `
      <div class="result-summary">
        <span class="${statusClass}">${checkbox}</span>
        <strong>${result.id}</strong>
        <span class="result-message">${result.message}</span>
        ${zoomButton}
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
        if (!e.target.classList.contains("zoom-to-error")) {
          detailsDiv.classList.toggle("collapsed");
        }
      });
    }

    // Add zoom button handler
    const zoomBtn = item.querySelector(".zoom-to-error");
    if (zoomBtn) {
      zoomBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const boyX = parseFloat(zoomBtn.dataset.boyX);
        const boyZ = parseFloat(zoomBtn.dataset.boyZ);
        zoomToBoy(boyX, boyZ);
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

// Auto-initialize when loaded
if (typeof document !== "undefined" && document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDiagnosticsUI);
} else if (typeof document !== "undefined") {
  initDiagnosticsUI();
}
