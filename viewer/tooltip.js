function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "?";
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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
      const basePoint = segment?.position ?? segment?.start;
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
    default:
      return null;
  }
}
