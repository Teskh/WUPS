import * as THREE from "three";

export function calculateScale(width, height) {
  const maxDim = Math.max(width, height);
  return maxDim > 0 ? 8 / maxDim : 1;
}

export function estimateSheathingTopZ(panels, wallThickness, wallSide) {
  const wallDir = wallSide >= 0 ? 1 : -1;
  const epsilon = 0.6;
  const defaults = {
    positive: wallDir * (wallThickness / 2 + epsilon),
    negative: -wallDir * (wallThickness / 2 + epsilon)
  };
  if (!Array.isArray(panels) || panels.length === 0) {
    return defaults;
  }
  let positiveExtremum = null;
  let negativeExtremum = null;
  for (const panel of panels) {
    const thickness = Number.isFinite(panel?.thickness) ? panel.thickness : wallThickness;
    if (!Number.isFinite(thickness)) {
      continue;
    }
    const faceDir = resolvePanelFaceDirection(panel, wallSide);
    const centerZ = computePanelZ(panel, wallThickness, wallSide);
    if (!Number.isFinite(centerZ)) {
      continue;
    }
    const top = centerZ + faceDir * (thickness / 2);
    if (!Number.isFinite(top)) {
      continue;
    }
    if (faceDir >= 0) {
      positiveExtremum = positiveExtremum === null ? top : Math.max(positiveExtremum, top);
    } else {
      negativeExtremum = negativeExtremum === null ? top : Math.min(negativeExtremum, top);
    }
  }
  return {
    positive: positiveExtremum ?? defaults.positive,
    negative: negativeExtremum ?? defaults.negative
  };
}

export function createMemberMesh(element, kind, context) {
  const { materials, highlightMaterials, scale, offsets, wallThickness, wallSide } = context;
  const material = materials?.[kind];
  if (!material || !highlightMaterials?.[kind]) {
    return null;
  }

  const { minX, minY, width, height } = offsets;
  const localX = element.x - minX;
  const localY = element.y - minY;
  const centerX = (localX + element.width / 2 - width / 2) * scale;
  const centerY = (localY + element.height / 2 - height / 2) * scale;

  const depthSource = element.source?.[2];
  const depthMm = Number.isFinite(depthSource) ? depthSource : wallThickness;
  const depth = Math.max(depthMm * scale, scale * 6);
  const centerZMm = computeMemberCenterZ(element, wallThickness, wallSide, depthMm);

  const geometry = new THREE.BoxGeometry(
    Math.max(element.width * scale, scale * 2),
    Math.max(element.height * scale, scale * 2),
    depth
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(centerX, centerY, centerZMm * scale);
  mesh.userData.kind = kind;
  mesh.userData.member = element;
  mesh.userData.originalMaterial = material;
  mesh.userData.layer = "structure";
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials[kind] : material;
  };
  return mesh;
}

export function createSheathingMesh(panel, context) {
  const { materials, highlightMaterials, scale, offsets, wallThickness, wallSide } = context;
  if (!materials?.sheathing || !highlightMaterials?.sheathing) {
    return null;
  }

  const contourSource = panel.points && panel.points.length >= 3 ? panel.points : fallbackPanelPoints(panel);
  const deduped = dedupeSequentialPoints(contourSource);
  if (deduped.length < 3) {
    return null;
  }

  const worldPoints = deduped.map(point => convertPointToWorld(point, offsets, scale));
  const centroid = worldPoints
    .reduce((acc, pt) => acc.add(pt.clone()), new THREE.Vector2())
    .multiplyScalar(1 / worldPoints.length);

  const shape = new THREE.Shape();
  worldPoints.forEach((pt, index) => {
    const relative = new THREE.Vector2(pt.x - centroid.x, pt.y - centroid.y);
    if (index === 0) {
      shape.moveTo(relative.x, relative.y);
    } else {
      shape.lineTo(relative.x, relative.y);
    }
  });

  const thickness = Number.isFinite(panel.thickness) ? panel.thickness : wallThickness;
  const depth = Math.max(thickness * scale, scale * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);

  const mesh = new THREE.Mesh(geometry, materials.sheathing);
  const centerZ = computePanelZ(panel, wallThickness, wallSide) * scale;
  mesh.position.set(centroid.x, centroid.y, centerZ);
  mesh.userData.kind = "sheathing";
  mesh.userData.panel = panel;
  mesh.userData.originalMaterial = materials.sheathing;
  const panelLayer = typeof panel?.layer === "string" ? panel.layer : panel.faceDirection >= 0 ? "pli" : "pla";
  mesh.userData.layer = panelLayer;
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials.sheathing : materials.sheathing;
  };
  return mesh;
}

