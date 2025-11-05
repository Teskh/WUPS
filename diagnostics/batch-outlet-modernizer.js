/**
 * Batch Outlet Modernizer
 *
 * Processes WUP files to replace legacy electrical outlets with modern format.
 */

import { parseWup } from "../wup-parser.js";
import { runOutletDiagnostics } from "./outlet-diagnostics.js";
import { createModernOutletRouting } from "./outlet-modernizer.js";
import { serializeWup } from "../editor/io/wup-serializer.js";

// UI Elements
let fileInput;
let directoryInput;
let processButton;
let progressSection;
let progressFill;
let progressText;
let resultsSection;
let summary;
let fileResults;
let downloadAllButton;
let downloadReportButton;
let resetButton;
let singleFileRadio;
let directoryRadio;
let selectionInfo;

// State
let selectedFiles = [];
let processedResults = [];

/**
 * Initialize the application
 */
function init() {
  // Get UI elements
  fileInput = document.getElementById("fileInput");
  directoryInput = document.getElementById("directoryInput");
  processButton = document.getElementById("processButton");
  progressSection = document.getElementById("progressSection");
  progressFill = document.getElementById("progressFill");
  progressText = document.getElementById("progressText");
  resultsSection = document.getElementById("resultsSection");
  summary = document.getElementById("summary");
  fileResults = document.getElementById("fileResults");
  downloadAllButton = document.getElementById("downloadAllButton");
  downloadReportButton = document.getElementById("downloadReportButton");
  resetButton = document.getElementById("resetButton");
  singleFileRadio = document.getElementById("singleFileRadio");
  directoryRadio = document.getElementById("directoryRadio");
  selectionInfo = document.getElementById("selectionInfo");

  // Add event listeners
  singleFileRadio.addEventListener("change", handleInputTypeChange);
  directoryRadio.addEventListener("change", handleInputTypeChange);
  fileInput.addEventListener("change", handleFileSelection);
  directoryInput.addEventListener("change", handleFileSelection);
  processButton.addEventListener("click", handleProcess);
  downloadAllButton.addEventListener("click", handleDownloadAll);
  downloadReportButton.addEventListener("click", handleDownloadReport);
  resetButton.addEventListener("click", handleReset);

  // Enable first input by default
  handleInputTypeChange();
}

/**
 * Handle input type radio button change
 */
function handleInputTypeChange() {
  if (singleFileRadio.checked) {
    fileInput.disabled = false;
    directoryInput.disabled = true;
    directoryInput.value = "";
  } else {
    fileInput.disabled = true;
    directoryInput.disabled = false;
    fileInput.value = "";
  }
  selectedFiles = [];
  processButton.disabled = true;
  selectionInfo.classList.add("hidden");
}

/**
 * Handle file/directory selection
 */
function handleFileSelection(event) {
  const files = Array.from(event.target.files);
  const totalFiles = files.length;

  // Filter only .wup files
  selectedFiles = files.filter(file => file.name.toLowerCase().endsWith(".wup"));
  const wupCount = selectedFiles.length;

  // Show selection info
  if (totalFiles > 0) {
    selectionInfo.classList.remove("hidden");

    if (wupCount === 0) {
      selectionInfo.innerHTML = `
        <span class="selection-warning">⚠️ No .wup files found in selection (${totalFiles} file${totalFiles > 1 ? "s" : ""} selected)</span>
      `;
      processButton.disabled = true;
      processButton.textContent = "Process Files";
    } else if (wupCount < totalFiles) {
      selectionInfo.innerHTML = `
        <span class="selection-success">✓ Found ${wupCount} .wup file${wupCount > 1 ? "s" : ""} (filtered from ${totalFiles} total file${totalFiles > 1 ? "s" : ""})</span>
      `;
      processButton.disabled = false;
      processButton.textContent = `Process ${wupCount} .wup File${wupCount > 1 ? "s" : ""}`;
    } else {
      selectionInfo.innerHTML = `
        <span class="selection-success">✓ Selected ${wupCount} .wup file${wupCount > 1 ? "s" : ""}</span>
      `;
      processButton.disabled = false;
      processButton.textContent = `Process ${wupCount} File${wupCount > 1 ? "s" : ""}`;
    }
  } else {
    selectionInfo.classList.add("hidden");
    processButton.disabled = true;
    processButton.textContent = "Process Files";
  }
}

