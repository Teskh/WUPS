// Source code viewer for operations
// Displays the WUP source code of selected operations with tooltips

/**
 * Generates human-readable source code from an operation with tooltip information
 * @param {Object} operation - The operation object (PAF, BOY, nail row, etc.)
 * @param {Object} model - The parsed WUP model
 * @returns {Array} Array of source lines with tooltip data
 */
function generateSourceLines(operation, model) {
  const lines = [];

  if (!operation?.userData) {
    return lines;
  }

  const kind = operation.userData.kind;
  const statements = model.__statements || [];

  // Handle PAF routing operations
  if (kind === "paf") {
    const routing = operation.userData.routing;
    const segment = operation.userData.segment;

    if (!routing) {
      return lines;
    }

    // PAF command line
    const pafIndex = routing.__statementIndex;
    if (Number.isFinite(pafIndex) && statements[pafIndex]) {
      const pafStatement = statements[pafIndex];
      lines.push({
        text: pafStatement,
        tooltip: "PAF (Panel Assembly Function): Defines a routing operation for cutting or milling",
        tokens: parsePafTokens(routing, pafStatement)
      });
    }

    // Handle segment-specific lines
    if (segment) {
      // Handle MP (circular) segments
      if (segment.position && Array.isArray(segment.source)) {
        const mpLine = formatMPCommand(segment.source);
        lines.push({
          text: mpLine,
          tooltip: "MP (Circle Point): Defines a circular routing operation",
          tokens: parseMPTokens(segment.source)
        });
      }
      // Handle PP/KB (polygon/polyline) segments - source is array of {command, numbers, type}
      else if (Array.isArray(segment.source)) {
        for (const sourceEntry of segment.source) {
          if (sourceEntry.command === "PP") {
            const ppLine = formatPPCommand(sourceEntry.numbers);
            lines.push({
              text: ppLine,
              tooltip: "PP (Polygon Point): Defines a point in the routing path",
              tokens: parsePPTokens(sourceEntry.numbers)
            });
          } else if (sourceEntry.command === "KB") {
            const kbLine = formatKBCommand(sourceEntry.numbers, sourceEntry.type);
            lines.push({
              text: kbLine,
              tooltip: "KB (Curve/Arc): Defines an arc segment in the routing path",
              tokens: parseKBTokens(sourceEntry.numbers, sourceEntry.type)
            });
          }
        }
      }
    }
  }

  // Handle BOY operations
  else if (kind === "boy") {
    const boyOp = operation.userData.operation;
    if (boyOp && Number.isFinite(boyOp.__statementIndex)) {
      const statement = statements[boyOp.__statementIndex];
      if (statement) {
        lines.push({
          text: statement,
          tooltip: "BOY: Defines a drilling operation (typically for bolts or fasteners)",
          tokens: parseBoyTokens(boyOp)
        });
      }
    }
  }

  // Handle nail row operations
  else if (kind === "nailRow") {
    const nailRow = operation.userData.row;
    if (nailRow && Number.isFinite(nailRow.__statementIndex)) {
      const statement = statements[nailRow.__statementIndex];
      if (statement) {
        lines.push({
          text: statement,
          tooltip: "NR (Nail row): Defines a line of nails for fastening",
          tokens: parseNailRowTokens(nailRow)
        });
      }
    }
  }

  return lines;
}

/**
 * Parse PAF command tokens with tooltips
 */
