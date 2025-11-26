/**
 * Diagnostic Runner
 *
 * Manages and executes diagnostic tests on WUP models.
 * Can run individual diagnostics or all diagnostics at once.
 */

import { runBoyDiagnostics, formatDiagnosticReport as formatBoyReport } from "./boy-diagnostics.js";
import { runOutletDiagnostics, formatOutletReport } from "./outlet-diagnostics.js";
import { runNrDiagnostics, formatNrReport } from "./nr-diagnostics.js";
import { runPlateMislabelDiagnostics, formatPlateMislabelReport } from "./plate-mislabel-diagnostics.js";

/**
 * Registry of available diagnostics
 */
const DIAGNOSTICS = {
  boy: {
    name: "BOY Operations",
    description: "Validates BOY (Blind Operation Y-axis) drilling operations",
    runner: runBoyDiagnostics,
    formatter: formatBoyReport
  },
  outlet: {
    name: "Electrical Outlets",
    description: "Detects legacy electrical outlet cuts with box and circular cuts",
    runner: runOutletDiagnostics,
    formatter: formatOutletReport
  },
  nr: {
    name: "NR Operations",
    description: "Validates NR (Nail Row) operations: control code, structural member positioning, and edge distances",
    runner: runNrDiagnostics,
    formatter: formatNrReport
  },
  plates: {
    name: "Plate Integrity",
    description: "Detects mislabelled OG/UG components: multiple plates, short spans, and overlapping plates",
    runner: runPlateMislabelDiagnostics,
    formatter: formatPlateMislabelReport
  }
  // Future diagnostics can be added here:
  // paf: { ... },
  // etc.
};

/**
 * Run a specific diagnostic by key
 */
export function runDiagnostic(diagnosticKey, model) {
  const diagnostic = DIAGNOSTICS[diagnosticKey];

  if (!diagnostic) {
    return {
      success: false,
      error: `Unknown diagnostic: ${diagnosticKey}`,
      availableDiagnostics: Object.keys(DIAGNOSTICS)
    };
  }

  try {
    const results = diagnostic.runner(model);
    return {
      success: true,
      diagnosticKey,
      name: diagnostic.name,
      description: diagnostic.description,
      results,
      textReport: diagnostic.formatter(results)
    };
  } catch (err) {
    return {
      success: false,
      diagnosticKey,
      name: diagnostic.name,
      error: `Diagnostic failed: ${err.message}`,
      stack: err.stack
    };
  }
}

/**
 * Run all available diagnostics
 */
export function runAllDiagnostics(model) {
  const allResults = {
    timestamp: new Date().toISOString(),
    model: {
      studs: model?.studs?.length || 0,
      blocking: model?.blocking?.length || 0,
      plates: model?.plates?.length || 0,
      sheathing: model?.sheathing?.length || 0,
      boyOperations: model?.boyOperations?.length || 0,
      pafRoutings: model?.pafRoutings?.length || 0,
      nailRows: model?.nailRows?.length || 0
    },
    diagnostics: {}
  };

  for (const [key, diagnostic] of Object.entries(DIAGNOSTICS)) {
    allResults.diagnostics[key] = runDiagnostic(key, model);
  }

  return allResults;
}

/**
 * Get list of available diagnostics
 */
export function getAvailableDiagnostics() {
  return Object.entries(DIAGNOSTICS).map(([key, diagnostic]) => ({
    key,
    name: diagnostic.name,
    description: diagnostic.description
  }));
}

/**
 * Format all diagnostic results as a combined text report
 */
export function formatAllDiagnosticsReport(allResults) {
  let report = `WUP Model Diagnostics Report\n`;
  report += `${'='.repeat(70)}\n`;
  report += `Timestamp: ${allResults.timestamp}\n\n`;

  report += `Model Summary:\n`;
  report += `  Studs: ${allResults.model.studs}\n`;
  report += `  Blocking: ${allResults.model.blocking}\n`;
  report += `  Plates: ${allResults.model.plates}\n`;
  report += `  Sheathing Panels: ${allResults.model.sheathing}\n`;
  report += `  BOY Operations: ${allResults.model.boyOperations}\n`;
  report += `  PAF Routings: ${allResults.model.pafRoutings}\n`;
  report += `  Nail Rows: ${allResults.model.nailRows}\n\n`;

  report += `${'='.repeat(70)}\n\n`;

  for (const [key, diagnostic] of Object.entries(allResults.diagnostics)) {
    if (diagnostic.success) {
      report += `${diagnostic.name}\n`;
      report += `${'-'.repeat(70)}\n`;
      report += `${diagnostic.textReport}\n`;
      report += `${'='.repeat(70)}\n\n`;
    } else {
      report += `${diagnostic.name}\n`;
      report += `${'-'.repeat(70)}\n`;
      report += `ERROR: ${diagnostic.error}\n\n`;
      report += `${'='.repeat(70)}\n\n`;
    }
  }

  return report;
}

/**
 * Save diagnostic results to a file (browser download)
 */
export function saveDiagnosticResults(results, filename = "diagnostic-report.txt") {
  let content;

  if (results.diagnostics) {
    // All diagnostics result
    content = formatAllDiagnosticsReport(results);
  } else if (results.textReport) {
    // Single diagnostic result
    content = results.textReport;
  } else {
    content = JSON.stringify(results, null, 2);
  }

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Make functions available globally
if (typeof window !== "undefined") {
  window.runDiagnostic = runDiagnostic;
  window.runAllDiagnostics = runAllDiagnostics;
  window.getAvailableDiagnostics = getAvailableDiagnostics;
  window.formatAllDiagnosticsReport = formatAllDiagnosticsReport;
  window.saveDiagnosticResults = saveDiagnosticResults;
}
