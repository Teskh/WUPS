// Utility helpers for rebuilding PAF segment geometry from source records.

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isApproximatelyEqual(a, b) {
  return Math.abs(a - b) < 1e-6;
}

function dedupePolygonPoints(points) {
  const result = [];
  for (const point of points ?? []) {
    if (!isFinitePoint(point)) {
      continue;
    }
    const last = result[result.length - 1];
    if (last && isApproximatelyEqual(last.x, point.x) && isApproximatelyEqual(last.y, point.y)) {
      continue;
    }
    result.push(point);
  }
  return result;
}

function isClosedLoop(points) {
  if (!points || points.length < 2) {
    return false;
  }
  const first = points[0];
  const last = points[points.length - 1];
  return isApproximatelyEqual(first.x, last.x) && isApproximatelyEqual(first.y, last.y);
}

function inferArcDirection(typeToken) {
  if (typeof typeToken !== "string") {
    return 1;
  }
  const normalized = typeToken.trim().toLowerCase();
  if (!normalized) {
    return 1;
  }
  if (normalized.includes("cw")) {
    return -1;
  }
  if (normalized.includes("cc")) {
    return 1;
  }
  return normalized.endsWith("w") ? -1 : 1;
}

function isLargeArc(typeToken) {
  if (typeof typeToken !== "string") {
    return false;
  }
  const trimmed = typeToken.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed === trimmed.toUpperCase();
}

function computeUnsignedSweep(startAngle, endAngle, direction) {
  const twoPi = Math.PI * 2;
  if (direction >= 0) {
    let sweep = endAngle - startAngle;
    while (sweep < 0) {
      sweep += twoPi;
    }
    return sweep;
  }
  let sweep = startAngle - endAngle;
  while (sweep < 0) {
    sweep += twoPi;
  }
  return sweep;
}

function computeSignedSweep(startAngle, endAngle, direction) {
  const twoPi = Math.PI * 2;
  if (direction >= 0) {
    let sweep = endAngle - startAngle;
    while (sweep <= 0) {
      sweep += twoPi;
    }
    return sweep;
  }
  let sweep = startAngle - endAngle;
  while (sweep <= 0) {
    sweep += twoPi;
  }
  return -sweep;
}

function computeArcSolution(startPoint, command) {
  if (!isFinitePoint(startPoint) || !isFinitePoint(command?.point)) {
    return null;
  }
  const radius = Number.isFinite(command?.radius) ? Math.max(Math.abs(command.radius), 1e-6) : null;
  if (!Number.isFinite(radius) || radius < 1e-6) {
    return null;
  }
  const direction = command?.direction >= 0 ? 1 : -1;
  const largeArc = Boolean(command?.largeArc);

  const x0 = startPoint.x;
  const y0 = startPoint.y;
  const x1 = command.point.x;
  const y1 = command.point.y;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  const epsilon = 1e-6;
  if (chord < epsilon) {
    return null;
  }
  const halfChord = chord / 2;
  if (radius < halfChord - epsilon) {
    return null;
  }

  const midX = (x0 + x1) / 2;
  const midY = (y0 + y1) / 2;
  const chordAngle = Math.atan2(dy, dx);
  const perpAngle = chordAngle + Math.PI / 2;
  const height = Math.sqrt(Math.max(radius * radius - halfChord * halfChord, 0));
  const offsetX = height * Math.cos(perpAngle);
  const offsetY = height * Math.sin(perpAngle);

  const centers = [
    { x: midX + offsetX, y: midY + offsetY },
    { x: midX - offsetX, y: midY - offsetY }
  ];

  const tolerance = 1e-5;
  let chosen = null;
  let chosenSweep = null;
  for (const center of centers) {
    const startAngle = Math.atan2(y0 - center.y, x0 - center.x);
    const endAngle = Math.atan2(y1 - center.y, x1 - center.x);
    const sweep = computeUnsignedSweep(startAngle, endAngle, direction);
    if (!Number.isFinite(sweep) || sweep < tolerance) {
      continue;
    }
    const isLarge = sweep > Math.PI + tolerance;
    if (largeArc && !isLarge && Math.abs(sweep - Math.PI) > tolerance) {
      continue;
    }
    if (!largeArc && isLarge && Math.abs(sweep - Math.PI) > tolerance) {
      continue;
    }
    chosen = { center, startAngle, endAngle };
    chosenSweep = sweep;
    break;
  }

  if (!chosen) {
    for (const center of centers) {
      const startAngle = Math.atan2(y0 - center.y, x0 - center.x);
      const endAngle = Math.atan2(y1 - center.y, x1 - center.x);
      const sweep = computeUnsignedSweep(startAngle, endAngle, direction);
      if (Number.isFinite(sweep) && sweep > tolerance) {
        chosen = { center, startAngle, endAngle };
        chosenSweep = sweep;
        break;
      }
    }
  }

  if (!chosen || !Number.isFinite(chosenSweep)) {
    return null;
  }

  const signedSweep = computeSignedSweep(chosen.startAngle, chosen.endAngle, direction);
  return {
    type: "arc",
    from: { x: x0, y: y0 },
    to: { x: x1, y: y1 },
    center: { x: chosen.center.x, y: chosen.center.y },
    radius,
    startAngle: chosen.startAngle,
    endAngle: chosen.endAngle,
    clockwise: direction < 0,
    sweep: Math.abs(signedSweep),
    signedSweep,
    largeArc,
    rawType: command?.rawType ?? null
  };
}

