/**
 * BOY (Blind Operation Y-axis) Diagnostics
 *
 * Validates BOY operations against quality standards:
 * 1. Direction: BOY must face inward toward the element
 * 2. Wall Thickness Edge Distance: BOY outer edge must be at least 10mm from outer/inner faces of wall (Z-axis)
 * 3. Stud Distance: BOY outer edge must be at least 10mm from nearest stud (QS) edge
 * 4. Diameter: BOY diameter must be 30mm
 */

export function runBoyDiagnostics(model) {
  if (!model || !Array.isArray(model.boyOperations)) {
    return {
      success: false,
      error: "Invalid model: no BOY operations found",
      checks: []
    };
  }

  const boyOperations = model.boyOperations;
  const studs = model.studs || [];
  const blocking = model.blocking || [];
  const plates = model.plates || [];
  const wallThickness = model.wall?.thickness || 90;
  const wallSide = model.wall?.side ?? 1;
  const wallHeight = model.wall?.height || model.view?.height || 2400;

  // All framing elements that BOY operations might be associated with
  const framingElements = [...studs, ...blocking, ...plates];

  const results = {
    summary: {
      total: boyOperations.length,
      passed: 0,
      failed: 0
    },
    checks: [
      {
        name: "Direction Check",
        description: "BOY faces inward toward the element",
        results: []
      },
      {
        name: "Wall Thickness Edge Distance Check",
        description: "BOY outer edge is at least 10mm from outer/inner faces of wall (Z-axis through-thickness)",
        results: []
      },
      {
        name: "Stud Distance Check",
        description: "BOY outer edge is at least 10mm from nearest stud (QS) edge",
        results: []
      },
      {
        name: "Diameter Check",
        description: "BOY diameter is 30mm",
        results: []
      }
    ]
  };

  boyOperations.forEach((boy, index) => {
    const boyId = `BOY #${index + 1} (x=${boy.x.toFixed(1)}, z=${boy.z.toFixed(1)})`;

    // Use targetElement if available (from parser), otherwise find it
    const associatedElement = boy.targetElement || findAssociatedElement(boy, framingElements, wallThickness, wallSide, wallHeight);
    const targetRole = boy.targetRole || (associatedElement ? inferPlateRole(associatedElement, wallHeight) : null);

    // Check 1: Direction (faces inward)
    const directionResult = checkDirection(boy, associatedElement, targetRole, wallThickness, wallSide, wallHeight);
    results.checks[0].results.push({
      id: boyId,
      boy,
      element: associatedElement,
      passed: directionResult.passed,
      message: directionResult.message,
      details: directionResult.details
    });

    // Check 2: Wall Thickness Edge Distance (>= 10mm from outer/inner face)
    const edgeResult = checkEdgeDistance(boy, associatedElement, wallThickness, wallSide);
    results.checks[1].results.push({
      id: boyId,
      boy,
      element: associatedElement,
      passed: edgeResult.passed,
      message: edgeResult.message,
      details: edgeResult.details
    });

    // Check 3: Stud Distance (>= 10mm from nearest stud edge)
    const studResult = checkStudDistance(boy, studs);
    results.checks[2].results.push({
      id: boyId,
      boy,
      element: associatedElement,
      passed: studResult.passed,
      message: studResult.message,
      details: studResult.details
    });

    // Check 4: Diameter (should be 30mm)
    const diameterResult = checkDiameter(boy);
    results.checks[3].results.push({
      id: boyId,
      boy,
      element: associatedElement,
      passed: diameterResult.passed,
      message: diameterResult.message,
      details: diameterResult.details
    });

    // Update summary
    const allChecksPassed = directionResult.passed && edgeResult.passed && studResult.passed && diameterResult.passed;
    if (allChecksPassed) {
      results.summary.passed++;
    } else {
      results.summary.failed++;
    }
  });

  return results;
}

/**
 * Find the framing element (stud, joist, or plate) associated with a BOY operation
 * This matches the logic in viewer/geometry.js:resolveBoyPlate
 */