export function createNailRowMesh(row, context) {
  const {
    materials,
    highlightMaterials,
    nailMarkerGeometry,
    scale,
    offsets,
    wallThickness,
    wallSide,
    layer: layerOverride
  } = context;
  if (!materials?.nailRow || !highlightMaterials?.nailRow || !nailMarkerGeometry) {
    return null;
  }

  const effectiveLayer = layerOverride ?? row?.layer ?? "pli";
  const faceDir = resolveLayerFaceDirection(effectiveLayer, wallSide);

  const start = convertPointToWorld(row.start, offsets, scale);
  const end = convertPointToWorld(row.end, offsets, scale);
  const length = start.distanceTo(end);
  if (length < 1e-3) {
    return null;
  }

  const rawSpacing = Number.isFinite(row.spacing) && row.spacing > 0 ? row.spacing : null;
  const spacingWorld = rawSpacing ? rawSpacing * scale : null;
  const minimumWorldSpacing = scale * 25;
  const fallbackWorldSpacing = scale * 150;
  const effectiveSpacing = spacingWorld && spacingWorld > minimumWorldSpacing ? spacingWorld : fallbackWorldSpacing;

  let nailCount = Math.max(2, Math.floor(length / Math.max(effectiveSpacing, minimumWorldSpacing)) + 1);
  const maxNails = 512;
  nailCount = Math.min(maxNails, nailCount);

  const direction = end.clone().sub(start);
  const centerZ = computeNailRowZ(wallThickness, faceDir) * scale;

  const diameterMm = Number.isFinite(row.gauge) && row.gauge > 0 ? row.gauge : 12;
  const headSizeMm = Math.max(diameterMm * 1.4, 8);
  const markerSizeWorld = headSizeMm * scale;
  const instanced = new THREE.InstancedMesh(nailMarkerGeometry, materials.nailRow, nailCount);
  instanced.frustumCulled = false;

  const step = nailCount > 1 ? length / (nailCount - 1) : 0;
  const directionUnit = direction.normalize();
  const tempMatrix = new THREE.Matrix4();
  const tempVector = new THREE.Vector3();
  const tempVector2 = new THREE.Vector3(start.x, start.y, centerZ);
  const tempVector3 = new THREE.Vector3(end.x, end.y, centerZ);
  const tempQuaternion = new THREE.Quaternion();
  const tempScale = new THREE.Vector3(markerSizeWorld, markerSizeWorld, markerSizeWorld);
  if (faceDir >= 0) {
    tempQuaternion.identity();
  } else {
    tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  }

  for (let i = 0; i < nailCount; i += 1) {
    if (nailCount === 1) {
      tempVector.copy(tempVector2).lerp(tempVector3, 0.5);
    } else if (i === nailCount - 1) {
      tempVector.copy(tempVector3);
    } else {
      tempVector.set(directionUnit.x, directionUnit.y, 0).multiplyScalar(step * i);
      tempVector.add(tempVector2);
    }
    tempMatrix.compose(tempVector, tempQuaternion, tempScale);
    instanced.setMatrixAt(i, tempMatrix);
  }
  instanced.count = nailCount;
  instanced.instanceMatrix.needsUpdate = true;

  instanced.userData.kind = "nailRow";
  instanced.userData.row = row;
  instanced.userData.originalMaterial = materials.nailRow;
  instanced.userData.length = length / scale;
  instanced.userData.nails = nailCount;
  instanced.userData.spacing = rawSpacing;
  instanced.userData.layer = effectiveLayer;
  instanced.userData.setHoverState = state => {
    instanced.material = state ? highlightMaterials.nailRow : materials.nailRow;
  };

  return instanced;
}

