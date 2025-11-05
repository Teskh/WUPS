// Shared helpers for interpreting PAF control codes.

export const DEFAULT_TOOL_RADIUS = 8; // mm

const TOOL_CATEGORY_MAP = {
  0: {
    label: "Machine default",
    description: "Let the machine choose the trimming tool that matches the programmed contour."
  },
  1: {
    label: "Cylindrical trimmer",
    description: "Use a straight cylindrical trimmer (code …1)."
  },
  2: {
    label: "Chamfer trimmer",
    description: "Use a chamfer-capable trimmer (code …2)."
  },
  3: {
    label: "Horizontal groove trimmer",
    description: "Use a groove trimmer for horizontal cuts (code …3)."
  },
  4: {
    label: "Vertical marking trimmer",
    description: "Use a vertical marking tool (code …4)."
  }
};

const EDGE_MODE_MAP = {
  0: {
    label: "Standard contour",
    description: "Follow the programmed polygon exactly (no automatic over/undercut)."
  },
  1: {
    label: "Overcut",
    description: "Extend the tool past the start and end tangents to guarantee a clean pocket (xx1x)."
  },
  2: {
    label: "Undercut",
    description: "Stop the tool before the tangents reach the start/end points (xx2x)."
  }
};

const RADIUS_MODE_MAP = {
  0: {
    label: "Machine default",
    description: "Let the machine decide how to apply radius compensation.",
    side: "auto"
  },
  1: {
    label: "Right compensation",
    description: "Offset the tool to the right of the processing direction so waste is opposite the cutter (1xx).",
    side: "right"
  },
  2: {
    label: "Left compensation",
    description: "Offset the tool to the left of the processing direction so waste stays on the cutter side (2xx).",
    side: "left"
  },
  3: {
    label: "No compensation",
    description: "Do not offset the tool radius; the centre follows the programmed path (3xx).",
    side: "none"
  }
};

const ROTATION_MODE_MAP = {
  0: {
    label: "Machine default",
    description: "Let the machine choose spindle rotation (standard setting)."
  },
  1: {
    label: "Synchronous rotation",
    description: "Force synchronous spindle rotation (1xxx)."
  }
};

function buildDescriptor(map, digit, fallback) {
  if (!Number.isFinite(digit)) {
    return fallback;
  }
  const entry = map[digit];
  if (entry) {
    return { ...entry, code: digit };
  }
  return {
    code: digit,
    label: `Reserved (${digit})`,
    description: "This digit value is documented as reserved or blocked in the WUP specification."
  };
}

