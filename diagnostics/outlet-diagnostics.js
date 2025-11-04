/**
 * Outlet Diagnostics
 *
 * Detects legacy electrical outlet cuts defined with:
 * - A box cut using 5 PP (Pocket Path) points (closed polygon)
 * - Two MP (Milling Point) circular cuts
 * - The MP circles are positioned such that their Y coordinate minus radius
 *   matches one of the corners of the box cut (for horizontal alignment)
 *   OR X coordinate minus radius matches (for vertical alignment)
 */

export function runOutletDiagnostics(model) {
  if (!model || !Array.isArray(model.pafRoutings)) {
    return {
      success: false,
      error: "Invalid model: no PAF routings found",
      checks: []
    };
  }

  const pafRoutings = model.pafRoutings;

  const results = {
    summary: {
      total: 0,
      legacyOutlets: 0
    },
    checks: [
      {
        name: "Legacy Outlet Detection",
        description: "Detects legacy electrical outlet cuts with box and circular cuts",
        results: []
      }
    ]
  };

  // Collect all circles and polygons from all routings
  const circles = [];
  const polygons = [];

  pafRoutings.forEach((routing, routingIndex) => {
    if (!routing.segments) return;

    routing.segments.forEach(segment => {
      if (isCircleSegment(segment) && segment.position && Number.isFinite(segment.radius)) {
        circles.push({
          segment,
          routing,
          routingIndex,
          position: segment.position,
          radius: segment.radius
        });
      } else if (segment.kind === "polygon" && segment.points && segment.points.length === 4) {
        polygons.push({
          segment,
          routing,
          routingIndex,
          points: segment.points
        });
      }
    });
  });

  // Find legacy outlets by matching patterns
  const foundOutlets = new Set(); // Track which polygons we've already matched

  polygons.forEach(polygon => {
    if (foundOutlets.has(polygon.routingIndex)) return;

    const legacyOutlet = detectLegacyOutletPattern(polygon, circles);

    if (legacyOutlet.isLegacy) {
      results.summary.legacyOutlets++;
      foundOutlets.add(polygon.routingIndex);

      // Mark the matched circles as used
      legacyOutlet.matchedCircles.forEach(circle => foundOutlets.add(circle.routingIndex));

      const routingIds = [polygon.routingIndex, ...legacyOutlet.matchedCircles.map(c => c.routingIndex)]
        .sort((a, b) => a - b)
        .map(i => `#${i + 1}`)
        .join(", ");

      const replacement = buildReplacementData(polygon, legacyOutlet);

      results.checks[0].results.push({
        id: `PAF Routings ${routingIds}`,
        routing: polygon.routing,
        passed: false,
        message: legacyOutlet.message,
        details: legacyOutlet.details,
        position: legacyOutlet.position,
        replacement
      });
    }
  });

  results.summary.total = results.checks[0].results.length;

  return results;
}

/**
 * Check if a segment is a circle (either has kind="circle" or has position + radius)
 */
function isCircleSegment(segment) {
  return segment.kind === "circle" ||
         (segment.position && Number.isFinite(segment.radius));
}

/**
 * Detect if a polygon and circles form a legacy outlet pattern
 * Criteria:
 * 1. Circles have radius = 34mm (± 1mm)
 * 2. The X OR Y coordinates of circles ± radius match polygon edges (± 1mm)
 * 3. Polygon has horizontal OR vertical dimension = 44mm (± 1mm)
 */