export function createBoyOperationMesh(operation, context) {
  const {
    materials,
    highlightMaterials,
    scale,
    offsets,
    wallThickness,
    wallSide,
    plates
  } = context;
  if (!materials?.boyOperation || !highlightMaterials?.boyOperation || !materials?.boyArrow) {
    return null;
  }
  if (!operation) {
    return null;
  }
  const x = Number.isFinite(operation.x) ? operation.x : null;
  const z = Number.isFinite(operation.z) ? operation.z : null;
  if (x === null || z === null) {
    return null;
  }

  const diameterMm = Number.isFinite(operation.diameter) ? Math.max(operation.diameter, 0.5) : 20;
  const radiusMm = diameterMm / 2;

  const thicknessMm = Number.isFinite(wallThickness) && wallThickness > 0 ? wallThickness : 90;
  const rawDepth = Number.isFinite(operation.depth) ? operation.depth : null;
  const associatedKind = typeof operation.targetKind === "string" ? operation.targetKind : null;
  const associatedRole = typeof operation.targetRole === "string" ? operation.targetRole : null;
  const associatedElement = operation.targetElement ?? null;
  const rawDirection =
    rawDepth && Math.abs(rawDepth) > 1e-6 ? Math.sign(rawDepth) : wallSide >= 0 ? 1 : -1;
  let direction = rawDirection === 0 ? 1 : rawDirection;
  // Direction is now determined solely by the sign of the depth parameter (rawDepth)
  // Removed plate-based override to respect BOY specification:
  // - Negative depth (-t) drills in -Y direction
  // - Positive depth (+t) drills in +Y direction
  const depthHasMagnitude = Number.isFinite(rawDepth) && Math.abs(rawDepth) > 1e-6;

  const metrics = computePlateMetrics(plates);
  const candidatePlate =
    associatedKind === "plate" && associatedElement
      ? associatedElement
      : resolveBoyPlate(operation, plates, direction, metrics);
  const plateHeight = Number.isFinite(candidatePlate?.height)
    ? candidatePlate.height
    : metrics.defaultHeight;
  const depthMagnitude =
    !depthHasMagnitude
      ? plateHeight
      : Math.min(Math.abs(rawDepth), plateHeight);

  const entryYmm = resolveBoyEntryY(candidatePlate, direction, metrics);
  const centerYmm = entryYmm + direction * (depthMagnitude / 2);

  const wallDir = wallSide >= 0 ? 1 : -1;
  const clampedZ = clamp(operation.z, 0, thicknessMm);
  const worldZ = (clampedZ - thicknessMm / 2) * wallDir * scale;

  const worldX = toWorldX(operation.x, offsets, scale);
  const worldY = toWorldY(centerYmm, offsets, scale);
  const radiusWorld = Math.max(radiusMm * scale, scale * 2);
  const depthWorld = Math.max(depthMagnitude * scale, scale * 2);

  const group = new THREE.Group();

  const cylinderGeometry = new THREE.CylinderGeometry(radiusWorld, radiusWorld, depthWorld, 24);
  const cylinderMesh = new THREE.Mesh(cylinderGeometry, materials.boyOperation);
  group.add(cylinderMesh);

  const arrowShaftRadius = radiusWorld * 0.08;
  const arrowConeRadius = radiusWorld * 0.3;
  const arrowConeHeight = depthWorld * 0.25;
  const arrowShaftLength = depthWorld * 0.6;

  const shaftGeometry = new THREE.CylinderGeometry(arrowShaftRadius, arrowShaftRadius, arrowShaftLength, 12);
  const shaftMesh = new THREE.Mesh(shaftGeometry, materials.boyArrow);

  const coneGeometry = new THREE.ConeGeometry(arrowConeRadius, arrowConeHeight, 12);
  const coneMesh = new THREE.Mesh(coneGeometry, materials.boyArrow);

  if (direction >= 0) {
    const shaftEndY = depthWorld / 2 - arrowConeHeight;
    shaftMesh.position.y = shaftEndY - arrowShaftLength / 2;
    coneMesh.position.y = depthWorld / 2 - arrowConeHeight / 2;
  } else {
    const shaftEndY = -(depthWorld / 2 - arrowConeHeight);
    shaftMesh.position.y = shaftEndY + arrowShaftLength / 2;
    coneMesh.position.y = -(depthWorld / 2 - arrowConeHeight / 2);
    coneMesh.rotation.x = Math.PI;
  }

  group.add(shaftMesh);
  group.add(coneMesh);

  group.position.set(worldX, worldY, worldZ);
  group.userData.kind = "boy";
  group.userData.operation = operation;
  group.userData.plate = candidatePlate ?? null;
  group.userData.targetRole = associatedRole ?? null;
  group.userData.originalMaterial = materials.boyOperation;
  group.userData.layer = "structure";
  group.userData.hoverPriority = 10;
  group.userData.setHoverState = state => {
    cylinderMesh.material = state ? highlightMaterials.boyOperation : materials.boyOperation;
    shaftMesh.material = state ? highlightMaterials.boyArrow : materials.boyArrow;
    coneMesh.material = state ? highlightMaterials.boyArrow : materials.boyArrow;
  };
  group.userData.depthInfo = {
    direction,
    depth: depthMagnitude,
    entryY: entryYmm,
    directionLabel: direction >= 0 ? "+Y" : "-Y"
  };

  return group;
}