function parsePafTokens(routing, statement) {
  const tokens = [];

  // Match "PAF 2,0,1;" or "PAF;"
  const parts = statement.match(/PAF\s*([^;]*)/);

  tokens.push({ text: "PAF", tooltip: "Command: Panel Assembly Function", span: "command" });

  if (!parts || !parts[1] || !parts[1].trim()) {
    tokens.push({ text: ";", tooltip: null, span: "punctuation" });
    return tokens;
  }

  const numbers = parts[1].trim().split(/\s*,\s*/).filter(n => n.trim());

  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  // e (reference plane)
  if (numbers[0]) {
    tokens.push({
      text: numbers[0],
      tooltip: `Reference plane (e): ${numbers[0]} - Defines the coordinate system for this routing`,
      span: "parameter"
    });
  }

  // i (trim mode)
  if (numbers[1]) {
    tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    const trimMode = parseInt(numbers[1]);
    let trimDesc = "Machine default";
    if (trimMode === 1) trimDesc = "No trimming";
    else if (trimMode === 2) trimDesc = "Force trimming";

    tokens.push({
      text: numbers[1],
      tooltip: `Trimming mode (i): ${numbers[1]} - ${trimDesc}`,
      span: "parameter"
    });
  }

  // T (tool number)
  if (numbers[2]) {
    tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    const toolNum = parseInt(numbers[2]);
    tokens.push({
      text: numbers[2],
      tooltip: `Tool override (T): ${numbers[2]} - ${toolNum === 0 ? "Machine selects tool automatically" : `Use tool ${toolNum}`}`,
      span: "parameter"
    });
  }

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse PP (Polygon Point) command tokens
 */
function parsePPTokens(numbers) {
  const tokens = [];

  tokens.push({ text: "PP", tooltip: "Command: Polygon Point", span: "command" });
  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  const labels = [
    { name: "X", desc: "X coordinate" },
    { name: "Y", desc: "Y coordinate" },
    { name: "t", desc: "Depth of cut" },
    { name: "i", desc: "Control code (tool offset/compensation)" }
  ];

  numbers.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    tokens.push({
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    });
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse KB (arc/curve) command tokens
 */
function parseKBTokens(numbers, type) {
  const tokens = [];

  tokens.push({ text: "KB", tooltip: "Command: Curve/Arc segment", span: "command" });
  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  const labels = [
    { name: "X_end", desc: "End X coordinate" },
    { name: "Y_end", desc: "End Y coordinate" },
    { name: "X_center", desc: "Arc center X coordinate (or arc radius)" },
    { name: "Arc_type", desc: "Arc direction (ACW=counterclockwise, Acw=clockwise)" },
    { name: "t", desc: "Depth of cut" },
    { name: "i", desc: "Control code" }
  ];

  numbers.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    tokens.push({
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    });
  });

  if (type) {
    tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    tokens.push({
      text: type,
      tooltip: `Arc type: ${type} - Defines the arc direction (ACW=counterclockwise, Acw=clockwise)`,
      span: "parameter"
    });
  }

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse MP (Circle Point) command tokens
 */
function parseMPTokens(numbers) {
  const tokens = [];

  tokens.push({ text: "MP", tooltip: "Command: Circle/Circular routing", span: "command" });
  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  const labels = [
    { name: "X", desc: "Center X coordinate" },
    { name: "Y", desc: "Center Y coordinate" },
    { name: "Radius", desc: "Circle radius" },
    { name: "t", desc: "Depth of cut" },
    { name: "i", desc: "Control code" },
    { name: "Additional", desc: "Additional parameter" }
  ];

  numbers.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    tokens.push({
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    });
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse BOY command tokens
 */
function parseBoyTokens(boyOp) {
  const tokens = [];
  const source = boyOp.source || [];

  tokens.push({ text: "BOY", tooltip: "Command: Drilling operation", span: "command" });
  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  const labels = [
    { name: "X", desc: "X coordinate (horizontal position)" },
    { name: "Z", desc: "Z coordinate (vertical position)" },
    { name: "Diameter", desc: "Drill bit diameter" },
    { name: "Depth", desc: "Drilling depth" }
  ];

  source.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    tokens.push({
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    });
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse nail row command tokens
 */
function parseNailRowTokens(nailRow) {
  const tokens = [];
  const source = nailRow.source || [];

  tokens.push({ text: "NR", tooltip: "Command: Nail row", span: "command" });
  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  const labels = [
    { name: "X_start", desc: "Start X coordinate" },
    { name: "Y_start", desc: "Start Y coordinate" },
    { name: "X_end", desc: "End X coordinate" },
    { name: "Y_end", desc: "End Y coordinate" },
    { name: "Spacing", desc: "Distance between nails" },
    { name: "Gauge", desc: "Nail gauge/size" }
  ];

  source.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    tokens.push({
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    });
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Format PP command from numbers
 */
function formatPPCommand(numbers) {
  return `PP ${numbers.join(",")};`;
}

/**
 * Format KB command from numbers and type
 */
function formatKBCommand(numbers, type) {
  const params = numbers.join(",");
  return type ? `KB ${params},${type};` : `KB ${params};`;
}

/**
 * Format MP command from numbers
 */
function formatMPCommand(numbers) {
  return `MP ${numbers.join(",")};`;
}

/**
 * Create the source viewer UI component
 */
export function createSourceViewer({ container, state } = {}) {
  if (!container || typeof document === "undefined") {
    return {
      updateSelection: () => {},
      cleanup: () => {}
    };
  }

  const root = document.createElement("section");
  root.className = "source-viewer hidden";

  const header = document.createElement("div");
  header.className = "source-viewer-header";

  const heading = document.createElement("h3");
  heading.textContent = "Operation Source Code";
  header.appendChild(heading);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "source-viewer-close";
  closeBtn.textContent = "×";
  closeBtn.title = "Close source viewer";
  header.appendChild(closeBtn);

  root.appendChild(header);

  const codeContainer = document.createElement("div");
  codeContainer.className = "source-viewer-code";
  root.appendChild(codeContainer);

  container.appendChild(root);

  let currentModel = null;

  function hide() {
    root.classList.add("hidden");
  }

  function show() {
    root.classList.remove("hidden");
  }

  function renderSourceLines(lines) {
    codeContainer.innerHTML = "";

    if (lines.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "source-viewer-empty";
      emptyMsg.textContent = "No source code available for this operation";
      codeContainer.appendChild(emptyMsg);
      return;
    }

    for (const line of lines) {
      const lineEl = document.createElement("div");
      lineEl.className = "source-line";
      lineEl.title = line.tooltip || "";

      if (line.tokens && line.tokens.length > 0) {
        for (const token of line.tokens) {
          const tokenEl = document.createElement("span");
          if (token.span) {
            tokenEl.className = `token-${token.span}`;
          }
          tokenEl.textContent = token.text;
          if (token.tooltip) {
            tokenEl.title = token.tooltip;
            tokenEl.classList.add("has-tooltip");
          }
          lineEl.appendChild(tokenEl);
        }
      } else {
        lineEl.textContent = line.text;
      }

      codeContainer.appendChild(lineEl);
    }
  }

  function updateSelection(selection, model) {
    currentModel = model;

    // Find an operation in the selection
    const operation = Array.isArray(selection)
      ? selection.find(item => {
          const kind = item?.userData?.kind;
          return kind === "paf" || kind === "boy" || kind === "nailRow";
        })
      : null;

    if (!operation || !model) {
      // Don't hide - just keep showing the last viewed source
      return;
    }

    const lines = generateSourceLines(operation, model);
    renderSourceLines(lines);
  }

  closeBtn.addEventListener("click", hide);

  return {
    updateSelection,
    show,
    hide,
    cleanup() {
      closeBtn.removeEventListener("click", hide);
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }
  };
}
