/**
 * NR (Nail Row) Operations Diagnostics
 *
 * Validates NR operations against quality standards:
 * 1. Control Code Check: NR control code (gauge) must be 10
 * 2. Structural Member Check: NR must be positioned over a structural member (bounding box containment)
 * 3. Edge Distance Check: NR must be at least 12mm from horizontal edges and 10mm from vertical edges of the structural member
 */

export function runNrDiagnostics(model) {
  if (!model || !Array.isArray(model.nailRows)) {
    return {
      success: false,
      error: "Invalid model: no nail rows found",
      checks: []
    };
  }

  const nailRows = model.nailRows;
  const studs = model.studs || [];
  const blocking = model.blocking || [];
  const plates = model.plates || [];

  // All structural members that NR operations should be over
  const structuralMembers = [...studs, ...blocking, ...plates];

  const results = {
    summary: {
      total: nailRows.length,
      passed: 0,
      failed: 0
    },
    checks: [
      {
        name: "Control Code Check",
        description: "NR control code (gauge) must be 10",
        results: []
      },
      {
        name: "Structural Member Check",
        description: "NR must be positioned over a structural member (bounding box containment)",
        results: []
      },
      {
        name: "Edge Distance Check",
        description: "NR must be at least 12mm from horizontal edges and 10mm from vertical edges of the structural member",
        results: []
      }
    ]
  };

  nailRows.forEach((nr, index) => {
    const nrId = `NR #${index + 1} (${nr.start.x.toFixed(1)},${nr.start.y.toFixed(1)}) to (${nr.end.x.toFixed(1)},${nr.end.y.toFixed(1)})`;

    // Find the structural member this NR is over
    const associatedMember = findAssociatedStructuralMember(nr, structuralMembers);

    // Check 1: Control Code (gauge should be 10)
    const controlCodeResult = checkControlCode(nr);
    results.checks[0].results.push({
      id: nrId,
      nr,
      element: associatedMember,
      passed: controlCodeResult.passed,
      message: controlCodeResult.message,
      details: controlCodeResult.details
    });

    // Check 2: Structural Member (NR must be over a structural member)
    const structuralMemberResult = checkStructuralMember(nr, structuralMembers);
    results.checks[1].results.push({
      id: nrId,
      nr,
      element: structuralMemberResult.associatedMember,
      passed: structuralMemberResult.passed,
      message: structuralMemberResult.message,
      details: structuralMemberResult.details
    });

    // Check 3: Edge Distance (at least 10mm from nearest edge)
    const edgeDistanceResult = checkEdgeDistance(nr, associatedMember || structuralMemberResult.associatedMember);
    results.checks[2].results.push({
      id: nrId,
      nr,
      element: associatedMember || structuralMemberResult.associatedMember,
      passed: edgeDistanceResult.passed,
      message: edgeDistanceResult.message,
      details: edgeDistanceResult.details
    });

    // Update summary
    const allChecksPassed = controlCodeResult.passed && structuralMemberResult.passed && edgeDistanceResult.passed;
    if (allChecksPassed) {
      results.summary.passed++;
    } else {
      results.summary.failed++;
    }
  });

  return results;
}

/**
 * Find the structural member that contains the nail row
 */
function findAssociatedStructuralMember(nr, structuralMembers) {
  const tolerance = 1; // mm tolerance for containment check

  // A nail row is over a structural member if both its start and end points
  // are within the structural member's bounding box
  for (const member of structuralMembers) {
    if (!Number.isFinite(member.x) || !Number.isFinite(member.y) ||
        !Number.isFinite(member.width) || !Number.isFinite(member.height)) {
      continue;
    }

    const minX = member.x - tolerance;
    const maxX = member.x + member.width + tolerance;
    const minY = member.y - tolerance;
    const maxY = member.y + member.height + tolerance;

    const startContained = nr.start.x >= minX && nr.start.x <= maxX &&
                          nr.start.y >= minY && nr.start.y <= maxY;
    const endContained = nr.end.x >= minX && nr.end.x <= maxX &&
                        nr.end.y >= minY && nr.end.y <= maxY;

    if (startContained && endContained) {
      return member;
    }
  }

  return null;
}

/**
 * Check 1: Control code (gauge) must be 10
 */