function findAssociatedElement(boy, framingElements, wallThickness, wallSide, wallHeight) {
  const tolerance = 5; // mm tolerance for finding associated element
  const direction = determineDirection(boy, wallThickness, wallSide);

  // Filter elements that contain the BOY's X position
  const candidates = framingElements.filter(elem => {
    if (!Number.isFinite(elem.x) || !Number.isFinite(elem.width)) {
      return false;
    }
    const minX = elem.x - tolerance;
    const maxX = elem.x + elem.width + tolerance;
    return boy.x >= minX && boy.x <= maxX;
  });

  if (candidates.length === 0) {
    return null;
  }

  // Calculate plate metrics to find top/bottom positions
  let topY = null;
  let bottomY = null;
  for (const elem of candidates) {
    if (!Number.isFinite(elem.y) || !Number.isFinite(elem.height)) {
      continue;
    }
    const bottom = elem.y;
    const top = elem.y + elem.height;
    bottomY = bottomY === null ? bottom : Math.min(bottomY, bottom);
    topY = topY === null ? top : Math.max(topY, top);
  }

  // Match geometry.js logic: direction < 0 looks for top, direction >= 0 looks for bottom
  const targetY = direction < 0 ? topY : bottomY;

  // Find the element closest to the target
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const elem of candidates) {
    if (!Number.isFinite(elem.y) || !Number.isFinite(elem.height)) {
      continue;
    }

    const bottom = elem.y;
    const top = elem.y + elem.height;
    const compareValue = direction < 0 ? top : bottom;
    const yDiff = targetY === null ? 0 : Math.abs(compareValue - targetY);

    // Also consider X distance for tie-breaking
    const elemCenterX = elem.x + elem.width / 2;
    const xDiff = Math.abs(boy.x - elemCenterX);

    const score = yDiff * 10 + xDiff;

    if (score < bestScore) {
      bestScore = score;
      best = elem;
    }
  }

  return best;
}

/**
 * Determine the drilling direction based on depth and wall configuration
 */
function determineDirection(boy, wallThickness, wallSide) {
  const rawDepth = Number.isFinite(boy.depth) ? boy.depth : null;
  if (rawDepth && Math.abs(rawDepth) > 1e-6) {
    return Math.sign(rawDepth);
  }
  return wallSide >= 0 ? 1 : -1;
}

/**
 * Check 1: BOY faces inward toward the element
 */
function checkDirection(boy, element, targetRole, wallThickness, wallSide, wallHeight) {
  const direction = determineDirection(boy, wallThickness, wallSide);
  const directionLabel = direction >= 0 ? "+Y (upward)" : "-Y (downward)";

  if (!element || !targetRole) {
    return {
      passed: false,
      message: `No associated element found`,
      details: {
        direction: directionLabel,
        depth: boy.depth
      }
    };
  }

  // BOY drilling logic:
  // - Negative depth (-Y): drills downward, correct for TOP plate
  // - Positive depth (+Y): drills upward, correct for BOTTOM plate
  const isTopPlate = targetRole === 'top';
  const expectedDirection = isTopPlate ? -1 : 1;
  const passed = direction === expectedDirection;

  return {
    passed,
    message: passed
      ? `Correct (${directionLabel} on ${targetRole} plate)`
      : `Incorrect (${directionLabel} on ${targetRole} plate, expected ${expectedDirection >= 0 ? '+Y (upward)' : '-Y (downward)'})`,
    details: {
      direction: directionLabel,
      targetRole,
      expectedDirection: expectedDirection >= 0 ? '+Y (upward)' : '-Y (downward)',
      depth: boy.depth,
      plateY: element.y.toFixed(1)
    }
  };
}

/**
 * Infer plate role based on Y position
 */
function inferPlateRole(element, wallHeight) {
  if (!element || !Number.isFinite(element.y)) {
    return null;
  }
  const elementCenterY = element.y + (element.height || 0) / 2;
  const wallCenterY = wallHeight / 2;
  return elementCenterY > wallCenterY ? 'top' : 'bottom';
}

/**
 * Check 2: BOY outer edge is at least 10mm from outer/inner faces of wall (Z-axis)
 */
function checkEdgeDistance(boy, element, wallThickness, wallSide) {
  const MIN_EDGE_DISTANCE = 10; // mm

  if (!element) {
    return {
      passed: false,
      message: `No associated element found`,
      details: {}
    };
  }

  const diameter = Number.isFinite(boy.diameter) ? Math.abs(boy.diameter) : 20;
  const radius = diameter / 2;

  // Check distance from the outer edges of the wall (Z-axis)
  // boy.z is the position through the wall thickness (0 to wallThickness)
  const zPos = Number.isFinite(boy.z) ? boy.z : wallThickness / 2;

  // Distance from outer side (z=0 side)
  const distanceFromOuterSide = zPos - radius;

  // Distance from inner side (z=wallThickness side)
  const distanceFromInnerSide = wallThickness - zPos - radius;

  const minDistance = Math.min(distanceFromOuterSide, distanceFromInnerSide);
  const passed = minDistance >= MIN_EDGE_DISTANCE;

  return {
    passed,
    message: passed
      ? `Edge distance OK (${minDistance.toFixed(1)}mm from nearest edge)`
      : `Edge too close (${minDistance.toFixed(1)}mm from nearest edge, minimum ${MIN_EDGE_DISTANCE}mm required)`,
    details: {
      diameter: diameter.toFixed(1),
      zPosition: zPos.toFixed(1),
      distanceFromOuter: distanceFromOuterSide.toFixed(1),
      distanceFromInner: distanceFromInnerSide.toFixed(1),
      minDistance: minDistance.toFixed(1),
      required: MIN_EDGE_DISTANCE
    }
  };
}

