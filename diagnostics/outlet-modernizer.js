import { parseWup } from "../wup-parser.js";

const CONTROL_CODE = 320;

const TEMPLATE_COMMANDS = [
  { command: "PP", dx: -14, dy: 12 },
  { command: "PP", dx: -22, dy: 12 },
  { command: "KB", dx: -22, dy: -12, radius: 12, arcType: "ACC" },
  { command: "PP", dx: 22, dy: -12 },
  { command: "KB", dx: 22, dy: 12, radius: 12, arcType: "ACC" },
  { command: "PP", dx: -14, dy: 12 },
  { command: "PP", dx: -14, dy: 26 },
  { command: "PP", dx: -22, dy: 26 },
  { command: "KB", dx: -22, dy: -26, radius: 26, arcType: "ACC" },
  { command: "PP", dx: 22, dy: -26 },
  { command: "KB", dx: 22, dy: 26, radius: 26, arcType: "ACC" },
  { command: "PP", dx: -14, dy: 26 },
  { command: "PP", dx: -18, dy: 26 }
];

function getTemplateCommands(orientationType) {
  if (orientationType === "vertical") {
    return TEMPLATE_COMMANDS.map(entry => ({
      ...entry,
      dx: entry.dy,
      dy: -entry.dx
    }));
  }
  return TEMPLATE_COMMANDS.map(entry => ({ ...entry }));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const fixed = value.toFixed(3);
  return fixed
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1")
    .replace(/\.0$/, "");
}

/**
 * Build a modern horizontal outlet routing using the standard template.
 * Returns both a routing object and the statement strings needed to serialize it.
 * @param {object} options
 * @param {{x:number,y:number}} options.center - Desired outlet center point.
 * @param {number} options.depth - Routing depth (matches legacy depth).
 * @param {number|null} options.zValue - Trailing value from legacy routing (kept as-is).
 * @param {number} [options.orientationValue=0] - Orientation value for PP/KB commands.
 * @param {number[]} [options.headerSource=[]] - Numbers used in the PAF header.
 * @param {number|null} [options.tool=null] - Tool number for routing metadata.
 * @param {number|null} [options.face=null] - Face identifier for routing metadata.
 * @param {number|null} [options.passes=null] - Pass count for routing metadata.
 * @param {string|null} [options.layer=null] - Target layer.
 * @param {string} [options.command="PAF"] - Routing command token (normally "PAF").
 * @param {string} [options.body=""] - Original routing body string.
 * @param {"horizontal"|"vertical"} [options.orientationType="horizontal"] - Layout orientation.
 */
export function createModernOutletRouting(options) {
  const {
    center,
    depth,
    zValue,
    orientationValue = 0,
    headerSource = [],
    tool = null,
    face = null,
    passes = null,
    layer = null,
    command = "PAF",
    body = "",
    orientationType = "horizontal"
  } = options ?? {};

  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    throw new Error("Invalid center point supplied for outlet replacement.");
  }

  const depthValue = Number.isFinite(depth) ? depth : -13;
  const trailingValue = Number.isFinite(zValue) ? zValue : depthValue;
  const orientation = Number.isFinite(orientationValue) ? orientationValue : 0;

  const statements = [];
  const snippetLines = [];

  const headerLine = Array.isArray(headerSource) && headerSource.length > 0
    ? `${command} ${headerSource.map(formatNumber).join(",")}`
    : command;
  statements.push(headerLine);
  snippetLines.push(`${headerLine};`);

  const templateCommands = getTemplateCommands(orientationType);

  for (const entry of templateCommands) {
    const x = center.x + entry.dx;
    const y = center.y + entry.dy;

    if (entry.command === "PP") {
      const line = `PP ${formatNumber(x)},${formatNumber(y)},${formatNumber(depthValue)},${formatNumber(CONTROL_CODE)},${formatNumber(orientation)},${formatNumber(trailingValue)}`;
      statements.push(line);
      snippetLines.push(`${line};`);
    } else if (entry.command === "KB") {
      const line = `KB ${formatNumber(x)},${formatNumber(y)},${formatNumber(entry.radius)},${entry.arcType},${formatNumber(depthValue)},${formatNumber(CONTROL_CODE)},${formatNumber(orientation)},${formatNumber(trailingValue)}`;
      statements.push(line);
      snippetLines.push(`${line};`);
    }
  }

  const snippet = `${snippetLines.join("\n")}\n`;
  const parsed = parseWup(snippet);
  const newRouting = parsed?.pafRoutings?.[0];

  if (!newRouting) {
    throw new Error("Failed to generate modern outlet routing.");
  }

  newRouting.tool = tool;
  newRouting.face = face;
  newRouting.passes = passes;
  newRouting.layer = layer;
  newRouting.source = Array.isArray(headerSource) ? [...headerSource] : [];
  newRouting.body = body;
  newRouting.__command = command;
  newRouting.__body = body;

  return {
    routing: newRouting,
    statements,
    snippet
  };
}
