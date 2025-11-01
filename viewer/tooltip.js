function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "?";
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function computePolygonCentroid(points) {
  if (!Array.isArray(points)) {
    return null;
  }
  const valid = points.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (valid.length === 0) {
    return null;
  }
  if (valid.length < 3) {
    const sum = valid.reduce(
      (acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
      },
      { x: 0, y: 0 }
    );
    return {
      x: sum.x / valid.length,
      y: sum.y / valid.length
    };
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < valid.length; i += 1) {
    const current = valid[i];
    const next = valid[(i + 1) % valid.length];
    const cross = current.x * next.y - next.x * current.y;
    area += cross;
    cx += (current.x + next.x) * cross;
    cy += (current.y + next.y) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    const sum = valid.reduce(
      (acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
      },
      { x: 0, y: 0 }
    );
    return {
      x: sum.x / valid.length,
      y: sum.y / valid.length
    };
  }
  const factor = 1 / (3 * area);
  return {
    x: cx * factor,
    y: cy * factor
  };
}

function computeFootprintSize(points) {
  if (!Array.isArray(points)) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      continue;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return {
    width: maxX - minX,
    height: maxY - minY
  };
}

function resolvePafBasePoint(segment) {
  if (segment?.position && Number.isFinite(segment.position.x) && Number.isFinite(segment.position.y)) {
    return segment.position;
  }
  if (segment?.start && Number.isFinite(segment.start.x) && Number.isFinite(segment.start.y)) {
    return segment.start;
  }
  if (Array.isArray(segment?.points)) {
    return computePolygonCentroid(segment.points);
  }
  return null;
}