/**
 * Check 3: BOY outer edge is at least 10mm from nearest stud edge
 */
function checkStudDistance(boy, studs) {
  const MIN_STUD_DISTANCE = 10; // mm

  if (!studs || studs.length === 0) {
    return {
      passed: true,
      message: `No studs in model to check`,
      details: {}
    };
  }

  const diameter = Number.isFinite(boy.diameter) ? Math.abs(boy.diameter) : 20;
  const radius = diameter / 2;

  // Find studs that could interfere with the BOY
  // BOY is positioned at (x, z) where z is through the wall
  // Studs extend vertically (Y-axis), so we need to check X-axis proximity

  let nearestStud = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const stud of studs) {
    if (!Number.isFinite(stud.x) || !Number.isFinite(stud.width)) {
      continue;
    }

    // Calculate the horizontal distance from BOY center to stud edges
    const studLeftEdge = stud.x;
    const studRightEdge = stud.x + stud.width;

    let distanceToStud;

    if (boy.x < studLeftEdge) {
      // BOY is to the left of the stud
      distanceToStud = studLeftEdge - boy.x;
    } else if (boy.x > studRightEdge) {
      // BOY is to the right of the stud
      distanceToStud = boy.x - studRightEdge;
    } else {
      // BOY center is inside the stud's X range
      // Find the closest edge
      const distToLeft = boy.x - studLeftEdge;
      const distToRight = studRightEdge - boy.x;
      distanceToStud = Math.min(distToLeft, distToRight);
    }

    if (distanceToStud < minDistance) {
      minDistance = distanceToStud;
      nearestStud = stud;
    }
  }

  if (!nearestStud) {
    return {
      passed: true,
      message: `No studs found near BOY`,
      details: {}
    };
  }

  // Calculate the actual clearance (distance from BOY outer edge to stud edge)
  const clearance = minDistance - radius;
  const passed = clearance >= MIN_STUD_DISTANCE;

  return {
    passed,
    message: passed
      ? `Stud distance OK (${clearance.toFixed(1)}mm clearance from nearest stud)`
      : `Too close to stud (${clearance.toFixed(1)}mm clearance, minimum ${MIN_STUD_DISTANCE}mm required)`,
    details: {
      diameter: diameter.toFixed(1),
      radius: radius.toFixed(1),
      boyX: boy.x.toFixed(1),
      nearestStudX: nearestStud.x.toFixed(1),
      nearestStudWidth: nearestStud.width.toFixed(1),
      distanceToStud: minDistance.toFixed(1),
      clearance: clearance.toFixed(1),
      required: MIN_STUD_DISTANCE
    }
  };
}

/**
 * Check 4: BOY diameter is 30mm
 */
function checkDiameter(boy) {
  const EXPECTED_DIAMETER = 30; // mm
  const TOLERANCE = 0.1; // mm

  const diameter = Number.isFinite(boy.diameter) ? Math.abs(boy.diameter) : null;

  if (diameter === null) {
    return {
      passed: false,
      message: `Diameter not specified`,
      details: {
        diameter: null,
        expected: EXPECTED_DIAMETER
      }
    };
  }

  const difference = Math.abs(diameter - EXPECTED_DIAMETER);
  const passed = difference <= TOLERANCE;

  return {
    passed,
    message: passed
      ? `Diameter OK (${diameter.toFixed(1)}mm)`
      : `Incorrect diameter (${diameter.toFixed(1)}mm, expected ${EXPECTED_DIAMETER}mm)`,
    details: {
      diameter: diameter.toFixed(1),
      expected: EXPECTED_DIAMETER,
      difference: difference.toFixed(1)
    }
  };
}

/**
 * Format diagnostic results as text report
 */
export function formatDiagnosticReport(results) {
  if (!results || results.error) {
    return `Error: ${results.error || 'Unknown error'}`;
  }

  let report = `BOY Diagnostics Report\n`;
  report += `${'='.repeat(50)}\n\n`;
  report += `Total BOY Operations: ${results.summary.total}\n`;
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
      });
      report += `\n`;
    }
  });

  return report;
}

// Make functions available globally
if (typeof window !== "undefined") {
  window.runBoyDiagnostics = runBoyDiagnostics;
  window.formatDiagnosticReport = formatDiagnosticReport;
}