export function createPafMeshes(routing, context) {
  const {
    materials,
    highlightMaterials,
    scale,
    offsets,
    wallThickness,
    wallSide,
    sheathingSurfaces,
    layer: layerOverride
  } = context;
  if (!materials?.pafRouting || !highlightMaterials?.pafRouting) {
    return [];
  }
  if (!routing?.segments) {
    return [];
  }
  let routingFaceDir = inferRoutingFaceDirection(routing, wallSide);
  if (layerOverride) {
    routingFaceDir = resolveLayerFaceDirection(layerOverride, wallSide);
  }
  const meshes = [];
  for (const segment of routing.segments) {
    const mesh = createPafSegmentMesh(segment, routing, {
      materials,
      highlightMaterials,
      scale,
      offsets,
      wallThickness,
      wallSide,
      sheathingSurfaces,
      routingFaceDir,
      layer: layerOverride
    });
    if (mesh) {
      meshes.push(mesh);
    }
  }
  return meshes;
}

function computePlateMetrics(plates) {
  const metrics = {
    top: null,
    bottom: null,
    defaultHeight: 45
  };
  if (!Array.isArray(plates)) {
    return metrics;
  }
  let heightSum = 0;
  let count = 0;
  for (const plate of plates) {
    if (!Number.isFinite(plate?.y)) {
      continue;
    }
    const bottom = plate.y;
    const height = Number.isFinite(plate?.height) ? plate.height : 0;
    const top = bottom + height;
    metrics.bottom = metrics.bottom === null ? bottom : Math.min(metrics.bottom, bottom);
    metrics.top = metrics.top === null ? top : Math.max(metrics.top, top);
    if (Number.isFinite(height) && height > 0) {
      heightSum += height;
      count += 1;
    }
  }
  if (count > 0) {
    metrics.defaultHeight = heightSum / count;
  }
  return metrics;
}

function resolveBoyPlate(operation, plates, direction, metrics) {
  if (!Array.isArray(plates) || plates.length === 0) {
    return null;
  }
  const x = Number.isFinite(operation?.x) ? operation.x : null;
  const tolerance = 5;
  let pool = plates;
  if (x !== null) {
    const filtered = plates.filter(plate => {
      if (!Number.isFinite(plate?.x) || !Number.isFinite(plate?.width)) {
        return false;
      }
      const minX = plate.x - tolerance;
      const maxX = plate.x + plate.width + tolerance;
      return x >= minX && x <= maxX;
    });
    if (filtered.length > 0) {
      pool = filtered;
    }
  }

  const target = direction < 0 ? metrics?.top : metrics?.bottom;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const plate of pool) {
    const bottom = Number.isFinite(plate?.y) ? plate.y : 0;
    const height = Number.isFinite(plate?.height) ? plate.height : 0;
    const top = bottom + height;
    const compareValue = direction < 0 ? top : bottom;
    const diff = target === null ? 0 : Math.abs(compareValue - target);
    let xDiff = 0;
    if (x !== null && Number.isFinite(plate?.x) && Number.isFinite(plate?.width)) {
      const minX = plate.x;
      const maxX = plate.x + plate.width;
      if (x < minX) {
        xDiff = minX - x;
      } else if (x > maxX) {
        xDiff = x - maxX;
      }
    }
    const score = diff * 10 + xDiff;
    if (score < bestScore) {
      bestScore = score;
      best = plate;
    }
  }
  return best;
}