export function formatTooltipContent(object) {
  if (!object?.userData) {
    return null;
  }
  const { kind } = object.userData;
  switch (kind) {
    case "stud":
    case "blocking":
    case "plate": {
      const member = object.userData.member;
      if (!member) {
        return null;
      }
      const kindLabel = capitalize(kind);
      const depth = member.source?.[2];
      return `${kindLabel} — ${formatNumber(member.width)} × ${formatNumber(member.height)} × ${formatNumber(depth)} mm @ (${formatNumber(
        member.x
      )}, ${formatNumber(member.y)})`;
    }
    case "sheathing": {
      const panel = object.userData.panel;
      if (!panel) {
        return null;
      }
      const label = panel.material ? `Sheathing (${panel.material})` : "Sheathing";
      const dims = `${formatNumber(panel.width)} × ${formatNumber(panel.height)} × ${formatNumber(panel.thickness)} mm`;
      const originText = `@ (${formatNumber(panel.x)}, ${formatNumber(panel.y)})`;
      const offsetText = Number.isFinite(panel.offset) ? `offset ${formatNumber(panel.offset)} mm` : null;
      const rotationText = Number.isFinite(panel.rotation) ? `${formatNumber(panel.rotation)}°` : null;
      const extras = [offsetText, rotationText].filter(Boolean).join(", ");
      return extras ? `${label} — ${dims} ${originText} — ${extras}` : `${label} — ${dims} ${originText}`;
    }
    case "nailRow": {
      const row = object.userData.row;
      if (!row) {
        return null;
      }
      const span = Math.hypot(row.end.x - row.start.x, row.end.y - row.start.y);
      const nails = Number.isFinite(object.userData.nails) ? object.userData.nails : null;
      const declaredSpacing = Number.isFinite(row.spacing) ? row.spacing : null;
      const derivedSpacing = nails && nails > 1 ? span / (nails - 1) : null;
      const spacingText = declaredSpacing ?? derivedSpacing;
      const details = [`Nail row — span ${formatNumber(span)} mm`, `from (${formatNumber(row.start.x)}, ${formatNumber(row.start.y)})`];
      if (nails) {
        details.push(`${nails} nails`);
      }
      if (Number.isFinite(spacingText)) {
        const spacingLabel = declaredSpacing ? "spacing" : "spacing≈";
        details.push(`${spacingLabel} ${formatNumber(spacingText)} mm`);
      }
      if (Number.isFinite(row.gauge)) {
        details.push(`gauge ${formatNumber(row.gauge)} mm`);
      }
      return details.join(" · ");
    }
    case "paf": {
      const routing = object.userData.routing;
      const segment = object.userData.segment;
      const basePoint = resolvePafBasePoint(segment);
      if (!routing || !segment || !basePoint) {
        return null;
      }
      const toolParts = [];
      if (Number.isFinite(routing.tool)) {
        toolParts.push(`tool ${routing.tool}`);
      }
      if (Number.isFinite(routing.face)) {
        toolParts.push(`face ${routing.face}`);
      }
      if (Number.isFinite(routing.passes)) {
        toolParts.push(`${routing.passes} pass${routing.passes === 1 ? "" : "es"}`);
      }
      const radiusMm = Number.isFinite(segment.radius)
        ? segment.radius
        : Number.isFinite(segment.toolDiameter)
          ? segment.toolDiameter / 2
          : null;
      const diameterMm = Number.isFinite(radiusMm) ? radiusMm * 2 : Number.isFinite(segment.toolDiameter) ? segment.toolDiameter : null;
      const depthMm = Number.isFinite(segment.depth)
        ? segment.depth
        : Number.isFinite(segment.depthRaw)
          ? Math.abs(segment.depthRaw)
          : null;
      const detailParts = [`@ (${formatNumber(basePoint.x)}, ${formatNumber(basePoint.y)})`];
      if (segment.kind === "polygon" && Array.isArray(segment.points) && segment.points.length >= 3) {
        const footprint = computeFootprintSize(segment.points);
        if (footprint && Number.isFinite(footprint.width) && Number.isFinite(footprint.height)) {
          detailParts.push(`footprint ${formatNumber(footprint.width)} × ${formatNumber(footprint.height)} mm`);
        }
      }
      if (Number.isFinite(radiusMm)) {
        detailParts.push(`radius ${formatNumber(radiusMm)} mm`);
      } else if (Number.isFinite(diameterMm)) {
        detailParts.push(`Ø${formatNumber(diameterMm)} mm`);
      }
      if (Number.isFinite(depthMm)) {
        detailParts.push(`depth ${formatNumber(depthMm)} mm`);
      }
      if (Number.isFinite(segment.orientation)) {
        detailParts.push(`orientation ${formatNumber(segment.orientation)}°`);
      }
      const metaText = toolParts.length ? ` (${toolParts.join(", ")})` : "";
      return `PAF routing${metaText} — ${detailParts.join(" · ")}`;
    }
    case "boy": {
      const operation = object.userData.operation;
      if (!operation) {
        return null;
      }
      const depthInfo = object.userData.depthInfo ?? null;
      const diameter = Number.isFinite(operation.diameter) ? operation.diameter : null;
      const depthMagnitude = Number.isFinite(depthInfo?.depth)
        ? depthInfo.depth
        : Number.isFinite(operation.depth)
          ? Math.abs(operation.depth)
          : null;
      const directionLabel =
        depthInfo?.directionLabel ??
        (Number.isFinite(operation.depth)
          ? operation.depth >= 0
            ? "+Y"
            : "-Y"
          : null);
      const targetRole = object.userData.targetRole ?? null;
      const entryY = Number.isFinite(depthInfo?.entryY) ? depthInfo.entryY : null;
      const plate = object.userData.plate ?? null;
      const plateLabel = (() => {
        if (!plate) {
          return null;
        }
        if (targetRole === "top") {
          return "top plate";
        }
        if (targetRole === "bottom") {
          return "bottom plate";
        }
        return null;
      })();

      const details = [`@ (${formatNumber(operation.x)}, ${formatNumber(operation.z)})`];
      if (Number.isFinite(diameter)) {
        details.push(`Ø${formatNumber(diameter)} mm`);
      }
      if (Number.isFinite(depthMagnitude)) {
        details.push(`depth ${formatNumber(depthMagnitude)} mm`);
      }
      if (directionLabel) {
        details.push(`direction ${directionLabel}`);
      }
      if (Number.isFinite(entryY)) {
        details.push(`entry y ${formatNumber(entryY)} mm`);
      }
      if (plateLabel) {
        details.push(plateLabel);
      }
      return `BOY drilling — ${details.join(" · ")}`;
    }
    default:
      return null;
  }
}