function sampleArcPoints(segment) {
  const signedSweep = Number.isFinite(segment?.signedSweep) ? segment.signedSweep : 0;
  const radius = Number.isFinite(segment?.radius) ? segment.radius : 0;
  if (!Number.isFinite(signedSweep) || Math.abs(signedSweep) < 1e-6 || radius <= 0) {
    return [
      { x: segment?.from?.x ?? 0, y: segment?.from?.y ?? 0 },
      { x: segment?.to?.x ?? 0, y: segment?.to?.y ?? 0 }
    ];
  }
  const absSweep = Math.abs(signedSweep);
  let stepCount = Math.ceil(absSweep / (Math.PI / 24));
  stepCount = Math.min(Math.max(stepCount, 4), 160);
  const points = [];
  const delta = signedSweep / stepCount;
  for (let i = 0; i <= stepCount; i += 1) {
    const angle = segment.startAngle + delta * i;
    const x = segment.center.x + radius * Math.cos(angle);
    const y = segment.center.y + radius * Math.sin(angle);
    points.push({ x, y });
  }
  if (points.length > 0) {
    points[0] = { x: segment.from.x, y: segment.from.y };
    points[points.length - 1] = { x: segment.to.x, y: segment.to.y };
  }
  return points;
}

function clonePathSegment(segment) {
  if (!segment) {
    return segment;
  }
  if (segment.type === "arc") {
    return {
      type: "arc",
      from: { ...segment.from },
      to: { ...segment.to },
      center: { ...segment.center },
      radius: segment.radius,
      startAngle: segment.startAngle,
      endAngle: segment.endAngle,
      clockwise: segment.clockwise,
      sweep: segment.sweep,
      signedSweep: segment.signedSweep,
      largeArc: segment.largeArc,
      rawType: segment.rawType ?? null
    };
  }
  return {
    type: "line",
    from: { ...segment.from },
    to: { ...segment.to },
    fallback: Boolean(segment.fallback)
  };
}

function buildPolygonPath(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { points: [], pathSegments: [] };
  }

  const points = [];
  const pathSegments = [];
  let currentPoint = null;

  for (const command of commands) {
    if (!command || !isFinitePoint(command.point)) {
      continue;
    }
    if (command.kind === "move") {
      currentPoint = command.point;
      points.push({ x: command.point.x, y: command.point.y });
      continue;
    }
    if (!currentPoint || !isFinitePoint(currentPoint)) {
      currentPoint = command.point;
      points.push({ x: command.point.x, y: command.point.y });
      continue;
    }
    if (command.kind === "line") {
      pathSegments.push({
        type: "line",
        from: { x: currentPoint.x, y: currentPoint.y },
        to: { x: command.point.x, y: command.point.y }
      });
      points.push({ x: command.point.x, y: command.point.y });
      currentPoint = command.point;
      continue;
    }
    if (command.kind === "arc") {
      const arcSegment = computeArcSolution(currentPoint, command);
      if (arcSegment) {
        pathSegments.push(arcSegment);
        const arcPoints = sampleArcPoints(arcSegment);
        for (let i = 1; i < arcPoints.length; i += 1) {
          points.push(arcPoints[i]);
        }
        currentPoint = command.point;
      } else {
        pathSegments.push({
          type: "line",
          from: { x: currentPoint.x, y: currentPoint.y },
          to: { x: command.point.x, y: command.point.y },
          fallback: true
        });
        points.push({ x: command.point.x, y: command.point.y });
        currentPoint = command.point;
      }
    }
  }

  return { points, pathSegments };
}

export function rebuildPafSegmentGeometry(segment) {
  if (!segment || typeof segment !== "object") {
    return false;
  }
  if (!Array.isArray(segment.source) || segment.source.length === 0) {
    return false;
  }

  const commands = [];
  let first = true;
  for (const entry of segment.source) {
    if (!entry) {
      continue;
    }
    if (entry.command === "PP") {
      const numbers = Array.isArray(entry.numbers) ? entry.numbers : [];
      const x = Number(numbers[0]);
      const y = Number(numbers[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      const point = { x, y };
      commands.push({
        kind: first ? "move" : "line",
        point
      });
      first = false;
    } else if (entry.command === "KB") {
      const numbers = Array.isArray(entry.numbers) ? entry.numbers : [];
      const x = Number(numbers[0]);
      const y = Number(numbers[1]);
      const radius = Number(numbers[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) {
        continue;
      }
      const point = { x, y };
      commands.push({
        kind: first ? "line" : "arc",
        point,
        radius: Math.abs(radius),
        direction: inferArcDirection(entry.type),
        largeArc: isLargeArc(entry.type),
        rawType: entry.type ?? null
      });
      first = false;
    }
  }

  if (!commands.length) {
    segment.points = [];
    segment.pathSegments = [];
    return false;
  }

  const { points, pathSegments } = buildPolygonPath(commands);
  const deduped = dedupePolygonPoints(points);
  if (!deduped.length) {
    segment.points = [];
    segment.pathSegments = [];
    return false;
  }

  const closed = isClosedLoop(deduped);
  if (segment.kind === "polygon") {
    let loopPoints = deduped;
    if (!closed && deduped.length >= 3) {
      loopPoints = [...deduped, deduped[0]];
    }
    segment.points = loopPoints.length > 1 ? loopPoints.slice(0, -1).map(point => ({ ...point })) : [];
  } else {
    segment.points = deduped.map(point => ({ ...point }));
  }
  segment.pathSegments = pathSegments.map(clonePathSegment);
  return true;
}