/**
 * Process all selected files
 */
async function handleProcess() {
  if (selectedFiles.length === 0) return;

  // Reset state
  processedResults = [];

  // Show progress
  progressSection.classList.remove("hidden");
  resultsSection.classList.add("hidden");
  processButton.disabled = true;

  // Process each file
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    updateProgress(i, selectedFiles.length, `Processing ${file.name}...`);

    const result = await processFile(file);
    processedResults.push(result);
  }

  // Update to completion
  updateProgress(selectedFiles.length, selectedFiles.length, "Processing complete");

  // Show results
  displayResults();
}

/**
 * Update progress bar and text
 */
function updateProgress(current, total, message) {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${current} / ${total} files processed`;

  if (message) {
    progressText.textContent += ` - ${message}`;
  }
}

/**
 * Process a single WUP file
 */
async function processFile(file) {
  const result = {
    filename: file.name,
    originalFile: file,
    success: false,
    error: null,
    legacyOutletsFound: 0,
    outletsModernized: 0,
    originalContent: null,
    modifiedContent: null,
    replacements: []
  };

  try {
    // Read file content
    const content = await readFileAsText(file);
    result.originalContent = content;

    // Parse WUP
    const model = parseWup(content);
    if (!model) {
      throw new Error("Failed to parse WUP file");
    }

    // Count total outlets first
    const initialDiagnostics = runOutletDiagnostics(model);
    if (initialDiagnostics.error) {
      throw new Error(initialDiagnostics.error);
    }
    result.legacyOutletsFound = initialDiagnostics.summary.legacyOutlets;

    // If no legacy outlets found, mark as success but no modifications needed
    if (result.legacyOutletsFound === 0) {
      result.success = true;
      result.modifiedContent = content; // Keep original
      return result;
    }

    // Process outlets one at a time, re-running diagnostics after each replacement
    // This is necessary because __editorId values change after each re-parse
    let continueReplacing = true;
    while (continueReplacing) {
      // Re-run diagnostics to get current outlet positions with current IDs
      const diagnosticResults = runOutletDiagnostics(model);

      if (diagnosticResults.error) {
        throw new Error(diagnosticResults.error);
      }

      const legacyOutlets = diagnosticResults.checks[0]?.results || [];

      if (legacyOutlets.length === 0) {
        // No more outlets to replace
        continueReplacing = false;
        break;
      }

      // Replace the first outlet found
      const outlet = legacyOutlets[0];

      if (!outlet.replacement) {
        console.error("Outlet missing replacement data, skipping");
        break;
      }

      try {
        const modernRouting = createModernOutletRouting({
          center: outlet.replacement.center,
          depth: outlet.replacement.depth,
          zValue: outlet.replacement.zValue,
          orientationValue: outlet.replacement.orientationValue,
          headerSource: outlet.replacement.headerSource,
          tool: outlet.replacement.tool,
          face: outlet.replacement.face,
          passes: outlet.replacement.passes,
          layer: outlet.replacement.layer,
          command: outlet.replacement.command,
          body: outlet.replacement.body,
          orientationType: outlet.replacement.orientation
        });

        result.replacements.push({
          id: outlet.id,
          orientation: outlet.replacement.orientation,
          center: outlet.replacement.center,
          modernRouting: modernRouting.routing
        });

        // Replace in model
        replaceOutletInModel(model, outlet.replacement, modernRouting);
        result.outletsModernized++;

      } catch (err) {
        console.error(`Failed to modernize outlet ${outlet.id}:`, err);
        // Continue to try other outlets even if one fails
        break;
      }
    }

    // Serialize the modified model
    const serialized = serializeWup(model);
    result.modifiedContent = serialized.text || serialized.fallback || content;
    result.success = true;

  } catch (err) {
    result.error = err.message;
    result.success = false;
  }

  return result;
}

/**
 * Replace legacy outlet with modern routing in the model
 * Uses the same approach as the interactive version - rebuild statements and re-parse
 * @param {object} model - The WUP model
 * @param {object} replacementData - Data about which routings to replace
 * @param {object} modernRoutingData - Object with { routing, statements, snippet }
 */
function replaceOutletInModel(model, replacementData, modernRoutingData) {
  if (!model || !Array.isArray(model.pafRoutings)) return;
  if (!Array.isArray(model.__statements) || model.__statements.length === 0) return;
  if (!modernRoutingData || !modernRoutingData.statements) return;

  const boxId = replacementData.boxRoutingEditorId;
  const circleIds = replacementData.circleRoutingEditorIds || [];
  const idsToRemove = [boxId, ...circleIds].filter(id => typeof id === "number");

  // Find the box routing and circle routings
  const targetRouting = model.pafRoutings.find(
    routing => routing && typeof routing.__editorId === "number" && routing.__editorId === boxId
  );

  if (!targetRouting) {
    console.error("Could not find target routing with id:", boxId);
    return;
  }

  const circleRoutings = circleIds
    .map(id => model.pafRoutings.find(routing => routing?.__editorId === id))
    .filter(Boolean);

  // Collect ALL statement indices from the box and circle routings
  const statementIndexSet = new Set();
  for (const routing of [targetRouting, ...circleRoutings]) {
    for (const index of routing?.__statementIndices ?? []) {
      if (Number.isInteger(index) && index >= 0) {
        statementIndexSet.add(index);
      }
    }
  }

  if (statementIndexSet.size === 0) {
    console.error("No statement indices found for routings to remove");
    return;
  }

  // Sort indices to find where to insert the new statements
  const sortedIndices = Array.from(statementIndexSet).sort((a, b) => a - b);
  const insertionIndex = sortedIndices[0];

  // Get the modern statements
  const modernStatements = modernRoutingData.statements || [];

  // Rebuild the entire statements array (like the interactive version does)
  const updatedStatements = [];
  let inserted = false;
  const indexSet = new Set(sortedIndices);

  for (let i = 0; i < model.__statements.length; i += 1) {
    // Insert modern statements at the first removed statement's position
    if (!inserted && i === insertionIndex) {
      updatedStatements.push(...modernStatements);
      inserted = true;
    }
    // Skip statements that belong to the legacy outlet
    if (indexSet.has(i)) {
      continue;
    }
    // Keep all other statements
    updatedStatements.push(model.__statements[i]);
  }

  // If we haven't inserted yet (edge case), append at end
  if (!inserted) {
    updatedStatements.push(...modernStatements);
  }

  // Rebuild the model by re-parsing the updated statements
  // This ensures everything stays in sync (just like the interactive version)
  const updatedText = `${updatedStatements.map(stmt => `${stmt.trim()};`).join("\n")}\n`;

  const reparsed = parseWup(updatedText);
  if (!reparsed) {
    console.error("Failed to re-parse WUP after outlet replacement");
    return;
  }

  // Copy all properties from the reparsed model back to the original model
  // This maintains the object reference while updating all properties
  Object.keys(model).forEach(key => delete model[key]);
  Object.assign(model, reparsed);
}

/**
 * Display processing results
 */
function displayResults() {
  progressSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");

  // Calculate summary statistics
  const totalFiles = processedResults.length;
  const successfulFiles = processedResults.filter(r => r.success).length;
  const failedFiles = totalFiles - successfulFiles;
  const filesWithOutlets = processedResults.filter(r => r.legacyOutletsFound > 0).length;
  const totalOutletsFound = processedResults.reduce((sum, r) => sum + r.legacyOutletsFound, 0);
  const totalOutletsModernized = processedResults.reduce((sum, r) => sum + r.outletsModernized, 0);
  const filesModified = processedResults.filter(r => r.outletsModernized > 0).length;

  // Display summary
  summary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Total Files:</span>
        <span class="summary-value">${totalFiles}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Files Modified:</span>
        <span class="summary-value success">${filesModified}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Files with Legacy Outlets:</span>
        <span class="summary-value">${filesWithOutlets}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Legacy Outlets Found:</span>
        <span class="summary-value">${totalOutletsFound}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Outlets Modernized:</span>
        <span class="summary-value success">${totalOutletsModernized}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Failed:</span>
        <span class="summary-value ${failedFiles > 0 ? 'error' : ''}">${failedFiles}</span>
      </div>
    </div>
  `;

  // Display individual file results
  fileResults.innerHTML = processedResults.map(result => {
    const statusClass = result.success ? 'success' : 'error';
    const statusText = result.success
      ? (result.outletsModernized > 0 ? `✓ Modified (${result.outletsModernized} outlets)` : '✓ No changes needed')
      : `✗ Error: ${result.error}`;

    return `
      <div class="file-result ${statusClass}">
        <div class="file-result-header">
          <span class="filename">${result.filename}</span>
          <span class="status">${statusText}</span>
        </div>
        ${result.legacyOutletsFound > 0 ? `
          <div class="file-result-details">
            <p>Legacy outlets found: ${result.legacyOutletsFound}</p>
            ${result.replacements.map(r =>
              `<p class="replacement-detail">• ${r.id} - ${r.orientation} outlet at (${r.center.x.toFixed(1)}, ${r.center.y.toFixed(1)})</p>`
            ).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Enable/disable download buttons
  downloadAllButton.disabled = filesModified === 0;
  downloadReportButton.disabled = false;
}

/**
 * Download all modified files as a zip (or individually)
 */
function handleDownloadAll() {
  const modifiedFiles = processedResults.filter(r => r.success && r.outletsModernized > 0);

  if (modifiedFiles.length === 0) {
    alert("No modified files to download");
    return;
  }

  // Download each file individually
  modifiedFiles.forEach(result => {
    downloadFile(result.modifiedContent, result.filename);
  });
}

/**
 * Download processing report as text file
 */
function handleDownloadReport() {
  const report = generateReport();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  downloadFile(report, `outlet-modernizer-report-${timestamp}.txt`);
}

/**
 * Generate text report
 */
function generateReport() {
  const totalFiles = processedResults.length;
  const filesModified = processedResults.filter(r => r.outletsModernized > 0).length;
  const totalOutlets = processedResults.reduce((sum, r) => sum + r.outletsModernized, 0);

  let report = "BATCH OUTLET MODERNIZER REPORT\n";
  report += "=".repeat(60) + "\n\n";
  report += `Generated: ${new Date().toLocaleString()}\n\n`;
  report += `Total Files Processed: ${totalFiles}\n`;
  report += `Files Modified: ${filesModified}\n`;
  report += `Total Outlets Modernized: ${totalOutlets}\n\n`;
  report += "=".repeat(60) + "\n\n";

  processedResults.forEach(result => {
    report += `File: ${result.filename}\n`;
    report += "-".repeat(60) + "\n";

    if (!result.success) {
      report += `Status: FAILED\n`;
      report += `Error: ${result.error}\n\n`;
      return;
    }

    if (result.outletsModernized === 0) {
      report += `Status: No changes needed\n`;
      report += `Legacy outlets found: ${result.legacyOutletsFound}\n\n`;
      return;
    }

    report += `Status: SUCCESS\n`;
    report += `Legacy outlets found: ${result.legacyOutletsFound}\n`;
    report += `Outlets modernized: ${result.outletsModernized}\n`;

    if (result.replacements.length > 0) {
      report += `\nReplacements:\n`;
      result.replacements.forEach(r => {
        report += `  - ${r.id}\n`;
        report += `    Orientation: ${r.orientation}\n`;
        report += `    Center: (${r.center.x.toFixed(1)}, ${r.center.y.toFixed(1)})\n`;
      });
    }

    report += "\n";
  });

  return report;
}

/**
 * Download a file
 */
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Reset the application
 */
function handleReset() {
  selectedFiles = [];
  processedResults = [];
  fileInput.value = "";
  directoryInput.value = "";
  processButton.disabled = true;
  processButton.textContent = "Process Files";
  resultsSection.classList.add("hidden");
  progressSection.classList.add("hidden");
  selectionInfo.classList.add("hidden");
}

/**
 * Read file as text
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = e => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

// Initialize on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
