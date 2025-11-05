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
    pafRoutings: [],
    boyOperations: [],
    bounds: { ...DEFAULT_BOUNDS },
    unhandled: []
  };

  const rawStatements = wupText.split(";");
  const statements = [];
  for (const raw of rawStatements) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    statements.push(trimmed);
  }

  model.__statements = statements.slice();
  model.__sourceText = wupText;

  let nextEditorId = 1;
  const assignEditorId = element => {
    if (!element || typeof element !== "object") {
      return;
    }
    if (typeof element.__editorId === "number") {
      return;
    }
    element.__editorId = nextEditorId;
    nextEditorId += 1;
  };

  let currentModule = null;
  let currentPanel = null;
  let currentRouting = null;
  let currentPolygon = null;
  let activePanelLayer = null;
  let lastBoyContext = null;

  function setBoyContext(kind, role, element) {
    if (!kind) {
      lastBoyContext = null;
      return;
    }
    lastBoyContext = { kind, role: role ?? null, element: element ?? null };
  }

  function finalizePolygonSegment() {
    if (!currentPolygon) {
      return;
    }

    const { points: sampledPoints, pathSegments } = buildPolygonPath(currentPolygon.commands);
    const deduped = dedupePolygonPoints(sampledPoints);
    if (!currentRouting || deduped.length < 2) {
      currentPolygon = null;
      return;
    }

    let closed = isClosedLoop(deduped);
    let loopPoints = deduped;
    if (!closed && deduped.length >= 3) {
      loopPoints = [...deduped, deduped[0]];
      closed = true;
    }
    const normalizedPoints = (closed ? loopPoints.slice(0, -1) : loopPoints).map(point => ({ ...point }));
    for (const point of sampledPoints) {
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
        extendBoundsPoint(model.bounds, point.x, point.y);
      }
    }
    if (closed && normalizedPoints.length >= 3) {
      const segment = {
        kind: "polygon",
        points: normalizedPoints,
        pathSegments: pathSegments.map(segment => clonePathSegment(segment)),
        depth: averageOrNull(currentPolygon.depthSamples, Math.abs),
        depthRaw: averageOrNull(currentPolygon.depthRawSamples),
        offset: averageOrNull(currentPolygon.offsetSamples),
        orientation: averageOrNull(currentPolygon.orientationSamples),
        z: averageOrNull(currentPolygon.zSamples),
        source: currentPolygon.source.map(entry => cloneSourceEntry(entry))
      };
      const controlCode = averageOrNull(currentPolygon.offsetSamples);
      if (Number.isFinite(controlCode)) {
        segment.controlCode = Math.round(controlCode);
      }
      currentRouting.segments.push(segment);
    } else if (normalizedPoints.length >= 2) {
      const segment = {
        kind: "polyline",
        points: normalizedPoints,
        pathSegments: pathSegments.map(segment => clonePathSegment(segment)),
        depth: averageOrNull(currentPolygon.depthSamples, Math.abs),
        depthRaw: averageOrNull(currentPolygon.depthRawSamples),
        offset: averageOrNull(currentPolygon.offsetSamples),
        orientation: averageOrNull(currentPolygon.orientationSamples),
        z: averageOrNull(currentPolygon.zSamples),
        source: currentPolygon.source.map(entry => cloneSourceEntry(entry))
      };
      const controlCode = averageOrNull(currentPolygon.offsetSamples);
      if (Number.isFinite(controlCode)) {
        segment.controlCode = Math.round(controlCode);
      }
      currentRouting.segments.push(segment);
    }

    currentPolygon = null;
  }

  function finalizeRouting() {
    finalizePolygonSegment();
    if (currentRouting && currentRouting.segments.length > 0) {
      assignEditorId(currentRouting);
      model.pafRoutings.push(currentRouting);
    } else if (currentRouting) {
      model.unhandled.push({
        command: "PAF",
        numbers: currentRouting.source ?? [],
        body: currentRouting.body ?? ""
      });
    }
    currentRouting = null;
  }

  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex];
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
            originY: numbers[4],
            originZ: numbers[5] ?? 0
          };
          model.modules.push(currentModule);
          setBoyContext(null);
        }
        break;
      }
      case "ENDMODUL": {
        currentModule = null;
        setBoyContext(null);
        break;
      }
      case "QS": {
        if (numbers.length >= 5) {
          const offset = extractPlacementOffset(body);
          const rect = buildRectFromElement(numbers, currentModule, { orientation: "vertical", offset });
          if (rect) {
            model.studs.push(rect);
            extendBounds(model.bounds, rect);
            setBoyContext("stud", null, rect);
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
            setBoyContext("blocking", null, rect);
          }
        }
        break;
      }
      case "OG":
      case "UG": {
        if (numbers.length >= 5) {
          const offset = extractPlacementOffset(body);
          const rect = buildRectFromElement(numbers, null, {
            orientation: "horizontal",
            offset,
            role: command === "OG" ? "top" : "bottom"
          });
          if (rect) {
            model.plates.push(rect);
            extendBounds(model.bounds, rect);
            setBoyContext("plate", command === "OG" ? "top" : "bottom", rect);
          }
        }
        break;
      }
      case "PAF": {
        finalizeRouting();
        currentRouting = {
          tool: numbers[0] ?? null,
          face: numbers[1] ?? null,
          passes: numbers[2] ?? null,
          segments: [],
          layer: activePanelLayer ?? null,
          source: numbers,
          body,
          __statementIndex: statementIndex,
          __statementIndices: [statementIndex],
          __command: command,
          __body: body
        };
        break;
      }
      case "MP": {
        finalizePolygonSegment();
        if (!currentRouting) {
          model.unhandled.push({ command, numbers, body });
          break;
        }
        if (numbers.length >= 3) {
          const position = { x: numbers[0], y: numbers[1] };
          const radiusValue = numbers[2] ?? null;
          const depthRaw = numbers[3] ?? null;
          const segment = {
            position,
            radius: Number.isFinite(radiusValue) ? Math.abs(radiusValue) : null,
            depth: Number.isFinite(depthRaw) ? Math.abs(depthRaw) : null,
            depthRaw: Number.isFinite(depthRaw) ? depthRaw : null,
            orientation: numbers[4] ?? null,
            feed: numbers[5] ?? null,
            extras: numbers.slice(6),
            source: numbers
          };
          if (Number.isFinite(numbers[4])) {
            segment.controlCode = Math.round(numbers[4]);
          }
          currentRouting.segments.push(segment);
          if (Array.isArray(currentRouting.__statementIndices)) {
            currentRouting.__statementIndices.push(statementIndex);
          }
          const radius = Number.isFinite(segment.radius) ? segment.radius : 0;
          extendBoundsPoint(model.bounds, position.x - radius, position.y - radius);
          extendBoundsPoint(model.bounds, position.x + radius, position.y + radius);
        } else {
          model.unhandled.push({ command, numbers, body });
        }
        break;
      }
      case "PLI1":
      case "PLA1": {
        const panelParams = extractPanelParameters(body);
        const panelNumbers = panelParams.numbers.length >= 6 ? panelParams.numbers : numbers;
        if (panelNumbers.length >= 6) {
          const materialToken = panelParams.materialToken ?? extractFirstStringToken(body);
          const materialIndex = panelNumbers[5];
          const zPosition = panelNumbers.length >= 7 ? panelNumbers[6] : null;
          const rotationValue = panelNumbers.length >= 8 ? panelNumbers[7] : null;
          const faceDirection = command.startsWith("PLA") ? -1 : 1;
          const layer = faceDirection >= 0 ? "pli" : "pla";
          const panel = {
            width: panelNumbers[0],
            height: panelNumbers[1],
            thickness: panelNumbers[2],
            x: panelNumbers[3],
            y: panelNumbers[4],
            offset: Number.isFinite(zPosition) ? zPosition : null,
            rotation: Number.isFinite(rotationValue) ? rotationValue : 0,
            materialIndex: Number.isFinite(materialIndex) ? materialIndex : null,
            material: materialToken ?? null,
            faceDirection,
            layer,
            points: [],
            source: [...panelNumbers]
          };
          model.sheathing.push(panel);
          currentPanel = panel;
          activePanelLayer = layer;
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
        } else if (currentRouting && numbers.length >= 2) {
          const x = numbers[0];
          const y = numbers[1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            model.unhandled.push({ command, numbers, body });
            break;
          }

        if (!currentPolygon) {
          currentPolygon = {
            commands: [],
            depthSamples: [],
            depthRawSamples: [],
            offsetSamples: [],
            orientationSamples: [],
            zSamples: [],
            source: []
          };
        }

        const zValue = Number.isFinite(numbers[2]) ? numbers[2] : null;
        const offsetValue = Number.isFinite(numbers[3]) ? numbers[3] : null;
          const orientationValue = Number.isFinite(numbers[4]) ? numbers[4] : null;
          const trailingValue = Number.isFinite(numbers[5]) ? numbers[5] : null;
          const depthRawValue = derivePafDepthValue(zValue, trailingValue);
          const extras = numbers.slice(6);
          if (Number.isFinite(trailingValue) && !Object.is(depthRawValue, trailingValue)) {
            extras.unshift(trailingValue);
          }

          const point = {
            x,
            y,
            z: zValue,
            offset: offsetValue,
            orientation: orientationValue,
            depthRaw: depthRawValue,
            extras,
            source: [...numbers]
          };

          currentPolygon.source.push({ command: "PP", numbers: [...numbers] });
          if (currentRouting && Array.isArray(currentRouting.__statementIndices)) {
            currentRouting.__statementIndices.push(statementIndex);
          }

          if (Number.isFinite(point.depthRaw)) {
            currentPolygon.depthSamples.push(Math.abs(point.depthRaw));
            currentPolygon.depthRawSamples.push(point.depthRaw);
          }
          if (Number.isFinite(point.offset)) {
            currentPolygon.offsetSamples.push(point.offset);
          }
          if (Number.isFinite(point.orientation)) {
            currentPolygon.orientationSamples.push(point.orientation);
          }
          if (Number.isFinite(point.z)) {
            currentPolygon.zSamples.push(point.z);
          }
          extendBoundsPoint(model.bounds, point.x, point.y);

          if (currentPolygon.commands.length === 0) {
            currentPolygon.commands.push({ kind: "move", point });
          } else {
            currentPolygon.commands.push({ kind: "line", point });
          }
        } else {
          model.unhandled.push({ command, numbers, body });
        }
        break;
      }
      case "KB": {
        if (!currentRouting) {
          model.unhandled.push({ command, numbers, body });
          break;
        }

        const tokens = body
          .split(",")
          .map(token => token.trim())
          .filter(token => token.length > 0);
        const typeToken = tokens[3] ?? null;
        const x = numbers[0];
        const y = numbers[1];
        const radiusValue = numbers[2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radiusValue) || !typeToken) {
          model.unhandled.push({ command, numbers, body });
          break;
        }

        if (!currentPolygon) {
          currentPolygon = {
            commands: [],
            depthSamples: [],
            depthRawSamples: [],
            offsetSamples: [],
            orientationSamples: [],
            zSamples: [],
            source: []
          };
        }

        const depthCandidate = Number.isFinite(numbers[3]) ? numbers[3] : null;
        const offsetValue = Number.isFinite(numbers[4]) ? numbers[4] : null;
        const orientationValue = Number.isFinite(numbers[5]) ? numbers[5] : null;
        const zValue = Number.isFinite(numbers[6]) ? numbers[6] : null;
        const depthRawValue = derivePafDepthValue(depthCandidate, zValue);
        const extras = numbers.slice(7);

        const point = {
          x,
          y,
          z: zValue,
          offset: offsetValue,
          orientation: orientationValue,
          depthRaw: depthRawValue,
          extras,
          arcType: typeToken,
          radius: Math.abs(radiusValue),
          source: [...numbers]
        };

        if (Number.isFinite(point.depthRaw)) {
          currentPolygon.depthSamples.push(Math.abs(point.depthRaw));
          currentPolygon.depthRawSamples.push(point.depthRaw);
        }
        if (Number.isFinite(point.offset)) {
          currentPolygon.offsetSamples.push(point.offset);
        }
        if (Number.isFinite(point.orientation)) {
          currentPolygon.orientationSamples.push(point.orientation);
        }
        if (Number.isFinite(point.z)) {
          currentPolygon.zSamples.push(point.z);
        }
        extendBoundsPoint(model.bounds, point.x, point.y);

        const arcCommand = {
          kind: "arc",
          point,
          radius: Math.abs(radiusValue),
          direction: inferArcDirection(typeToken),
          largeArc: isLargeArc(typeToken),
          rawType: typeToken
        };
        currentPolygon.commands.push(arcCommand);
        currentPolygon.source.push({ command: "KB", numbers: [...numbers], type: typeToken });
        if (currentRouting && Array.isArray(currentRouting.__statementIndices)) {
          currentRouting.__statementIndices.push(statementIndex);
        }
        break;
      }
      case "NR": {
        if (numbers.length >= 4) {
          const layer = activePanelLayer ?? "pli";
          const row = {
            start: { x: numbers[0], y: numbers[1] },
            end: { x: numbers[2], y: numbers[3] },
            spacing: numbers[4] ?? null,
            gauge: numbers[5] ?? null,
            layer,
            source: numbers,
            __statementIndex: statementIndex,
            __command: command,
            __body: body
          };
          assignEditorId(row);
          model.nailRows.push(row);
          extendBoundsPoint(model.bounds, row.start.x, row.start.y);
          extendBoundsPoint(model.bounds, row.end.x, row.end.y);
        } else {
          model.unhandled.push({ command, numbers, body });
        }
        break;
      }
      case "BOY": {
        if (numbers.length >= 4) {
          const [xRaw, zRaw, diameterRaw, depthRaw] = numbers;
          if (Number.isFinite(xRaw) && Number.isFinite(zRaw)) {
            const diameter = Number.isFinite(diameterRaw) ? Math.abs(diameterRaw) : null;
            const depth = Number.isFinite(depthRaw) ? depthRaw : null;
            const context = lastBoyContext ?? null;
            const resolvedPosition = resolveBoyCoordinates(
              { x: xRaw, z: zRaw },
              currentModule,
              context?.element ?? null
            );
            const absoluteX = Number.isFinite(resolvedPosition?.x) ? resolvedPosition.x : xRaw;
            const absoluteZ = Number.isFinite(resolvedPosition?.z) ? resolvedPosition.z : zRaw;
            const operation = {
              x: absoluteX,
              z: absoluteZ,
              localX: xRaw,
              localZ: zRaw,
              diameter,
              depth,
              targetElement: context?.element ?? null,
              targetKind: context?.kind ?? null,
              targetRole: context?.role ?? null,
              source: numbers,
              __statementIndex: statementIndex,
              __command: command,
              __body: body
            };
            assignEditorId(operation);
            model.boyOperations.push(operation);
            const radius = Number.isFinite(diameter) ? diameter / 2 : 0;
            extendBoundsPoint(model.bounds, operation.x - radius, operation.z);
            extendBoundsPoint(model.bounds, operation.x + radius, operation.z);
          } else {
            model.unhandled.push({ command, numbers, body });
          }
        } else {
          model.unhandled.push({ command, numbers, body });
        }
        break;
      }
    default: {
      finalizePolygonSegment();
      model.unhandled.push({ command, numbers, body });
    }
  }
}

  finalizeRouting();

  if (!Number.isFinite(model.bounds.minX)) {
    throw new Error("No frame members detected in the WUP file");
  }

  model.__nextEditorId = nextEditorId;

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
    localX: x,
    localY: y,
    width,
    height,
    rotation,
    offset: Number.isFinite(offsetValue) ? offsetValue : null,
    orientation: orientation || null,
    role: typeof options.role === "string" ? options.role : null,
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