export function parseControlCode(rawCode) {
  const code = Number.isFinite(rawCode) ? Math.round(rawCode) : null;
  const digits = {
    thousands: 0,
    hundreds: 0,
    tens: 0,
    ones: 0
  };

  if (code === null) {
    return {
      code: null,
      digits,
      toolCategory: buildDescriptor(TOOL_CATEGORY_MAP, 0, { label: "Not specified", description: "No control code supplied." }),
      edgeMode: buildDescriptor(EDGE_MODE_MAP, 0, EDGE_MODE_MAP[0]),
      radiusMode: buildDescriptor(RADIUS_MODE_MAP, 0, RADIUS_MODE_MAP[0]),
      rotationMode: buildDescriptor(ROTATION_MODE_MAP, 0, ROTATION_MODE_MAP[0]),
      addsRadius: false,
      radiusSide: "auto",
      hasOvercut: false,
      hasUndercut: false,
      isValid: false
    };
  }

  const absCode = Math.abs(code);
  digits.ones = absCode % 10;
  digits.tens = Math.floor(absCode / 10) % 10;
  digits.hundreds = Math.floor(absCode / 100) % 10;
  digits.thousands = Math.floor(absCode / 1000) % 10;

  const toolCategory = buildDescriptor(TOOL_CATEGORY_MAP, digits.ones, {
    code: digits.ones,
    label: `Tool category ${digits.ones}`,
    description: "This ones-place value is unrecognised; consult machine documentation."
  });

  const edgeMode = buildDescriptor(EDGE_MODE_MAP, digits.tens, {
    code: digits.tens,
    label: digits.tens === 0 ? "Standard contour" : `Edge mode ${digits.tens}`,
    description: digits.tens === 0
      ? EDGE_MODE_MAP[0].description
      : "This tens-place value is reserved; the machine may reject it."
  });

  const radiusMode = buildDescriptor(RADIUS_MODE_MAP, digits.hundreds, {
    code: digits.hundreds,
    label: digits.hundreds === 0 ? "Machine default" : `Radius mode ${digits.hundreds}`,
    description:
      digits.hundreds === 0
        ? RADIUS_MODE_MAP[0].description
        : digits.hundreds === 3
          ? "No automatic radius compensation – cutter follows the programmed path centreline."
          : "This hundreds-place value is reserved or machine-specific.",
    side: "auto"
  });

  const rotationMode = buildDescriptor(ROTATION_MODE_MAP, digits.thousands, {
    code: digits.thousands,
    label: digits.thousands === 0 ? "Machine default" : `Rotation mode ${digits.thousands}`,
    description: digits.thousands === 0
      ? ROTATION_MODE_MAP[0].description
      : "This thousands-place value is reserved; behaviour depends on the machine."
  });

  const compensationMode =
    digits.hundreds === 1
      ? "right"
      : digits.hundreds === 2
        ? "left"
        : digits.hundreds === 3
          ? "center"
          : "auto";

  const radiusSide =
    compensationMode === "left"
      ? "left"
      : compensationMode === "right"
        ? "right"
        : compensationMode === "center"
          ? "center"
          : radiusMode.side ?? "auto";
  const addsRadius = compensationMode === "left" || compensationMode === "center";

  return {
    code,
    digits,
    toolCategory,
    edgeMode,
    radiusMode: { ...radiusMode, side: radiusSide },
    rotationMode,
    addsRadius,
    radiusSide,
    compensationMode,
    hasOvercut: digits.tens === 1,
    hasUndercut: digits.tens === 2,
    isValid: true
  };
}

export function extractControlCode(segment) {
  if (!segment) {
    return null;
  }
  if (Number.isFinite(segment.controlCode)) {
    return Math.round(segment.controlCode);
  }
  if (Number.isFinite(segment.offset)) {
    return Math.round(segment.offset);
  }
  const source = segment.source;
  if (Array.isArray(source) && source.length > 0) {
    if (typeof source[0] === "number") {
      // MP circle segments store the raw MP numbers array.
      const arr = source;
      if (arr.length >= 5 && Number.isFinite(arr[4])) {
        return Math.round(arr[4]);
      }
    } else {
      const controlCodes = [];
      for (const entry of source) {
        if (!entry || !Array.isArray(entry.numbers)) {
          continue;
        }
        if (entry.command === "PP" && Number.isFinite(entry.numbers[3])) {
          controlCodes.push(entry.numbers[3]);
        } else if (entry.command === "KB" && Number.isFinite(entry.numbers[4])) {
          controlCodes.push(entry.numbers[4]);
        }
      }
      if (controlCodes.length > 0) {
        const sum = controlCodes.reduce((acc, value) => acc + value, 0);
        return Math.round(sum / controlCodes.length);
      }
    }
  }
  if (Number.isFinite(segment.orientation)) {
    return Math.round(segment.orientation);
  }
  return null;
}

function computeSignedArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) {
    return 0;
  }
  let area = 0;
  let validCount = 0;
  const length = points.length;
  for (let i = 0; i < length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % length];
    if (
      !Number.isFinite(current?.x) ||
      !Number.isFinite(current?.y) ||
      !Number.isFinite(next?.x) ||
      !Number.isFinite(next?.y)
    ) {
      continue;
    }
    area += current.x * next.y - next.x * current.y;
    validCount += 1;
  }
  if (validCount < 3) {
    return 0;
  }
  return area / 2;
}