function resolveBoyEntryY(plate, direction, metrics) {
  if (plate && Number.isFinite(plate?.y)) {
    if (direction >= 0) {
      return plate.y;
    }
    const height = Number.isFinite(plate?.height) ? plate.height : 0;
    return plate.y + height;
  }

  if (direction >= 0) {
    if (Number.isFinite(metrics?.bottom)) {
      return metrics.bottom;
    }
    if (Number.isFinite(metrics?.top)) {
      return metrics.top;
    }
    return 0;
  }

  if (Number.isFinite(metrics?.top)) {
    return metrics.top;
  }
  if (Number.isFinite(metrics?.bottom)) {
    return metrics.bottom;
  }
  return 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return Number.isFinite(min) ? min : 0;
  }
  let result = value;
  if (Number.isFinite(min) && result < min) {
    result = min;
  }
  if (Number.isFinite(max) && result > max) {
    result = max;
  }
  return result;
}

function toWorldX(value, offsets, scale) {
  const localX = value - offsets.minX;
  return (localX - offsets.width / 2) * scale;
}

function toWorldY(value, offsets, scale) {
  const localY = value - offsets.minY;
  return (localY - offsets.height / 2) * scale;
}

function convertPointToWorld(point, offsets, scale) {
  const localX = point.x - offsets.minX;
  const localY = point.y - offsets.minY;
  const worldX = (localX - offsets.width / 2) * scale;
  const worldY = (localY - offsets.height / 2) * scale;
  return new THREE.Vector2(worldX, worldY);
}

function fallbackPanelPoints(panel) {
  if (!Number.isFinite(panel.x) || !Number.isFinite(panel.y) || !Number.isFinite(panel.width) || !Number.isFinite(panel.height)) {
    return [];
  }
  return [
    { x: panel.x, y: panel.y + panel.height },
    { x: panel.x, y: panel.y },
    { x: panel.x + panel.width, y: panel.y },
    { x: panel.x + panel.width, y: panel.y + panel.height }
  ];
}

function dedupeSequentialPoints(points) {
  const result = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) {
      continue;
    }
    result.push({ x: point.x, y: point.y });
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
      result.pop();
    }
  }
  return result;
}

function computePanelZ(panel, wallThickness, wallSide = 1) {
  const thickness = Number.isFinite(panel?.thickness) ? panel.thickness : wallThickness;
  if (!Number.isFinite(thickness) || thickness <= 0) {
    return 0;
  }
  const faceDir = resolvePanelFaceDirection(panel, wallSide);
  const halfWall = wallThickness / 2;
  const flushOffset = faceDir * (halfWall - thickness / 2);
  const epsilon = 0.6;
  return flushOffset + faceDir * epsilon;
}

function computeMemberCenterZ(element, wallThickness, wallSide, depthMm) {
  const offset = Number.isFinite(element.offset) ? element.offset : null;
  const halfWall = wallThickness / 2;
  const dir = wallSide >= 0 ? 1 : -1;
  if (offset === null) {
    return 0;
  }
  const clampedOffset = Math.max(0, Math.min(offset, wallThickness));
  if (dir >= 0) {
    const interiorFace = -halfWall;
    return interiorFace + clampedOffset + depthMm / 2;
  }
  const interiorFace = halfWall;
  return interiorFace - clampedOffset - depthMm / 2;
}

function computeNailRowZ(wallThickness, faceDir) {
  const epsilon = 1.2;
  const halfWall = wallThickness / 2;
  const dir = faceDir >= 0 ? 1 : -1;
  return dir * (halfWall + epsilon);
}

function resolvePanelFaceDirection(panel, wallSide) {
  const wallDir = wallSide >= 0 ? 1 : -1;
  const panelDirRaw = Number.isFinite(panel?.faceDirection) ? panel.faceDirection : 1;
  const panelDir = panelDirRaw >= 0 ? 1 : -1;
  return wallDir * panelDir;
}

function resolveLayerFaceDirection(layer, wallSide) {
  const wallDir = wallSide >= 0 ? 1 : -1;
  if (typeof layer !== "string") {
    return wallDir;
  }
  return layer.toLowerCase() === "pla" ? -wallDir : wallDir;
}

function inferLayerFromDirection(faceDir, wallSide) {
  const pliDir = resolveLayerFaceDirection("pli", wallSide);
  const plaDir = resolveLayerFaceDirection("pla", wallSide);
  if (Math.abs(faceDir - plaDir) < 1e-6) {
    return "pla";
  }
  return "pli";
}

function resolvePafSurfaceZ(faceDir, sheathingSurfaces, wallThickness) {
  if (faceDir >= 0) {
    const positive = sheathingSurfaces?.positive;
    return Number.isFinite(positive) ? positive : faceDir * (wallThickness / 2);
  }
  const negative = sheathingSurfaces?.negative;
  return Number.isFinite(negative) ? negative : faceDir * (wallThickness / 2);
}