function checkControlCode(nr) {
  const EXPECTED_GAUGE = 10;

  const gauge = Number.isFinite(nr.gauge) ? nr.gauge : null;

  if (gauge === null) {
    return {
      passed: false,
      message: `Control code not specified`,
      details: {
        gauge: null,
        expected: EXPECTED_GAUGE
      }
    };
  }

  const passed = gauge === EXPECTED_GAUGE;

  return {
    passed,
    message: passed
      ? `Control code OK (gauge=${gauge})`
      : `Incorrect control code (gauge=${gauge}, expected ${EXPECTED_GAUGE})`,
    details: {
      gauge,
      expected: EXPECTED_GAUGE
    }
  };
}

/**
 * Check 2: NR must be over a structural member
 */
function checkStructuralMember(nr, structuralMembers) {
  const associatedMember = findAssociatedStructuralMember(nr, structuralMembers);

  if (!associatedMember) {
    return {
      passed: false,
      associatedMember: null,
      message: `Not positioned over a structural member`,
      details: {
        nrStart: `(${nr.start.x.toFixed(1)}, ${nr.start.y.toFixed(1)})`,
        nrEnd: `(${nr.end.x.toFixed(1)}, ${nr.end.y.toFixed(1)})`
      }
    };
  }

  // Determine member type based on properties
  let memberType = "structural member";
  if (associatedMember.orientation === "vertical") {
    memberType = "stud";
  } else if (associatedMember.orientation === "horizontal") {
    if (associatedMember.y < 100) {
      memberType = "bottom plate";
    } else if (associatedMember.y > 2000) {
      memberType = "top plate";
    } else {
      memberType = "blocking";
    }
  }

  return {
    passed: true,
    associatedMember,
    message: `Positioned over ${memberType} at (${associatedMember.x.toFixed(1)}, ${associatedMember.y.toFixed(1)})`,
    details: {
      memberType,
      memberPosition: `(${associatedMember.x.toFixed(1)}, ${associatedMember.y.toFixed(1)})`,
      memberSize: `${associatedMember.width.toFixed(1)}mm × ${associatedMember.height.toFixed(1)}mm`
    }
  };
}

/**
 * Check 3: Distance to nearest edge of structural member must be at least
 *          12mm for horizontal edges and 10mm for vertical edges
 */
