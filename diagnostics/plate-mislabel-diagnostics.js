/**
 * Plate Mislabel Diagnostics
 *
 * Detects misuse of OG/UG components as described in the WUP spec:
 * 1) At most one OG (top plate) and one UG (bottom plate) per element.
 * 2) Plates should span the element length (<=20% shortfall is flagged).
 * 3) Multiple plates of the same role must not overlap (likely mislabelled studs/blocking).
 */

const MIN_LENGTH_RATIO = 0.8; // Plate should span at least 80% of ELM length
const OVERLAP_TOLERANCE = 0.5; // mm tolerance when checking overlaps

export function runPlateMislabelDiagnostics(model) {
  if (!model || !Array.isArray(model.plates)) {
    return {
      success: false,
      error: "Invalid model: no plates found",
      checks: []
    };
  }

  const plates = model.plates || [];
  const wallWidth = model.wall?.width ?? null;

  const topPlates = plates.filter(p => p.role === "top");
  const bottomPlates = plates.filter(p => p.role === "bottom");

  const results = {
    summary: {
      totalPlates: plates.length,
      topPlates: topPlates.length,
      bottomPlates: bottomPlates.length,
      passed: 0,
      failed: 0
    },
    checks: [
      {
        name: "Single Plate Per Role",
        description: "There should be only one OG (top) and one UG (bottom) plate per element.",
        results: []
      },
      {
        name: "Plate Span Coverage",
        description: `Plates should cover the element length; anything shorter than ${(MIN_LENGTH_RATIO * 100).toFixed(0)}% is flagged.`,
        results: []
      },
      {
        name: "Overlapping Plates",
        description: "Multiple plates of the same role must not overlap in plan view; overlaps suggest mislabelled studs/blocking.",
        results: []
      }
    ]
  };

  // Check 1: Single plate per role
  addRoleCountCheck(results, "top", topPlates);
  addRoleCountCheck(results, "bottom", bottomPlates);

  // Check 2: Span coverage per plate
  plates.forEach((plate, index) => {
    const length = Number.isFinite(plate.width) ? plate.width : null;
    const ratio = wallWidth && length ? length / wallWidth : null;
    const passed = ratio === null ? true : ratio >= MIN_LENGTH_RATIO;
    const message =
      ratio === null
        ? "Element length unknown; length check skipped"
        : passed
          ? `Length OK (${(ratio * 100).toFixed(1)}% of element length)`
          : `Plate is short (${(ratio * 100).toFixed(1)}% of element length, expected at least ${(MIN_LENGTH_RATIO * 100).toFixed(0)}%)`;

    recordResult(results, 1, {
      id: buildPlateId(plate, index),
      plate,
      passed,
      message,
      details: {
        role: plate.role || "unknown",
        length: length?.toFixed ? length.toFixed(1) : null,
        wallWidth: wallWidth?.toFixed ? wallWidth.toFixed(1) : null,
        ratio: ratio === null ? null : (ratio * 100).toFixed(1),
        minimumRatioPercent: (MIN_LENGTH_RATIO * 100).toFixed(0)
      }
    });
  });

  // Check 3: Overlapping plates in same role
  checkOverlap(results, "top", topPlates);
  checkOverlap(results, "bottom", bottomPlates);

  return results;
}

function addRoleCountCheck(results, role, plates) {
  const count = plates.length;
  const passed = count <= 1;
  recordResult(results, 0, {
    id: `${role.toUpperCase()} plates`,
    passed,
    message: passed
      ? "Count OK (1 or fewer)"
      : `Found ${count} ${role} plates; expected a single OG/UG per element`,
    details: { count, expectedMax: 1 }
  });
}

function checkOverlap(results, role, plates) {
  if (plates.length <= 1) {
    return;
  }

  // Sort by x for stable pair generation
  const sorted = [...plates].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      const overlap = computeOverlap(a, b);
      if (overlap <= OVERLAP_TOLERANCE) {
        continue;
      }
      recordResult(results, 2, {
        id: `${role.toUpperCase()} overlap ${i + 1}-${j + 1}`,
        passed: false,
        message: `Overlapping ${role} plates (${overlap.toFixed(1)}mm overlap); likely mislabelled studs/blocking`,
        details: {
          overlap: overlap.toFixed(1),
          a: summarizePlate(a),
          b: summarizePlate(b)
        }
      });
    }
  }
}

function computeOverlap(a, b) {
  if (!a || !b) {
    return 0;
  }
  const aStart = Number.isFinite(a.x) ? a.x : 0;
  const bStart = Number.isFinite(b.x) ? b.x : 0;
  const aEnd = aStart + (Number.isFinite(a.width) ? a.width : 0);
  const bEnd = bStart + (Number.isFinite(b.width) ? b.width : 0);
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

function buildPlateId(plate, index) {
  const role = plate.role ? plate.role.toUpperCase() : "PLATE";
  const x = Number.isFinite(plate.x) ? plate.x.toFixed(1) : "?";
  const y = Number.isFinite(plate.y) ? plate.y.toFixed(1) : "?";
  return `${role} #${index + 1} (x=${x}, y=${y})`;
}

function summarizePlate(plate) {
  return {
    x: Number.isFinite(plate.x) ? plate.x.toFixed(1) : null,
    y: Number.isFinite(plate.y) ? plate.y.toFixed(1) : null,
    length: Number.isFinite(plate.width) ? plate.width.toFixed(1) : null,
    thickness: Number.isFinite(plate.height) ? plate.height.toFixed(1) : null,
    role: plate.role || "unknown"
  };
}

function recordResult(results, checkIndex, entry) {
  const check = results.checks[checkIndex];
  check.results.push(entry);
  if (entry.passed) {
    results.summary.passed += 1;
  } else {
    results.summary.failed += 1;
  }
}

/**
 * Format diagnostic results as a text report
 */
export function formatPlateMislabelReport(results) {
  if (!results || results.error) {
    return `Error: ${results?.error || "Unknown error"}`;
  }

  let report = `Plate Mislabel Diagnostics Report\n`;
  report += `${"=".repeat(60)}\n\n`;
  report += `Total plates: ${results.summary.totalPlates}\n`;
  report += `Top plates: ${results.summary.topPlates}\n`;
  report += `Bottom plates: ${results.summary.bottomPlates}\n`;
  report += `Failed checks: ${results.summary.failed}\n`;
  report += `Passed checks: ${results.summary.passed}\n\n`;

  results.checks.forEach(check => {
    report += `${check.name}\n`;
    report += `${"-".repeat(60)}\n`;
    report += `${check.description}\n\n`;

    const passed = check.results.filter(r => r.passed).length;
    const failed = check.results.filter(r => !r.passed).length;
    report += `Passed: ${passed}/${check.results.length}\n`;
    report += `Failed: ${failed}/${check.results.length}\n\n`;

    if (failed > 0) {
      report += `Failed items:\n`;
      check.results
        .filter(r => !r.passed)
        .forEach(result => {
          report += `  - ${result.id}: ${result.message}\n`;
          if (result.details && Object.keys(result.details).length > 0) {
            Object.entries(result.details).forEach(([key, value]) => {
              const label = key.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase());
              report += `    ${label}: ${typeof value === "object" ? JSON.stringify(value) : value}\n`;
            });
          }
        });
      report += `\n`;
    }
  });

  return report;
}

// Expose for browser environments
if (typeof window !== "undefined") {
  window.runPlateMislabelDiagnostics = runPlateMislabelDiagnostics;
  window.formatPlateMislabelReport = formatPlateMislabelReport;
}