function inferRoutingFaceDirection(routing, wallSide) {
  const baseDir = determinePafFaceDirection(routing?.face, wallSide);
  const segments = routing?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return baseDir;
  }
  let score = 0;
  for (const segment of segments) {
    let hinted = false;
    const zValue = Number.isFinite(segment?.z) ? segment.z : null;
    if (zValue !== null && Math.abs(zValue) > 1e-3) {
      score += zValue < 0 ? 1 : -1;
      hinted = true;
    } else if (segment?.kind === "polygon" && Array.isArray(segment.points)) {
      let pointContribution = 0;
      for (const point of segment.points) {
        if (!Number.isFinite(point?.z) || Math.abs(point.z) < 1e-3) {
          continue;
        }
        pointContribution += point.z < 0 ? 1 : -1;
      }
      if (pointContribution !== 0) {
        score += pointContribution;
        hinted = true;
      }
    }
    if (!hinted && Number.isFinite(segment?.depthRaw) && Math.abs(segment.depthRaw) > 1e-6) {
      score += segment.depthRaw < 0 ? 1 : -1;
      hinted = true;
    }
    if (!hinted && Number.isFinite(segment?.offset) && Math.abs(segment.offset) > 1e-3) {
      score += segment.offset < 0 ? 1 : -1;
    }
  }
  if (score > 0) {
    return baseDir;
  }
  if (score < 0) {
    return -baseDir;
  }
  return baseDir;
}

function determinePafFaceDirection(faceValue, wallSide) {
  const baseDir = wallSide >= 0 ? 1 : -1;
  if (!Number.isFinite(faceValue)) {
    return baseDir;
  }
  const normalized = Math.round(faceValue);
  if (normalized === 0) {
    return baseDir;
  }
  if (normalized === 1) {
    return -baseDir;
  }
  if (normalized < 0) {
    return -baseDir;
  }
  return baseDir;
}

function resolvePafSegmentDepthMm(segment, wallThickness) {
  if (Number.isFinite(segment?.depth) && segment.depth > 0) {
    return Math.max(segment.depth, 0.5);
  }
  if (Number.isFinite(segment?.depthRaw)) {
    return Math.max(Math.abs(segment.depthRaw), 0.5);
  }
  return Math.min(12, wallThickness);
}

function createPafSegmentMesh(segment, routing, context) {
  const {
    materials,
    highlightMaterials,
    scale,
    offsets,
    wallThickness,
    wallSide,
    sheathingSurfaces,
    routingFaceDir,
    layer
  } = context;
  if (segment?.kind === "polygon") {
    return createPafPolygonMesh(segment, routing, {
      materials,
      highlightMaterials,
      scale,
      offsets,
      wallThickness,
      wallSide,
      sheathingSurfaces,
      routingFaceDir,
      layer
    });
  }
  if (segment?.kind === "polyline") {
    return null;
  }

  const basePoint = segment?.position ?? segment?.start;
  if (!basePoint) {
    return null;
  }

  const baseFaceDir = Number.isFinite(routingFaceDir)
    ? routingFaceDir
    : determinePafFaceDirection(routing.face, wallSide);
  const faceDir = layer ? resolveLayerFaceDirection(layer, wallSide) : baseFaceDir;
  const radiusMm = (() => {
    if (Number.isFinite(segment?.radius)) {
      return Math.max(segment.radius, 0.5);
    }
    if (Number.isFinite(segment?.toolDiameter)) {
      return Math.max(segment.toolDiameter / 2, 0.5);
    }
    return 20;
  })();
  const depthMm = resolvePafSegmentDepthMm(segment, wallThickness);

  const surfaceZMm = resolvePafSurfaceZ(faceDir, sheathingSurfaces, wallThickness);
  const tinyLift = 0.05;
  const topZMm = surfaceZMm + faceDir * tinyLift;
  const centerZMm = topZMm - faceDir * depthMm / 2;

  const worldPoint = convertPointToWorld(basePoint, offsets, scale);
  const radiusWorld = Math.max(radiusMm * scale, scale * 2);
  const depthWorld = Math.max(depthMm * scale, scale * 2);

  const geometry = new THREE.CylinderGeometry(radiusWorld, radiusWorld, depthWorld, 32);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, materials.pafRouting);
  mesh.position.set(worldPoint.x, worldPoint.y, centerZMm * scale);

  mesh.userData.kind = "paf";
  mesh.userData.routing = routing;
  mesh.userData.segment = segment;
  mesh.userData.originalMaterial = materials.pafRouting;
  const resolvedLayer = layer ?? inferLayerFromDirection(faceDir, wallSide);
  mesh.userData.layer = resolvedLayer;
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials.pafRouting : materials.pafRouting;
  };
  return mesh;
}

