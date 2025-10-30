let statusEl = null;
let fileInput = null;
let loadExampleBtn = null;

if (typeof document !== "undefined") {
  statusEl = document.getElementById("status");
  fileInput = document.getElementById("wupFile");
  loadExampleBtn = document.getElementById("loadExample");

  if (fileInput) {
    fileInput.addEventListener("change", event => {
      const [file] = event.target.files;
      if (!file) {
        return;
      }
      readFileAsText(file)
        .then(text => handleWupText(text, file.name))
        .catch(err => reportError(`Unable to read ${file.name}: ${err.message}`));
    });
  }

  if (loadExampleBtn) {
    loadExampleBtn.addEventListener("click", () => {
      fetch("example.wup")
        .then(resp => {
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          return resp.text();
        })
        .then(text => handleWupText(text, "example.wup"))
        .catch(err => reportError(`Unable to load bundled example: ${err.message}`));
    });
  }
}

function handleWupText(text, label) {
  try {
    const model = parseWup(text);
    const renderedModel = normalizeModel(model);
    if (typeof document !== "undefined") {
      document.dispatchEvent(
        new CustomEvent("wup:model", {
          detail: {
            model: renderedModel,
            label
          }
        })
      );
    }
    if (typeof window !== "undefined") {
      window.__lastWupModel = { model: renderedModel, label };
    }
    const studCount = model.studs.length;
    const blockingCount = model.blocking.length;
    const plateCount = model.plates.length;
    const wallWidth = model.wall?.width ? model.wall.width.toFixed(0) : "?";
    const wallHeight = model.wall?.height ? model.wall.height.toFixed(0) : "?";
    reportInfo(`Loaded ${label} — studs: ${studCount}, blocking: ${blockingCount}, plates: ${plateCount}, wall: ${wallWidth}×${wallHeight} mm`);
  } catch (err) {
    reportError(`Failed to parse ${label}: ${err.message}`);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Unknown file read error"));
    reader.onload = e => resolve(e.target.result);
    reader.readAsText(file);
  });
}

function reportInfo(message) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.remove("error");
  }
}

function reportError(message) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.add("error");
  }
  console.error(message);
}

function parseWup(wupText) {
  const model = {
    wall: null,
    modules: [],
    studs: [],
    plates: [],
    blocking: [],
    bounds: {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    },
    unhandled: []
  };

  const statements = wupText
    .split(/;\s*/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  let currentModule = null;

  for (const statement of statements) {
    const { command, body } = splitCommand(statement);
    const numbers = extractNumbers(body);

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
          const rect = buildRectFromElement(numbers, currentModule, {
            orientation: "vertical"
          });
          if (rect) {
            model.studs.push(rect);
            extendBounds(model.bounds, rect);
          }
        }
        break;
      }
      case "LS": {
        if (numbers.length >= 5) {
          const rect = buildRectFromElement(numbers, currentModule, {
            orientation: "horizontal"
          });
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
          const rect = buildRectFromElement(numbers, null, {
            orientation: "horizontal"
          });
          if (rect) {
            model.plates.push(rect);
            extendBounds(model.bounds, rect);
          }
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

function buildRectFromElement(numbers, moduleContext, options = {}) {
  const orientation = options.orientation || "vertical";
  // numbers format: [length, thickness, depth, x, y, rotation]
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

  return {
    x: originX + x,
    y: originY + y,
    width,
    height,
    rotation,
    source: numbers
  };
}

function extendBounds(bounds, rect) {
  bounds.minX = Math.min(bounds.minX, rect.x);
  bounds.minY = Math.min(bounds.minY, rect.y);
  bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width);
  bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height);
}

function normalizeModel(model) {
  const wallWidth = model.wall?.width ?? (model.bounds.maxX - model.bounds.minX);
  const wallHeight = model.wall?.height ?? (model.bounds.maxY - model.bounds.minY);

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

if (typeof window !== "undefined") {
  window.parseWup = parseWup;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseWup, buildRectFromElement };
}
