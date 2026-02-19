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
        tooltip: "PAF: Defines a routing operation for cutting or milling",
        tokens: parsePafTokens(routing, pafStatement)
      });
    }

    // Handle segment-specific lines
    if (segment) {
      const segmentIndex = Array.isArray(routing.segments)
        ? routing.segments.findIndex(candidate => candidate === segment)
        : -1;

      // Handle MP (circular) segments
      if (segment.position && Array.isArray(segment.source)) {
        const editableMeta = Array.isArray(segment.source)
          ? segment.source.map((value, numberIndex) => {
              if (segmentIndex < 0) {
                return null;
              }
              const numeric = Number(value);
              if (numberIndex === 0 && Number.isFinite(numeric)) {
                return {
                  context: {
                    kind: "paf",
                    segmentIndex,
                    command: "MP",
                    numberIndex
                  },
                  label: "MP Center X"
                };
              }
              if (numberIndex === 1 && Number.isFinite(numeric)) {
                return {
                  context: {
                    kind: "paf",
                    segmentIndex,
                    command: "MP",
                    numberIndex
                  },
                  label: "MP Center Y"
                };
              }
              return null;
            })
          : [];
        const mpLine = formatMPCommand(segment.source);
        lines.push({
          text: mpLine,
          tooltip: "MP (Circle Point): Defines a circular routing operation",
          tokens: parseMPTokens(segment.source, {
            object: operation,
            labelPrefix: "MP",
            editableMeta
          })
        });
      }
      // Handle PP/KB (polygon/polyline) segments - source is array of {command, numbers, type}
      else if (Array.isArray(segment.source)) {
        segment.source.forEach((sourceEntry, entryIndex) => {
          if (sourceEntry.command === "PP") {
            const editableMeta = Array.isArray(sourceEntry.numbers)
              ? sourceEntry.numbers.map((value, numberIndex) => {
                  if (segmentIndex < 0) {
                    return null;
                  }
                  const numeric = Number(value);
                  if (numberIndex === 0 && Number.isFinite(numeric)) {
                    return {
                      context: {
                        kind: "paf",
                        segmentIndex,
                        command: "PP",
                        entryIndex,
                        numberIndex
                      },
                      label: "PP X"
                    };
                  }
                  if (numberIndex === 1 && Number.isFinite(numeric)) {
                    return {
                      context: {
                        kind: "paf",
                        segmentIndex,
                        command: "PP",
                        entryIndex,
                        numberIndex
                      },
                      label: "PP Y"
                    };
                  }
                  return null;
                })
              : [];
            const ppLine = formatPPCommand(sourceEntry.numbers);
            lines.push({
              text: ppLine,
              tooltip: "PP (Polygon Point): Defines a point in the routing path",
              tokens: parsePPTokens(sourceEntry.numbers, {
                object: operation,
                labelPrefix: "PP",
                editableMeta
              })
            });
          } else if (sourceEntry.command === "KB") {
            const editableMeta = Array.isArray(sourceEntry.numbers)
              ? sourceEntry.numbers.map((value, numberIndex) => {
                  if (segmentIndex < 0) {
                    return null;
                  }
                  const numeric = Number(value);
                  const isCoordinateIndex = numberIndex === 0 || numberIndex === 1;
                  if (!isCoordinateIndex || !Number.isFinite(numeric)) {
                    return null;
                  }
                  const labelSuffix =
                    numberIndex === 0
                      ? "End X"
                      : "End Y";
                  return {
                    context: {
                      kind: "paf",
                      segmentIndex,
                      command: "KB",
                      entryIndex,
                      numberIndex
                    },
                    label: `KB ${labelSuffix}`
                  };
                })
              : [];
            const kbLine = formatKBCommand(sourceEntry.numbers, sourceEntry.type);
            lines.push({
              text: kbLine,
              tooltip: "KB (Curve/Arc): Defines an arc segment in the routing path",
              tokens: parseKBTokens(sourceEntry.numbers, sourceEntry.type, {
                object: operation,
                labelPrefix: "KB",
                editableMeta
              })
            });
          }
        });
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
          tokens: parseBoyTokens(boyOp, { object: operation })
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
          tokens: parseNailRowTokens(nailRow, { object: operation })
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

  tokens.push({ text: "PAF", tooltip: "Command: PAF", span: "command" });

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
function parsePPTokens(numbers, options = {}) {
  const tokens = [];

  tokens.push({ text: "PP", tooltip: "Command: Polygon Point", span: "command" });
  tokens.push({ text: " ", tooltip: null, span: "punctuation" });

  const labels = [
    { name: "X", desc: "X coordinate" },
    { name: "Y", desc: "Y coordinate" },
    { name: "t", desc: "Depth of cut" },
    { name: "i", desc: "Control code (tool offset/compensation)" }
  ];
  const { object = null, labelPrefix = "PP", editableMeta = [] } = options;

  numbers.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    const token = {
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    };

    const meta = Array.isArray(editableMeta) ? editableMeta[index] : null;
    const numericValue = Number.parseFloat(num);
    let axis = null;
    if (index === 0) {
      axis = "x";
    } else if (index === 1) {
      axis = "y";
    }
    if (meta && axis && object && Number.isFinite(numericValue)) {
      const labelText = meta.label ?? (labelPrefix ? `${labelPrefix} ${label.name}`.trim() : label.name);
      token.editable = {
        axis: meta.axis ?? axis,
        object,
        originValue: numericValue,
        label: labelText,
        context: meta.context ?? null
      };
    }

    tokens.push(token);
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse KB (arc/curve) command tokens
 */
function parseKBTokens(numbers, type, options = {}) {
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
  const { object = null, labelPrefix = "KB", editableMeta = [] } = options;

  numbers.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    const token = {
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    };

    let axis = null;
    if (index === 0 || index === 2) {
      axis = "x";
    } else if (index === 1) {
      axis = "y";
    }
    const numericValue = Number.parseFloat(num);
    const meta = Array.isArray(editableMeta) ? editableMeta[index] : null;
    if (meta && axis && object && Number.isFinite(numericValue)) {
      const labelText = meta.label ?? (labelPrefix ? `${labelPrefix} ${label.name}`.trim() : label.name);
      token.editable = {
        axis: meta.axis ?? axis,
        object,
        originValue: numericValue,
        label: labelText,
        context: meta.context ?? null
      };
    }

    tokens.push(token);
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
function parseMPTokens(numbers, options = {}) {
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
  const { object = null, labelPrefix = "MP", editableMeta = [] } = options;

  numbers.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    const token = {
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    };

    let axis = null;
    if (index === 0) {
      axis = "x";
    } else if (index === 1) {
      axis = "y";
    }
    const meta = Array.isArray(editableMeta) ? editableMeta[index] : null;
    const numericValue = Number.parseFloat(num);
    if (meta && axis && object && Number.isFinite(numericValue)) {
      const labelText = meta.label ?? (labelPrefix ? `${labelPrefix} ${label.name}`.trim() : label.name);
      token.editable = {
        axis: meta.axis ?? axis,
        object,
        originValue: numericValue,
        label: labelText,
        context: meta.context ?? null
      };
    }

    tokens.push(token);
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse BOY command tokens
 */
function parseBoyTokens(boyOp, options = {}) {
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
  const { object = null, labelPrefix = "BOY" } = options;

  source.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    const token = {
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    };

    let axis = null;
    if (index === 0) {
      axis = "x";
    } else if (index === 1) {
      axis = "z";
    }
    const numericValue = Number.parseFloat(num);
    if (axis && object && Number.isFinite(numericValue)) {
      const labelText = labelPrefix ? `${labelPrefix} ${label.name}`.trim() : label.name;
      token.editable = {
        axis,
        object,
        originValue: numericValue,
        label: labelText,
        context: {
          kind: "boy",
          valueIndex: index
        }
      };
    }

    tokens.push(token);
  });

  tokens.push({ text: ";", tooltip: null, span: "punctuation" });

  return tokens;
}

/**
 * Parse nail row command tokens
 */
function parseNailRowTokens(nailRow, options = {}) {
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
  const { object = null, labelPrefix = "NR" } = options;

  source.forEach((num, index) => {
    if (index > 0) {
      tokens.push({ text: ",", tooltip: null, span: "punctuation" });
    }

    const label = labels[index] || { name: `Param ${index}`, desc: "Parameter" };
    const token = {
      text: num.toString(),
      tooltip: `${label.name}: ${num} - ${label.desc}`,
      span: "parameter"
    };

    let axis = null;
    if (index === 0 || index === 2) {
      axis = "x";
    } else if (index === 1 || index === 3) {
      axis = "y";
    }
    const numericValue = Number.parseFloat(num);
    if (axis && object && Number.isFinite(numericValue)) {
      const labelText = labelPrefix ? `${labelPrefix} ${label.name}`.trim() : label.name;
      token.editable = {
        axis,
        object,
        originValue: numericValue,
        label: labelText,
        context: {
          kind: "nailRow",
          valueIndex: index
        }
      };
    }

    tokens.push(token);
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
export function createSourceViewer({ container, state, controller } = {}) {
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
  const editController = controller ?? null;

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
          if (token.editable && editController?.startCoordinateEditFromSource) {
            const payload = {
              object: token.editable.object,
              axis: token.editable.axis,
              originValue: token.editable.originValue,
              label: token.editable.label,
              context: token.editable.context ?? null
            };
            if (
              payload.object &&
              payload.axis &&
              Number.isFinite(payload.originValue) &&
              payload.context
            ) {
              tokenEl.classList.add("token-editable");
              tokenEl.tabIndex = 0;
              tokenEl.setAttribute("role", "button");
              const activate = event => {
                event.preventDefault();
                event.stopPropagation();
                editController.startCoordinateEditFromSource(payload);
              };
              tokenEl.addEventListener("click", activate);
              tokenEl.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                  activate(event);
                }
              });
            }
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