function createPafPolygonMesh(segment, routing, context) {
  const {
    materials,
    highlightMaterials,
    scale,
    offsets,
    wallThickness,
    wallSide,
    sheathingSurfaces,
    routingFaceDir,
    layer
  } = context;
  const points = Array.isArray(segment?.points) ? segment.points : null;
  if (!points || points.length < 3) {
    return null;
  }

  const deduped = dedupeSequentialPoints(points);
  if (deduped.length < 3) {
    return null;
  }

  const worldPoints = deduped.map(point => convertPointToWorld(point, offsets, scale));
  const centroid = worldPoints
    .reduce((acc, pt) => acc.add(pt.clone()), new THREE.Vector2())
    .multiplyScalar(1 / worldPoints.length);

  const shape = new THREE.Shape();
  const pathSegments = Array.isArray(segment?.pathSegments) ? segment.pathSegments : null;
  if (pathSegments && pathSegments.length > 0) {
    const firstSegment = pathSegments[0];
    const initialPoint = firstSegment?.from ?? deduped[0];
    const initialWorld =
      initialPoint && Number.isFinite(initialPoint.x) && Number.isFinite(initialPoint.y)
        ? convertPointToWorld(initialPoint, offsets, scale)
        : worldPoints[0];
    shape.moveTo(initialWorld.x - centroid.x, initialWorld.y - centroid.y);
    for (const pathSegment of pathSegments) {
      if (!pathSegment) {
        continue;
      }
      if (pathSegment.type === "line") {
        const target = convertPointToWorld(pathSegment.to, offsets, scale);
        shape.lineTo(target.x - centroid.x, target.y - centroid.y);
      } else if (pathSegment.type === "arc") {
        const centerWorld = convertPointToWorld(pathSegment.center, offsets, scale);
        const radiusWorld = Math.max(pathSegment.radius * scale, scale * 0.5);
        shape.absarc(
          centerWorld.x - centroid.x,
          centerWorld.y - centroid.y,
          radiusWorld,
          pathSegment.startAngle,
          pathSegment.endAngle,
          Boolean(pathSegment.clockwise)
        );
      }
    }
    shape.closePath();
  } else {
    worldPoints.forEach((pt, index) => {
      const relativeX = pt.x - centroid.x;
      const relativeY = pt.y - centroid.y;
      if (index === 0) {
        shape.moveTo(relativeX, relativeY);
      } else {
        shape.lineTo(relativeX, relativeY);
      }
    });
    shape.closePath();
  }

  const depthMm = resolvePafSegmentDepthMm(segment, wallThickness);
  const depthWorld = Math.max(depthMm * scale, scale * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depthWorld, bevelEnabled: false });
  geometry.translate(0, 0, -depthWorld / 2);

  const baseFaceDir = Number.isFinite(routingFaceDir)
    ? routingFaceDir
    : determinePafFaceDirection(routing.face, wallSide);
  const faceDir = layer ? resolveLayerFaceDirection(layer, wallSide) : baseFaceDir;
  const surfaceZMm = resolvePafSurfaceZ(faceDir, sheathingSurfaces, wallThickness);
  const tinyLift = 0.05;
  const topZMm = surfaceZMm + faceDir * tinyLift;
  const centerZMm = topZMm - faceDir * (depthMm / 2);

  const mesh = new THREE.Mesh(geometry, materials.pafRouting);
  mesh.position.set(centroid.x, centroid.y, centerZMm * scale);

  mesh.userData.kind = "paf";
  mesh.userData.routing = routing;
  mesh.userData.segment = segment;
  mesh.userData.originalMaterial = materials.pafRouting;
  const resolvedLayer = layer ?? inferLayerFromDirection(faceDir, wallSide);
  mesh.userData.layer = resolvedLayer;
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials.pafRouting : materials.pafRouting;
  };

  return mesh;
}