function detectLegacyOutletPattern(polygon, allCircles) {
  const EXPECTED_RADIUS = 34; // mm
  const EXPECTED_BOX_DIM = 44; // mm
  const TOLERANCE = 1; // mm tolerance
  const boxSegment = polygon.segment;

  if (!boxSegment) {
    return { isLegacy: false };
  }

  // Extract box boundaries
  const boxCorners = polygon.points.map(p => ({ x: p.x, y: p.y }));
  const xCoords = [...new Set(boxCorners.map(p => p.x))].sort((a, b) => a - b);
  const yCoords = [...new Set(boxCorners.map(p => p.y))].sort((a, b) => a - b);

  // Need exactly 2 unique X and 2 unique Y coordinates for a proper box
  if (xCoords.length !== 2 || yCoords.length !== 2) {
    return { isLegacy: false };
  }

  const boxMinX = xCoords[0];
  const boxMaxX = xCoords[1];
  const boxMinY = yCoords[0];
  const boxMaxY = yCoords[1];
  const boxWidth = boxMaxX - boxMinX;
  const boxHeight = boxMaxY - boxMinY;

  // Check if polygon has one dimension = 44mm (± 1mm)
  const hasCorrectDimension =
    Math.abs(boxWidth - EXPECTED_BOX_DIM) <= TOLERANCE ||
    Math.abs(boxHeight - EXPECTED_BOX_DIM) <= TOLERANCE;

  if (!hasCorrectDimension) {
    return { isLegacy: false };
  }

  // Find circles with radius ~34mm that are aligned with this box
  const matchedCircles = [];

  // DEBUG logging (remove later)
  const debugLog = false; // Set to true for debugging
  if (debugLog) {
    console.log(`\nChecking polygon at routing ${polygon.routingIndex + 1}: ${boxWidth}mm × ${boxHeight}mm`);
  }

  for (const circle of allCircles) {
    // Skip if already used
    if (circle.used) {
      if (debugLog) {
        console.log(`  Circle #${circle.routingIndex + 1} already used, skipping`);
      }
      continue;
    }

    // Check radius
    if (Math.abs(circle.radius - EXPECTED_RADIUS) > TOLERANCE) {
      if (debugLog && Math.abs(circle.radius - EXPECTED_RADIUS) <= 5) {
        console.log(`  Circle #${circle.routingIndex + 1} radius ${circle.radius} doesn't match (diff: ${Math.abs(circle.radius - EXPECTED_RADIUS)})`);
      }
      continue;
    }

    const { x: cx, y: cy } = circle.position;
    const r = circle.radius;

    // Check if circle is near the box (proximity check)
    // Circle center should be within or close to the box bounds (extended by tolerance)
    const proximityTolerance = r + TOLERANCE; // Allow circle to be outside by at most its radius + tolerance

    const isNearBox =
      cx >= boxMinX - proximityTolerance &&
      cx <= boxMaxX + proximityTolerance &&
      cy >= boxMinY - proximityTolerance &&
      cy <= boxMaxY + proximityTolerance;

    if (!isNearBox) {
      if (debugLog) {
        console.log(`  Circle #${circle.routingIndex + 1} at (${cx}, ${cy}) too far from box, skipping`);
      }
      continue;
    }

    // Check if circle edges align with box edges
    const leftEdge = cx - r;
    const rightEdge = cx + r;
    const bottomEdge = cy - r;
    const topEdge = cy + r;

    // Check X alignment (vertical edges)
    const xAligned =
      Math.abs(leftEdge - boxMinX) <= TOLERANCE ||
      Math.abs(leftEdge - boxMaxX) <= TOLERANCE ||
      Math.abs(rightEdge - boxMinX) <= TOLERANCE ||
      Math.abs(rightEdge - boxMaxX) <= TOLERANCE;

    // Check Y alignment (horizontal edges)
    const yAligned =
      Math.abs(bottomEdge - boxMinY) <= TOLERANCE ||
      Math.abs(bottomEdge - boxMaxY) <= TOLERANCE ||
      Math.abs(topEdge - boxMinY) <= TOLERANCE ||
      Math.abs(topEdge - boxMaxY) <= TOLERANCE;

    const isAligned = xAligned || yAligned;

    if (debugLog) {
      console.log(`  Circle #${circle.routingIndex + 1} at (${cx}, ${cy}) r=${r}: xAligned=${xAligned}, yAligned=${yAligned}, aligned=${isAligned}`);
    }

    if (isAligned) {
      matchedCircles.push(circle);
    }
  }

  if (debugLog && matchedCircles.length > 0) {
    console.log(`  Found ${matchedCircles.length} matching circles`);
  }

  // Need exactly 2 aligned circles for a legacy outlet
  if (matchedCircles.length !== 2) {
    return { isLegacy: false };
  }

  // Mark circles as used
  matchedCircles.forEach(c => c.used = true);

  // Determine orientation based on circle alignment (fallback to dimension check)
  let orientationType = Math.abs(boxWidth - EXPECTED_BOX_DIM) <= TOLERANCE ? "vertical" : "horizontal";
  if (matchedCircles.length === 2) {
    const [circleA, circleB] = matchedCircles;
    const dx = Math.abs(circleA.position.x - circleB.position.x);
    const dy = Math.abs(circleA.position.y - circleB.position.y);
    if (dy <= TOLERANCE) {
      orientationType = "horizontal";
    } else if (dx <= TOLERANCE) {
      orientationType = "vertical";
    }
  }

  const firstSourceEntry = Array.isArray(boxSegment.source)
    ? boxSegment.source.find(entry => Array.isArray(entry?.numbers) && entry.numbers.length >= 6)
    : null;
  const sourceNumbers = firstSourceEntry?.numbers ?? [];
  const depthParam = Number.isFinite(sourceNumbers[2])
    ? sourceNumbers[2]
    : (Number.isFinite(boxSegment.depthRaw) ? boxSegment.depthRaw : (Number.isFinite(boxSegment.depth) ? -Math.abs(boxSegment.depth) : null));
  const orientationParam = Number.isFinite(sourceNumbers[4])
    ? sourceNumbers[4]
    : (Number.isFinite(boxSegment.orientation) ? boxSegment.orientation : 0);
  const trailingParam = Number.isFinite(sourceNumbers[5]) ? sourceNumbers[5] : null;

  // Calculate center position for zoom functionality
  const centerX = (boxMinX + boxMaxX) / 2;
  const centerY = (boxMinY + boxMaxY) / 2;

  return {
    isLegacy: true,
    matchedCircles,
    message: `Legacy outlet detected (${orientationType} orientation, box: ${boxWidth.toFixed(1)}×${boxHeight.toFixed(1)}mm, 2 circular cuts)`,
    details: {
      boxDimensions: `${boxWidth.toFixed(1)}mm × ${boxHeight.toFixed(1)}mm`,
      boxPosition: `(${boxMinX.toFixed(1)}, ${boxMinY.toFixed(1)}) to (${boxMaxX.toFixed(1)}, ${boxMaxY.toFixed(1)})`,
      circleCount: matchedCircles.length,
      circleRadius: matchedCircles[0]?.radius?.toFixed(1) || "unknown",
      orientation: orientationType,
      circle1Position: `(${matchedCircles[0].position.x.toFixed(1)}, ${matchedCircles[0].position.y.toFixed(1)})`,
      circle2Position: `(${matchedCircles[1].position.x.toFixed(1)}, ${matchedCircles[1].position.y.toFixed(1)})`
    },
    position: {
      x: centerX,
      y: centerY
    },
    orientationType,
    metadata: {
      center: { x: centerX, y: centerY },
      depth: Number.isFinite(depthParam) ? depthParam : null,
      orientationValue: Number.isFinite(orientationParam) ? orientationParam : 0,
      zValue: Number.isFinite(trailingParam) ? trailingParam : null,
      boxWidth,
      boxHeight
    }
  };
}

