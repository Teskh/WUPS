/**
 * Plate Mislabel Diagnostics
 *
 * Detects misuse of OG/UG components while allowing legitimate splicing:
 * 1) Coverage & splices: Union of plates per role should cover the element (default >=80%) with a reasonable splice count.
 * 2) Short segments: Flags plate segments that are unusually short relative to element length (default <20%).
 * 3) Overlaps: Plates of the same role must not overlap; overlaps suggest mislabelled studs/blocking.
 */

const MIN_COVERAGE_RATIO = 0.8; // Unioned plate coverage should be at least 80% of ELM length
const MAX_SPLICES = 4; // Allow up to 4 segments per role before warning/fail
const SHORT_SEGMENT_RATIO = 0.2; // Segments shorter than 20% of ELM length are suspicious
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
        name: "Coverage & Splice Count",
        description: `Union coverage per role should be >= ${(MIN_COVERAGE_RATIO * 100).toFixed(0)}% of element length with no excessive splicing.`,
        results: []
      },
      {
        name: "Short Segment Detection",
        description: `Individual plate segments shorter than ${(SHORT_SEGMENT_RATIO * 100).toFixed(0)}% of element length are flagged.`,
        results: []
      },
      {
        name: "Overlapping Plates",
        description: "Multiple plates of the same role must not overlap in plan view; overlaps suggest mislabelled studs/blocking.",
        results: []
      }
    ]
  };

  // Check 1: Coverage & splice count (per role)
  addCoverageAndSpliceCheck(results, "top", topPlates, wallWidth);
  addCoverageAndSpliceCheck(results, "bottom", bottomPlates, wallWidth);

  // Check 2: Short segments
  addShortSegmentChecks(results, "top", topPlates, wallWidth);
  addShortSegmentChecks(results, "bottom", bottomPlates, wallWidth);

  // Check 3: Overlapping plates in same role
  checkOverlap(results, "top", topPlates);
  checkOverlap(results, "bottom", bottomPlates);

  return results;
}

function addCoverageAndSpliceCheck(results, role, plates, wallWidth) {
  const coverage = computeCoverage(plates);
  const coverageRatio = wallWidth ? coverage / wallWidth : null;
  const count = plates.length;

  const passedCoverage = coverageRatio === null ? true : coverageRatio >= MIN_COVERAGE_RATIO;
  const passedCount = count <= MAX_SPLICES;
  const passed = passedCoverage && passedCount;

  let message;
  if (coverageRatio === null) {
    message = passedCount ? "Element length unknown; count OK" : `Element length unknown; splice count high (${count})`;
  } else if (!passedCoverage && !passedCount) {
    message = `Low coverage (${(coverageRatio * 100).toFixed(1)}%) and high splice count (${count}, max ${MAX_SPLICES})`;
  } else if (!passedCoverage) {
    message = `Coverage too low (${(coverageRatio * 100).toFixed(1)}% of element; need ${(MIN_COVERAGE_RATIO * 100).toFixed(0)}%)`;
  } else if (!passedCount) {
    message = `Excessive splicing (${count} segments; max ${MAX_SPLICES})`;
  } else {
    message = `Coverage OK (${(coverageRatio * 100).toFixed(1)}%), splice count OK (${count})`;
  }

  recordResult(results, 0, {
    id: `${role.toUpperCase()} coverage`,
    passed,
    message,
    details: {
      role,
      coverage: coverage.toFixed(1),
      wallWidth: wallWidth?.toFixed ? wallWidth.toFixed(1) : null,
      coveragePercent: coverageRatio === null ? null : (coverageRatio * 100).toFixed(1),
      minCoveragePercent: (MIN_COVERAGE_RATIO * 100).toFixed(0),
      count,
      maxSplices: MAX_SPLICES
    }
  });
}

function addShortSegmentChecks(results, role, plates, wallWidth) {
  if (!wallWidth) {
    return;
  }
  plates.forEach((plate, index) => {
    const length = Number.isFinite(plate.width) ? plate.width : null;
    const ratio = length ? length / wallWidth : null;
    const passed = ratio === null ? true : ratio >= SHORT_SEGMENT_RATIO;
    const message =
      ratio === null
        ? "Length unknown; skipping"
        : passed
          ? `Length OK (${(ratio * 100).toFixed(1)}% of element)`
          : `Segment is short (${(ratio * 100).toFixed(1)}% of element; threshold ${(SHORT_SEGMENT_RATIO * 100).toFixed(0)}%)`;

    recordResult(results, 1, {
      id: buildPlateId(plate, index, role),
      plate,
      passed,
      message,
      details: {
        role: plate.role || role,
        length: length?.toFixed ? length.toFixed(1) : null,
        wallWidth: wallWidth?.toFixed ? wallWidth.toFixed(1) : null,
        ratio: ratio === null ? null : (ratio * 100).toFixed(1),
        minimumRatioPercent: (SHORT_SEGMENT_RATIO * 100).toFixed(0)
      }
    });
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

function computeCoverage(plates) {
  if (!plates.length) {
    return 0;
  }
  const intervals = plates
    .map(plate => {
      const start = Number.isFinite(plate.x) ? plate.x : 0;
      const end = start + (Number.isFinite(plate.width) ? plate.width : 0);
      return [start, end];
    })
    .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[1] >= pair[0]);

  if (!intervals.length) {
    return 0;
  }

  intervals.sort((a, b) => a[0] - b[0]);
  let coverage = 0;
  let [curStart, curEnd] = intervals[0];

  for (let i = 1; i < intervals.length; i += 1) {
    const [start, end] = intervals[i];
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      coverage += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  coverage += curEnd - curStart;
  return coverage;
}

function buildPlateId(plate, index, defaultRole) {
  const role = plate.role ? plate.role.toUpperCase() : (defaultRole || "PLATE").toUpperCase();
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
