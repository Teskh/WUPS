const DEFAULT_BOUNDS = {
  minX: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY
};

export function parseWup(wupText) {
  if (typeof wupText !== "string" || wupText.trim() === "") {
    throw new Error("WUP input must be a non-empty string");
  }

  const model = {
    wall: null,
    modules: [],
    studs: [],
    plates: [],
    blocking: [],
    sheathing: [],
    nailRows: [],
    bounds: { ...DEFAULT_BOUNDS },
    unhandled: []
  };

  const statements = wupText
    .split(/;\s*/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  let currentModule = null;
  let currentPanel = null;

  for (const statement of statements) {
    const { command, body } = splitCommand(statement);
    const numbers = extractNumbers(body);

    if (command !== "PP") {
      currentPanel = null;
    }

    switch (command) {
      case "ELM": {
        if (numbers.length >= 2) {
          model.wall = {
            width: numbers[0],
            height: numbers[1],
            thickness: numbers[2] ?? null,
            side: numbers[3] ?? null
          };
        }
        break;
      }
      case "MODUL": {
        if (numbers.length >= 5) {
          currentModule = {
            width: numbers[0],
            height: numbers[1],
            thickness: numbers[2],
            originX: numbers[3],
            originY: numbers[4]
          };
          model.modules.push(currentModule);
        }
        break;
      }
      case "ENDMODUL": {
        currentModule = null;
        break;
      }
      case "QS": {
        if (numbers.length >= 5) {
          const offset = extractPlacementOffset(body);
          const rect = buildRectFromElement(numbers, currentModule, { orientation: "vertical", offset });
          if (rect) {
            model.studs.push(rect);
            extendBounds(model.bounds, rect);
          }
        }
        break;
      }
      case "LS": {
        if (numbers.length >= 5) {
          const offset = extractPlacementOffset(body);
          const rect = buildRectFromElement(numbers, currentModule, { orientation: "horizontal", offset });
          if (rect) {
            model.blocking.push(rect);
            extendBounds(model.bounds, rect);
          }
        }
        break;
      }
      case "OG":
      case "UG": {
        if (numbers.length >= 5) {
          const offset = extractPlacementOffset(body);
          const rect = buildRectFromElement(numbers, null, { orientation: "horizontal", offset });
          if (rect) {
            model.plates.push(rect);
            extendBounds(model.bounds, rect);
          }
        }
        break;
      }
      case "PLI1": {
        if (numbers.length >= 6) {
          const materialToken = extractFirstStringToken(body);
          const rotation = numbers[6] ?? 0;
          const panel = {
            width: numbers[0],
            height: numbers[1],
            thickness: numbers[2],
            x: numbers[3],
            y: numbers[4],
            offset: numbers[5] ?? 0,
            rotation,
            material: materialToken ?? null,
            points: [],
            source: numbers
          };
          model.sheathing.push(panel);
          currentPanel = panel;
        }
        break;
      }
      case "PP": {
        if (currentPanel && numbers.length >= 2) {
          const point = {
            x: numbers[0],
            y: numbers[1],
            thickness: numbers[2] ?? currentPanel.thickness ?? null,
            offset: numbers[3] ?? currentPanel.offset ?? null,
            extras: numbers.slice(4)
          };
          currentPanel.points.push(point);
          extendBoundsPoint(model.bounds, point.x, point.y);
        } else {
          model.unhandled.push({ command, numbers, body });
        }
        break;
      }
      case "NR": {
        if (numbers.length >= 4) {
          const row = {
            start: { x: numbers[0], y: numbers[1] },
            end: { x: numbers[2], y: numbers[3] },
            spacing: numbers[4] ?? null,
            gauge: numbers[5] ?? null,
            source: numbers
          };
          model.nailRows.push(row);
          extendBoundsPoint(model.bounds, row.start.x, row.start.y);
          extendBoundsPoint(model.bounds, row.end.x, row.end.y);
        }
        break;
      }
      default: {
        model.unhandled.push({ command, numbers, body });
      }
    }
  }

  if (!Number.isFinite(model.bounds.minX)) {
    throw new Error("No frame members detected in the WUP file");
  }

  return model;
}

export function normalizeModel(model) {
  const wallWidth = model.wall?.width ?? model.bounds.maxX - model.bounds.minX;
  const wallHeight = model.wall?.height ?? model.bounds.maxY - model.bounds.minY;

  if (!Number.isFinite(wallWidth) || !Number.isFinite(wallHeight)) {
    throw new Error("Invalid wall dimensions inferred from WUP file");
  }

  return {
    ...model,
    view: {
      width: wallWidth,
      height: wallHeight
    }
  };
}

export function buildRectFromElement(numbers, moduleContext, options = {}) {
  const orientation = options.orientation || "vertical";
  const [length, thickness, , x = 0, y = 0, rotation = 0] = numbers;
  if (!Number.isFinite(length) || !Number.isFinite(thickness)) {
    return null;
  }

  const originX = moduleContext?.originX ?? 0;
  const originY = moduleContext?.originY ?? 0;

  let width;
  let height;
  if (orientation === "vertical") {
    width = thickness;
    height = length;
  } else {
    width = length;
    height = thickness;
  }

  const normalizedRotation = Math.abs(((rotation % 180) + 180) % 180);
  const isNinety = Math.abs(normalizedRotation - 90) < 1e-6;
  if (isNinety) {
    const tmp = width;
    width = height;
    height = tmp;
  }

  const offsetValue = options.offset ?? (numbers.length > 6 ? numbers[numbers.length - 1] : null);

  return {
    x: originX + x,
    y: originY + y,
    width,
    height,
    rotation,
    offset: Number.isFinite(offsetValue) ? offsetValue : null,
    source: numbers
  };
}

function splitCommand(statement) {
  const firstSpace = statement.indexOf(" ");
  if (firstSpace === -1) {
    return { command: statement, body: "" };
  }
  return {
    command: statement.slice(0, firstSpace).trim(),
    body: statement.slice(firstSpace + 1).trim()
  };
}

function extractNumbers(body) {
  const matches = body.match(/-?\d+(?:\.\d+)?/g) || [];
  return matches.map(Number);
}

function extractPlacementOffset(body) {
  if (!body) {
    return null;
  }
  const tokens = body.split(",").map(token => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const lastToken = tokens[tokens.length - 1];
  return isNumericToken(lastToken) ? Number(lastToken) : null;
}

function extractFirstStringToken(body) {
  const tokens = body.split(",").map(token => token.trim()).filter(Boolean);
  return tokens.find(token => !isNumericToken(token)) ?? null;
}

function isNumericToken(token) {
  return /^-?\d+(?:\.\d+)?$/.test(token);
}

function extendBounds(bounds, rect) {
  bounds.minX = Math.min(bounds.minX, rect.x);
  bounds.minY = Math.min(bounds.minY, rect.y);
  bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width);
  bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height);
}

function extendBoundsPoint(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

if (typeof window !== "undefined") {
  window.parseWup = parseWup;
}

export const _internal = {
  splitCommand,
  extractNumbers,
  extractPlacementOffset,
  extendBounds,
  extendBoundsPoint
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseWup, normalizeModel, buildRectFromElement };
}