function splitStatementTokens(body) {
  if (!body) {
    return [];
  }
  return body
    .split(",")
    .map(token => token.replace(/[;]+$/g, "").trim())
    .filter(token => token.length > 0);
}

function extractPanelParameters(body) {
  const tokens = splitStatementTokens(body);
  const numbers = [];
  let materialToken = null;
  for (const token of tokens) {
    if (!materialToken && !isNumericToken(token)) {
      materialToken = token;
      continue;
    }
    if (isNumericToken(token)) {
      numbers.push(Number(token));
    }
  }
  return { numbers, materialToken };
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

function dedupePolygonPoints(points) {
  const result = [];
  for (const point of points ?? []) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
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

function isApproximatelyEqual(a, b) {
  return Math.abs(a - b) < 1e-6;
}

function derivePafDepthValue(zValue, trailingValue) {
  const hasZ = Number.isFinite(zValue);
  const hasTrailing = Number.isFinite(trailingValue);
  if (!hasZ && !hasTrailing) {
    return null;
  }
  if (hasZ && (!hasTrailing || Math.abs(zValue) > 1e-6)) {
    return zValue;
  }
  if (!hasZ) {
    return trailingValue;
  }
  if (!hasTrailing) {
    return zValue;
  }
  if (Math.abs(zValue) <= 1e-6 && Math.abs(trailingValue) > Math.abs(zValue)) {
    return trailingValue;
  }
  if (Math.abs(trailingValue) <= 1e-6 && Math.abs(zValue) > Math.abs(trailingValue)) {
    return zValue;
  }
  return Math.abs(zValue) <= Math.abs(trailingValue) ? zValue : trailingValue;
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
      clockwise: Boolean(segment.clockwise),
      sweep: segment.sweep,
      signedSweep: segment.signedSweep,
      largeArc: Boolean(segment.largeArc),
      rawType: segment.rawType ?? null
    };
  }
  if (segment.type === "line") {
    return {
      type: "line",
      from: { ...segment.from },
      to: { ...segment.to },
      fallback: Boolean(segment.fallback)
    };
  }
  return { ...segment };
}