function checkEdgeDistance(nr, member) {
  const MIN_EDGE_DISTANCE_HORIZONTAL = 12; // mm (top/bottom)
  const MIN_EDGE_DISTANCE_VERTICAL = 10; // mm (left/right)

  if (!member) {
    return {
      passed: false,
      message: `No associated structural member found for edge distance check`,
      details: {}
    };
  }

  if (!Number.isFinite(member.x) || !Number.isFinite(member.y) ||
      !Number.isFinite(member.width) || !Number.isFinite(member.height)) {
    return {
      passed: false,
      message: `Invalid structural member geometry`,
      details: {}
    };
  }

  // Calculate distances from nail row to each edge of the structural member
  // The nail row is a line from start to end
  const memberMinX = member.x;
  const memberMaxX = member.x + member.width;
  const memberMinY = member.y;
  const memberMaxY = member.y + member.height;

  // Calculate minimum distance from the nail row line to each edge
  // For a horizontal or vertical nail row, this is simpler
  const isHorizontal = Math.abs(nr.start.y - nr.end.y) < 1e-6;
  const isVertical = Math.abs(nr.start.x - nr.end.x) < 1e-6;

  let distanceToLeft, distanceToRight, distanceToBottom, distanceToTop;

  if (isHorizontal) {
    // Horizontal nail row
    const y = nr.start.y;
    const minX = Math.min(nr.start.x, nr.end.x);
    const maxX = Math.max(nr.start.x, nr.end.x);

    distanceToLeft = minX - memberMinX;
    distanceToRight = memberMaxX - maxX;
    distanceToBottom = y - memberMinY;
    distanceToTop = memberMaxY - y;
  } else if (isVertical) {
    // Vertical nail row
    const x = nr.start.x;
    const minY = Math.min(nr.start.y, nr.end.y);
    const maxY = Math.max(nr.start.y, nr.end.y);

    distanceToLeft = x - memberMinX;
    distanceToRight = memberMaxX - x;
    distanceToBottom = minY - memberMinY;
    distanceToTop = memberMaxY - maxY;
  } else {
    // Diagonal nail row - calculate distance to each edge
    // For simplicity, check the endpoints
    const startDistances = [
      nr.start.x - memberMinX,
      memberMaxX - nr.start.x,
      nr.start.y - memberMinY,
      memberMaxY - nr.start.y
    ];
    const endDistances = [
      nr.end.x - memberMinX,
      memberMaxX - nr.end.x,
      nr.end.y - memberMinY,
      memberMaxY - nr.end.y
    ];

    distanceToLeft = Math.min(startDistances[0], endDistances[0]);
    distanceToRight = Math.min(startDistances[1], endDistances[1]);
    distanceToBottom = Math.min(startDistances[2], endDistances[2]);
    distanceToTop = Math.min(startDistances[3], endDistances[3]);
  }

  const distances = {
    left: distanceToLeft,
    right: distanceToRight,
    bottom: distanceToBottom,
    top: distanceToTop
  };

  const requirements = {
    left: MIN_EDGE_DISTANCE_VERTICAL,
    right: MIN_EDGE_DISTANCE_VERTICAL,
    top: MIN_EDGE_DISTANCE_HORIZONTAL,
    bottom: MIN_EDGE_DISTANCE_HORIZONTAL
  };

  const failingEdges = Object.entries(distances)
    .filter(([edge, distance]) => distance < requirements[edge]);

  const minDistance = Math.min(...Object.values(distances));

  // Determine which edge is closest
  let closestEdge = "left";
  let closestDist = distanceToLeft;
  if (distanceToRight < closestDist) {
    closestEdge = "right";
    closestDist = distanceToRight;
  }
  if (distanceToBottom < closestDist) {
    closestEdge = "bottom";
    closestDist = distanceToBottom;
  }
  if (distanceToTop < closestDist) {
    closestEdge = "top";
    closestDist = distanceToTop;
  }

  const passed = failingEdges.length === 0;

  return {
    passed,
    message: passed
      ? `Edge distance OK (${closestDist.toFixed(1)}mm from ${closestEdge} edge, minimum ${requirements[closestEdge]}mm required for that edge)`
      : `Too close to edge (${failingEdges[0][1].toFixed(1)}mm from ${failingEdges[0][0]} edge, minimum ${requirements[failingEdges[0][0]]}mm required)`,
    details: {
      minDistance: minDistance.toFixed(1),
      closestEdge,
      distanceToLeft: distanceToLeft.toFixed(1),
      distanceToRight: distanceToRight.toFixed(1),
      distanceToBottom: distanceToBottom.toFixed(1),
      distanceToTop: distanceToTop.toFixed(1),
      requiredHorizontal: MIN_EDGE_DISTANCE_HORIZONTAL,
      requiredVertical: MIN_EDGE_DISTANCE_VERTICAL
    }
  };
}

/**
 * Format diagnostic results as text report
 */
export function formatNrReport(results) {
  if (!results || results.error) {
    return `Error: ${results.error || 'Unknown error'}`;
  }

  let report = `NR Operations Diagnostics Report\n`;
  report += `${'='.repeat(50)}\n\n`;
  report += `Total NR Operations: ${results.summary.total}\n`;
  report += `Passed: ${results.summary.passed}\n`;
  report += `Failed: ${results.summary.failed}\n\n`;

  results.checks.forEach(check => {
    report += `${check.name}\n`;
    report += `${'-'.repeat(50)}\n`;
    report += `${check.description}\n\n`;

    const passed = check.results.filter(r => r.passed).length;
    const failed = check.results.filter(r => !r.passed).length;
    report += `Passed: ${passed}/${check.results.length}\n`;
    report += `Failed: ${failed}/${check.results.length}\n\n`;

    if (failed > 0) {
      report += `Failed items:\n`;
      check.results.filter(r => !r.passed).forEach(result => {
        report += `  - ${result.id}: ${result.message}\n`;
        if (result.details && Object.keys(result.details).length > 0) {
          Object.entries(result.details).forEach(([key, value]) => {
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            report += `    ${label}: ${value}\n`;
          });
        }
      });
      report += `\n`;
    }
  });

  return report;
}

// Make functions available globally
if (typeof window !== "undefined") {
  window.runNrDiagnostics = runNrDiagnostics;
  window.formatNrReport = formatNrReport;
}