function resolveOrientationFromOptions(options) {
  if (!options) {
    return null;
  }
  if (typeof options.orientation === "number" && Math.abs(options.orientation) > 1e-6) {
    return options.orientation > 0 ? 1 : -1;
  }
  if (typeof options.winding === "number" && Math.abs(options.winding) > 1e-6) {
    return options.winding > 0 ? 1 : -1;
  }
  if (Array.isArray(options.points)) {
    const signedArea = computeSignedArea(options.points);
    if (Math.abs(signedArea) > 1e-4) {
      return signedArea > 0 ? 1 : -1;
    }
  }
  return null;
}

export function resolveFootprintAdjustment(controlInfo, toolRadius = DEFAULT_TOOL_RADIUS, options = {}) {
  const info =
    controlInfo && typeof controlInfo === "object" && controlInfo.digits
      ? controlInfo
      : parseControlCode(controlInfo);
  const digits = info?.digits ?? null;
  if (!digits) {
    return { expansion: 0, mode: "unknown", applied: false };
  }

  const hundreds = digits.hundreds;
  const orientation = resolveOrientationFromOptions(options);

  if (hundreds === 1) {
    const expandsOutward = orientation !== null && orientation < 0;
    if (expandsOutward) {
      return {
        expansion: toolRadius * 4,
        mode: "diameter",
        applied: true,
        orientation,
        description:
          "Hundreds digit = 1 (right compensation) with clockwise winding — add 16 mm per side (32 mm overall)."
      };
    }
    const reason =
      orientation === null
        ? "Hundreds digit = 1 (right compensation) but the path winding is unknown — assuming the offset remains inside the contour."
        : "Hundreds digit = 1 (right compensation) with counter-clockwise routing — offset stays inside the programmed contour.";
    return {
      expansion: 0,
      mode: "internal",
      applied: false,
      orientation,
      description: reason
    };
  }
  if (hundreds === 2) {
    const expandsOutward = orientation !== null && orientation > 0;
    if (expandsOutward) {
      return {
        expansion: toolRadius * 4,
        mode: "diameter",
        applied: true,
        orientation,
        description: "Hundreds digit = 2 (left compensation) — add 16 mm per side (32 mm overall)."
      };
    }
    const reason =
      orientation === null
        ? "Hundreds digit = 2 (left compensation) but the path winding is unknown — assuming the offset remains inside the programmed contour."
        : "Hundreds digit = 2 (left compensation) with clockwise routing — offset stays inside the programmed contour.";
    return {
      expansion: 0,
      mode: "internal",
      applied: false,
      orientation,
      description: reason
    };
  }
  if (hundreds === 3) {
    return {
      expansion: toolRadius * 2,
      mode: "radius",
      applied: true,
      orientation,
      description: "Hundreds digit = 3 (no compensation) — add 8 mm per side (16 mm overall)."
    };
  }
  return {
    expansion: 0,
    mode: "auto",
    applied: false,
    orientation,
    description: "No explicit compensation digit supplied — leaving footprint unchanged."
  };
}

export function computeCutoutFootprint(points = [], controlInfo, toolRadius = DEFAULT_TOOL_RADIUS, options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
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
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  const baseWidth = maxX - minX;
  const baseHeight = maxY - minY;
  const adjustmentOptions = { ...(options?.adjustmentOptions ?? {}) };
  if (!adjustmentOptions.points && Array.isArray(points)) {
    adjustmentOptions.points = points;
  }
  const adjustment =
    options?.adjustment ?? resolveFootprintAdjustment(controlInfo, toolRadius, adjustmentOptions);
  const expansion =
    options?.expansionOverride ?? (adjustment?.expansion ?? 0);
  return {
    baseWidth,
    baseHeight,
    expansion,
    width: baseWidth + expansion,
    height: baseHeight + expansion,
    adjustment
  };
}

export function formatMillimetres(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(digits).replace(/\.0+$/, "")} mm`;
}