function buildReplacementData(polygon, legacyOutlet) {
  if (!polygon || !legacyOutlet || !legacyOutlet.metadata) {
    return null;
  }

  const routing = polygon.routing;
  if (!routing) {
    return null;
  }

  const boxId = typeof routing.__editorId === "number" ? routing.__editorId : null;
  const circleIds = (legacyOutlet.matchedCircles ?? [])
    .map(circle => circle?.routing?.__editorId)
    .filter(id => typeof id === "number");
  const headerSource = Array.isArray(routing.source) ? [...routing.source] : [];

  return {
    id: boxId !== null ? `legacyOutlet-${boxId}` : null,
    orientation: legacyOutlet.orientationType,
    center: { x: legacyOutlet.position.x, y: legacyOutlet.position.y },
    depth: legacyOutlet.metadata.depth,
    zValue: legacyOutlet.metadata.zValue,
    orientationValue: legacyOutlet.metadata.orientationValue,
    headerSource,
    tool: Number.isFinite(routing.tool) ? routing.tool : null,
    face: Number.isFinite(routing.face) ? routing.face : null,
    passes: Number.isFinite(routing.passes) ? routing.passes : null,
    layer: routing.layer ?? null,
    boxRoutingEditorId: boxId,
    circleRoutingEditorIds: circleIds,
    command: routing.__command ?? "PAF",
    body: routing.__body ?? routing.body ?? ""
  };
}

/**
 * Format diagnostic results as text report
 */
export function formatOutletReport(results) {
  if (!results || results.error) {
    return `Error: ${results.error || 'Unknown error'}`;
  }

  let report = `Outlet Diagnostics Report\n`;
  report += `${'='.repeat(50)}\n\n`;
  report += `Total Legacy Outlets Found: ${results.summary.legacyOutlets}\n\n`;

  if (results.summary.legacyOutlets === 0) {
    report += `No legacy outlets detected. All outlets use the modern format.\n\n`;
    return report;
  }

  results.checks.forEach(check => {
    report += `${check.name}\n`;
    report += `${'-'.repeat(50)}\n`;
    report += `${check.description}\n\n`;

    report += `Legacy outlets found:\n`;
    check.results.forEach(result => {
      report += `\n  ${result.id}:\n`;
      report += `    Message: ${result.message}\n`;
      if (result.details) {
        Object.entries(result.details).forEach(([key, value]) => {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
          report += `    ${label}: ${value}\n`;
        });
      }
    });
    report += `\n`;
  });

  return report;
}

// Make functions available globally
if (typeof window !== "undefined") {
  window.runOutletDiagnostics = runOutletDiagnostics;
  window.formatOutletReport = formatOutletReport;
}