function cloneSourceEntry(entry) {
  if (!entry) {
    return entry;
  }
  if (Array.isArray(entry)) {
    return entry.map(value => value);
  }
  if (typeof entry === "object") {
    const clone = { ...entry };
    if (Array.isArray(entry.numbers)) {
      clone.numbers = [...entry.numbers];
    }
    return clone;
  }
  return entry;
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

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function averageOrNull(values, mapFn = v => v) {
  if (!values || values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, value) => acc + mapFn(value), 0);
  return sum / values.length;
}

function resolveBoyCoordinates(local, moduleContext, targetElement) {
  if (!local || (local.x == null && local.z == null)) {
    return { x: null, z: null };
  }

  const moduleOriginX = Number.isFinite(moduleContext?.originX) ? moduleContext.originX : null;
  const moduleOriginZ = Number.isFinite(moduleContext?.originZ) ? moduleContext.originZ : null;

  let baseX = Number.isFinite(targetElement?.x) ? targetElement.x : null;
  if (baseX === null && Number.isFinite(targetElement?.localX) && Number.isFinite(moduleOriginX)) {
    baseX = moduleOriginX + targetElement.localX;
  }
  if (baseX === null && moduleOriginX !== null) {
    baseX = moduleOriginX;
  }

  const resolvedX =
    Number.isFinite(local.x) && baseX !== null ? baseX + local.x : Number.isFinite(local.x) ? local.x : null;
  const resolvedZ = Number.isFinite(local.z)
    ? (moduleOriginZ !== null ? moduleOriginZ : 0) + local.z
    : null;

  return { x: resolvedX, z: resolvedZ };
}

if (typeof window !== "undefined") {
  window.parseWup = parseWup;
}

export const _internal = {
  splitCommand,
  extractNumbers,
  extractPlacementOffset,
  extendBounds,
  extendBoundsPoint,
  resolveBoyCoordinates
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseWup, normalizeModel, buildRectFromElement };
}
