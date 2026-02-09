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
        <span class="selection-warning">⚠️ No se encontraron archivos .wup en la selección (${totalFiles} archivo${totalFiles > 1 ? "s" : ""} seleccionado${totalFiles > 1 ? "s" : ""})</span>
      `;
      processButton.disabled = true;
      processButton.textContent = "Procesar Archivos";
    } else if (wupCount < totalFiles) {
      selectionInfo.innerHTML = `
        <span class="selection-success">✓ Se encontr${wupCount > 1 ? "aron" : "ó"} ${wupCount} archivo${wupCount > 1 ? "s" : ""} .wup (filtrado${wupCount > 1 ? "s" : ""} de ${totalFiles} archivo${totalFiles > 1 ? "s" : ""} total${totalFiles > 1 ? "es" : ""})</span>
      `;
      processButton.disabled = false;
      processButton.textContent = `Procesar ${wupCount} Archivo${wupCount > 1 ? "s" : ""} .wup`;
    } else {
      selectionInfo.innerHTML = `
        <span class="selection-success">✓ Seleccionado${wupCount > 1 ? "s" : ""} ${wupCount} archivo${wupCount > 1 ? "s" : ""} .wup</span>
      `;
      processButton.disabled = false;
      processButton.textContent = `Procesar ${wupCount} Archivo${wupCount > 1 ? "s" : ""}`;
    }
  } else {
    selectionInfo.classList.add("hidden");
    processButton.disabled = true;
    processButton.textContent = "Procesar Archivos";
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
    updateProgress(i, selectedFiles.length, `Procesando ${file.name}...`);

    const result = await processFile(file);
    processedResults.push(result);
  }

  // Update to completion
  updateProgress(selectedFiles.length, selectedFiles.length, "Procesamiento completado");

  // Show results
  displayResults();
}

/**
 * Update progress bar and text
 */
function updateProgress(current, total, message) {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${current} / ${total} archivos procesados`;

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
      throw new Error("Error al analizar el archivo WUP");
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
        console.error("Faltan datos de reemplazo para la salida, omitiendo");
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
        console.error(`Error al modernizar la salida ${outlet.id}:`, err);
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
    console.error("No se pudo encontrar el ruteo objetivo con id:", boxId);
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
    console.error("No se encontraron índices de declaración para los ruteos a eliminar");
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
    console.error("Error al volver a analizar WUP después del reemplazo de salida");
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
        <span class="summary-label">Archivos Totales:</span>
        <span class="summary-value">${totalFiles}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Archivos Modificados:</span>
        <span class="summary-value success">${filesModified}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Archivos con Salidas Legadas:</span>
        <span class="summary-value">${filesWithOutlets}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Salidas Legadas Encontradas:</span>
        <span class="summary-value">${totalOutletsFound}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Salidas Modernizadas:</span>
        <span class="summary-value success">${totalOutletsModernized}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Fallidos:</span>
        <span class="summary-value ${failedFiles > 0 ? 'error' : ''}">${failedFiles}</span>
      </div>
    </div>
  `;

  // Display individual file results
  fileResults.innerHTML = processedResults.map(result => {
    const statusClass = result.success ? 'success' : 'error';
    const statusText = result.success
      ? (result.outletsModernized > 0 ? `✓ Modificado (${result.outletsModernized} salidas)` : '✓ No requiere cambios')
      : `✗ Error: ${result.error}`;

    return `
      <div class="file-result ${statusClass}">
        <div class="file-result-header">
          <span class="filename">${result.filename}</span>
          <span class="status">${statusText}</span>
        </div>
        ${result.legacyOutletsFound > 0 ? `
          <div class="file-result-details">
            <p>Salidas legadas encontradas: ${result.legacyOutletsFound}</p>
            ${result.replacements.map(r =>
              `<p class="replacement-detail">• ${r.id} - salida ${r.orientation === 'horizontal' ? 'horizontal' : 'vertical'} en (${r.center.x.toFixed(1)}, ${r.center.y.toFixed(1)})</p>`
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
    alert("No hay archivos modificados para descargar");
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
  downloadFile(report, `reporte-modernizador-salidas-${timestamp}.txt`);
}

/**
 * Generate text report
 */
function generateReport() {
  const totalFiles = processedResults.length;
  const filesModified = processedResults.filter(r => r.outletsModernized > 0).length;
  const totalOutlets = processedResults.reduce((sum, r) => sum + r.outletsModernized, 0);

  let report = "REPORTE DEL MODERNIZADOR DE SALIDAS EN LOTE\n";
  report += "=".repeat(60) + "\n\n";
  report += `Generado: ${new Date().toLocaleString()}\n\n`;
  report += `Archivos Totales Procesados: ${totalFiles}\n`;
  report += `Archivos Modificados: ${filesModified}\n`;
  report += `Total de Salidas Modernizadas: ${totalOutlets}\n\n`;
  report += "=".repeat(60) + "\n\n";

  processedResults.forEach(result => {
    report += `Archivo: ${result.filename}\n`;
    report += "-".repeat(60) + "\n";

    if (!result.success) {
      report += `Estado: FALLIDO\n`;
      report += `Error: ${result.error}\n\n`;
      return;
    }

    if (result.outletsModernized === 0) {
      report += `Estado: No requiere cambios\n`;
      report += `Salidas legadas encontradas: ${result.legacyOutletsFound}\n\n`;
      return;
    }

    report += `Estado: ÉXITO\n`;
    report += `Salidas legadas encontradas: ${result.legacyOutletsFound}\n`;
    report += `Salidas modernizadas: ${result.outletsModernized}\n`;

    if (result.replacements.length > 0) {
      report += `\nReemplazos:\n`;
      result.replacements.forEach(r => {
        const orientationEs = r.orientation === "vertical" ? "vertical" : "horizontal";
        report += `  - ${r.id}\n`;
        report += `    Orientación: ${orientationEs}\n`;
        report += `    Centro: (${r.center.x.toFixed(1)}, ${r.center.y.toFixed(1)})\n`;
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
  processButton.textContent = "Procesar Archivos";
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
    reader.onerror = e => reject(new Error("Error al leer el archivo"));
    reader.readAsText(file);
  });
}

// Initialize on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}