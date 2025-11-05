import * as THREE from "three";
import {
  computeCutoutFootprint,
  DEFAULT_TOOL_RADIUS,
  extractControlCode,
  parseControlCode,
  resolveFootprintAdjustment
} from "../utils/paf-control.js";

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
    sheathingSurfaces,
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
  const centerZ = computeNailRowZ(wallThickness, faceDir, sheathingSurfaces) * scale;

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
  instanced.userData.editorId = row?.__editorId ?? null;
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
  group.userData.editorId = operation?.__editorId ?? null;
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
  const epsilon = 0.6;
  if (Number.isFinite(panel?.offset)) {
    const wallDir = wallSide >= 0 ? 1 : -1;
    const centerGlobal = panel.offset + thickness / 2;
    const centerRelative = (centerGlobal - wallThickness / 2) * wallDir;
    return centerRelative + faceDir * epsilon;
  }
  const halfWall = wallThickness / 2;
  const flushOffset = faceDir * (halfWall - thickness / 2);
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

function computeNailRowZ(wallThickness, faceDir, sheathingSurfaces) {
  const epsilon = 1.2;
  let surfaceZ = resolvePafSurfaceZ(faceDir, sheathingSurfaces, wallThickness);
  if (!Number.isFinite(surfaceZ)) {
    const halfWall = wallThickness / 2;
    const dir = faceDir >= 0 ? 1 : -1;
    surfaceZ = dir * halfWall;
  }
  const dir = faceDir >= 0 ? 1 : -1;
  return surfaceZ + dir * epsilon;
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

function isFinitePoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function pointsApproximatelyEqual(a, b, tolerance = 1e-6) {
  if (!isFinitePoint(a) || !isFinitePoint(b)) {
    return false;
  }
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function isPathClosed(points, tolerance = 1e-6) {
  if (!Array.isArray(points) || points.length < 3) {
    return false;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return false;
  }
  return (
    Number.isFinite(first.x) &&
    Number.isFinite(first.y) &&
    Number.isFinite(last.x) &&
    Number.isFinite(last.y) &&
    Math.abs(first.x - last.x) <= tolerance &&
    Math.abs(first.y - last.y) <= tolerance
  );
}

function extractSegmentEndpoint(segment, keys) {
  if (!segment) {
    return null;
  }
  for (const key of keys) {
    if (segment[key] && isFinitePoint(segment[key])) {
      return segment[key];
    }
  }
  return null;
}

function pathSegmentsCloseLoop(pathSegments, tolerance = 1e-6) {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) {
    return false;
  }
  const firstSegment = pathSegments.find(seg => extractSegmentEndpoint(seg, ["from", "start", "position"]));
  const lastSegment = [...pathSegments]
    .reverse()
    .find(seg => extractSegmentEndpoint(seg, ["to", "end", "position"]));
  if (!firstSegment || !lastSegment) {
    return false;
  }
  const startPoint = extractSegmentEndpoint(firstSegment, ["from", "start", "position"]);
  const endPoint = extractSegmentEndpoint(lastSegment, ["to", "end", "position"]);
  if (!startPoint || !endPoint) {
    return false;
  }
  return pointsApproximatelyEqual(startPoint, endPoint, tolerance);
}

function computePolygonWindingOrder(points) {
  // Use the shoelace formula to determine polygon winding order
  // Positive area = counter-clockwise, Negative area = clockwise
  if (!Array.isArray(points) || points.length < 3) {
    return 0;
  }

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const next = points[(i + 1) % n];
    area += (next.x - curr.x) * (next.y + curr.y);
  }

  return Math.sign(area);
}

function resolvePolygonClosure(segment, dedupedPoints, pathSegments) {
  if (!segment) {
    return false;
  }
  if (isPathClosed(segment.points)) {
    return true;
  }
  if (Array.isArray(dedupedPoints) && dedupedPoints.length >= 3) {
    const first = dedupedPoints[0];
    const last = dedupedPoints[dedupedPoints.length - 1];
    if (pointsApproximatelyEqual(first, last)) {
      return true;
    }
  }
  if (pathSegmentsCloseLoop(pathSegments)) {
    return true;
  }
  return false;
}

function offsetPolygonPoints(points, offsetDistance, options = {}) {
  const { closed = true } = options;
  if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(offsetDistance)) {
    return points;
  }

  // Detect polygon winding order
  // For counter-clockwise polygons, positive offset = outward
  // For clockwise polygons, positive offset = inward, so we need to negate it
  const windingOrder = computePolygonWindingOrder(points);
  const adjustedOffset = windingOrder < 0 ? -offsetDistance : offsetDistance;

  const offsetPoints = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const prev = closed ? points[(i - 1 + n) % n] : points[i - 1];
    const curr = points[i];
    const next = closed ? points[(i + 1) % n] : points[i + 1];

    if ((!prev || !next) && !closed) {
      // Endpoints of an open path - offset using the available segment normal
      const dirX = prev ? curr.x - prev.x : next.x - curr.x;
      const dirY = prev ? curr.y - prev.y : next.y - curr.y;
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-6) {
        offsetPoints.push({ x: curr.x, y: curr.y });
        continue;
      }
      const unitX = dirX / len;
      const unitY = dirY / len;
      const perpX = -unitY;
      const perpY = unitX;
      offsetPoints.push({
        x: curr.x + perpX * adjustedOffset,
        y: curr.y + perpY * adjustedOffset
      });
      continue;
    }

    // Calculate edge vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    // Normalize edge vectors
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 < 1e-6 || len2 < 1e-6) {
      offsetPoints.push({ x: curr.x, y: curr.y });
      continue;
    }

    const n1x = v1x / len1;
    const n1y = v1y / len1;
    const n2x = v2x / len2;
    const n2y = v2y / len2;

    // Calculate perpendicular normals (outward for CCW polygons)
    const perp1x = -n1y;
    const perp1y = n1x;
    const perp2x = -n2y;
    const perp2y = n2x;

    // Calculate bisector (average of perpendiculars)
    let bisectorX = perp1x + perp2x;
    let bisectorY = perp1y + perp2y;
    const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY);

    if (bisectorLen < 1e-6) {
      // Edges are parallel, use perpendicular
      offsetPoints.push({
        x: curr.x + perp1x * adjustedOffset,
        y: curr.y + perp1y * adjustedOffset
      });
      continue;
    }

    bisectorX /= bisectorLen;
    bisectorY /= bisectorLen;

    // Calculate the offset distance along the bisector
    // The angle between the bisector and the perpendicular determines the actual distance
    const dotProduct = bisectorX * perp1x + bisectorY * perp1y;
    const actualOffset = dotProduct > 1e-6 ? adjustedOffset / dotProduct : adjustedOffset;

    // Clamp excessive offsets for very sharp angles
    const clampedOffset = Math.min(Math.abs(actualOffset), Math.abs(adjustedOffset) * 10) * Math.sign(actualOffset);

    offsetPoints.push({
      x: curr.x + bisectorX * clampedOffset,
      y: curr.y + bisectorY * clampedOffset
    });
  }

  return offsetPoints;
}

function buildCornerArtifacts(points, offsets, scale, zPosition, controlInfo, isClosedPath, materials) {
  if (!Array.isArray(points) || points.length < 2 || !materials) {
    return [];
  }

  const toolRadius = DEFAULT_TOOL_RADIUS;
  if (!Number.isFinite(toolRadius) || toolRadius <= 0) {
    return [];
  }

  const artifacts = [];
  const totalPoints = points.length;
  const startIndex = isClosedPath ? 0 : 1;
  const endIndex = isClosedPath ? totalPoints : totalPoints - 1;

  const radiusMode = controlInfo?.hasOvercut ? "relief" : "radius";

  if (radiusMode === "radius") {
    const centers = offsetPolygonPoints(points, -toolRadius, { closed: isClosedPath });
    if (!Array.isArray(centers) || centers.length !== totalPoints) {
      return artifacts;
    }

    const arcPoints = [];

    for (let i = startIndex; i < endIndex; i += 1) {
      const prevIndex = (i - 1 + totalPoints) % totalPoints;
      const nextIndex = (i + 1) % totalPoints;

      if (!isClosedPath && (i <= 0 || i >= totalPoints - 1)) {
        continue;
      }

      const prev = points[prevIndex];
      const curr = points[i];
      const next = points[nextIndex];
      const center = centers[i];

      if (!isFinitePoint(prev) || !isFinitePoint(curr) || !isFinitePoint(next) || !isFinitePoint(center)) {
        continue;
      }

      const incoming = new THREE.Vector2(curr.x - prev.x, curr.y - prev.y);
      const outgoing = new THREE.Vector2(next.x - curr.x, next.y - curr.y);
      const lenIn = incoming.length();
      const lenOut = outgoing.length();
      if (lenIn < 1e-3 || lenOut < 1e-3) {
        continue;
      }

      const incomingDir = incoming.clone().normalize();
      const outgoingDir = outgoing.clone().normalize();

      const tangentInDistance = incomingDir.dot(new THREE.Vector2(center.x - prev.x, center.y - prev.y));
      const tangentOutDistance = outgoingDir.dot(new THREE.Vector2(center.x - curr.x, center.y - curr.y));

      if (!Number.isFinite(tangentInDistance) || !Number.isFinite(tangentOutDistance)) {
        continue;
      }

      const epsilon = 1e-4;
      if (
        tangentInDistance <= epsilon ||
        tangentInDistance >= lenIn - epsilon ||
        tangentOutDistance <= epsilon ||
        tangentOutDistance >= lenOut - epsilon
      ) {
        continue;
      }

      const tangentIn = new THREE.Vector2(prev.x, prev.y).add(incomingDir.clone().multiplyScalar(tangentInDistance));
      const tangentOut = new THREE.Vector2(curr.x, curr.y).add(outgoingDir.clone().multiplyScalar(tangentOutDistance));

      const startVec = new THREE.Vector2(tangentIn.x - center.x, tangentIn.y - center.y);
      const endVec = new THREE.Vector2(tangentOut.x - center.x, tangentOut.y - center.y);
      const startLen = startVec.length();
      const endLen = endVec.length();
      if (startLen < 1e-3 || endLen < 1e-3) {
        continue;
      }

      const startAngle = Math.atan2(startVec.y, startVec.x);
      const endAngle = Math.atan2(endVec.y, endVec.x);
      let sweep = endAngle - startAngle;
      const cross = startVec.x * endVec.y - startVec.y * endVec.x;
      if (cross >= 0) {
        if (sweep < 0) {
          sweep += Math.PI * 2;
        }
      } else if (cross < 0) {
        if (sweep > 0) {
          sweep -= Math.PI * 2;
        }
      }

      if (!Number.isFinite(sweep) || Math.abs(sweep) < 1e-3) {
        continue;
      }

      const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
      for (let step = 0; step < steps; step += 1) {
        const angle1 = startAngle + (sweep * step) / steps;
        const angle2 = startAngle + (sweep * (step + 1)) / steps;
        const arcPoint1 = {
          x: center.x + Math.cos(angle1) * toolRadius,
          y: center.y + Math.sin(angle1) * toolRadius
        };
        const arcPoint2 = {
          x: center.x + Math.cos(angle2) * toolRadius,
          y: center.y + Math.sin(angle2) * toolRadius
        };

        const world1 = convertPointToWorld(arcPoint1, offsets, scale);
        const world2 = convertPointToWorld(arcPoint2, offsets, scale);
        if (!world1 || !world2 || world1.distanceTo(world2) < 1e-6) {
          continue;
        }

        arcPoints.push(new THREE.Vector3(world1.x, world1.y, zPosition));
        arcPoints.push(new THREE.Vector3(world2.x, world2.y, zPosition));
      }
    }

    if (arcPoints.length > 0 && materials.pafCornerRadiusLine) {
      const geometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
      const arcLine = new THREE.LineSegments(geometry, materials.pafCornerRadiusLine);
      arcLine.userData = { cornerArtifact: "radius" };
      artifacts.push(arcLine);
    }
  } else {
    const reliefPoints = [];

    for (let i = startIndex; i < endIndex; i += 1) {
      const prevIndex = (i - 1 + totalPoints) % totalPoints;
      const nextIndex = (i + 1) % totalPoints;

      if (!isClosedPath && (i <= 0 || i >= totalPoints)) {
        continue;
      }

      const prev = points[prevIndex];
      const curr = points[i];
      const next = points[nextIndex];
      if (!isFinitePoint(prev) || !isFinitePoint(curr) || !isFinitePoint(next)) {
        continue;
      }

      const incoming = new THREE.Vector2(curr.x - prev.x, curr.y - prev.y);
      const outgoing = new THREE.Vector2(next.x - curr.x, next.y - curr.y);
      const lenIn = incoming.length();
      const lenOut = outgoing.length();
      if (lenIn < 1e-3 || lenOut < 1e-3) {
        continue;
      }

      const turnMagnitude = Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x);
      if (turnMagnitude < 1e-4) {
        continue;
      }

      const incomingDir = incoming.clone().normalize();
      const extensionPoint = {
        x: curr.x + incomingDir.x * toolRadius,
        y: curr.y + incomingDir.y * toolRadius
      };

      const worldStart = convertPointToWorld(curr, offsets, scale);
      const worldEnd = convertPointToWorld(extensionPoint, offsets, scale);
      if (!worldStart || !worldEnd || worldStart.distanceTo(worldEnd) < 1e-6) {
        continue;
      }

      reliefPoints.push(new THREE.Vector3(worldStart.x, worldStart.y, zPosition));
      reliefPoints.push(new THREE.Vector3(worldEnd.x, worldEnd.y, zPosition));
    }

    if (reliefPoints.length > 0 && materials.pafCornerReliefLine) {
      const geometry = new THREE.BufferGeometry().setFromPoints(reliefPoints);
      const reliefLine = new THREE.LineSegments(geometry, materials.pafCornerReliefLine);
      reliefLine.userData = { cornerArtifact: "relief" };
      artifacts.push(reliefLine);
    }
  }

  return artifacts;
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
  mesh.userData.editorId = routing?.__editorId ?? null;
  mesh.userData.originalMaterial = materials.pafRouting;
  const controlCode = extractControlCode(segment);
  const controlInfo = parseControlCode(controlCode);
  const adjustment = resolveFootprintAdjustment(controlInfo, DEFAULT_TOOL_RADIUS);
  mesh.userData.controlCode = controlCode;
  mesh.userData.controlInfo = controlInfo;
  mesh.userData.footprintAdjustment = adjustment;
  mesh.userData.assumedToolRadius = adjustment?.applied ? DEFAULT_TOOL_RADIUS : null;
  if (segment?.radius) {
    const baseDiameter = Math.abs(segment.radius) * 2;
    mesh.userData.cutoutFootprint = {
      baseWidth: baseDiameter,
      baseHeight: baseDiameter,
      expansion: adjustment?.expansion ?? 0,
      width: baseDiameter + (adjustment?.expansion ?? 0),
      height: baseDiameter + (adjustment?.expansion ?? 0),
      adjustment
    };
  }

  const resolvedLayer = layer ?? inferLayerFromDirection(faceDir, wallSide);
  mesh.userData.layer = resolvedLayer;
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials.pafRouting : materials.pafRouting;
  };

  // Create overcutting visualization if applicable
  if (adjustment?.applied && adjustment.expansion > 0) {
    const group = new THREE.Group();
    group.add(mesh);

    const expansionMm = adjustment.expansion / 2; // expansion per side
    const overcutRadiusMm = radiusMm + expansionMm;
    const overcutRadiusWorld = overcutRadiusMm * scale;

    // Create a thin outline cylinder at the same depth
    const overcutGeometry = new THREE.CylinderGeometry(
      overcutRadiusWorld,
      overcutRadiusWorld,
      depthWorld,
      32
    );
    overcutGeometry.rotateX(Math.PI / 2);
    const overcutMesh = new THREE.Mesh(overcutGeometry, materials.pafOvercutting);
    overcutMesh.position.set(worldPoint.x, worldPoint.y, centerZMm * scale);

    group.add(overcutMesh);
    group.position.set(0, 0, 0);

    // Transfer userData to group
    group.userData = { ...mesh.userData };
    group.userData.setHoverState = state => {
      mesh.material = state ? highlightMaterials.pafRouting : materials.pafRouting;
      overcutMesh.material = state ? highlightMaterials.pafOvercutting : materials.pafOvercutting;
    };

    return group;
  }

  return mesh;
}

/**
 * Creates a line-based representation of a polygon PAF path
 * @param {Array} worldPoints - Points in world coordinates
 * @param {Array} pathSegments - Arc and line segment descriptors
 * @param {Object} offsets - Coordinate offsets
 * @param {Number} scale - World scale
 * @param {Number} zPosition - Z coordinate for the line
 * @param {Boolean} closePath - Whether to close the path (default true)
 * @returns {THREE.BufferGeometry} Line geometry
 */
function createPafPathLineGeometry(worldPoints, pathSegments, offsets, scale, zPosition, closePath = true) {
  const points3D = [];

  if (pathSegments && pathSegments.length > 0) {
    // Build path from segments (lines and arcs)
    for (const pathSegment of pathSegments) {
      if (!pathSegment) continue;

      if (pathSegment.type === "line") {
        const from = convertPointToWorld(pathSegment.from, offsets, scale);
        const to = convertPointToWorld(pathSegment.to, offsets, scale);
        points3D.push(new THREE.Vector3(from.x, from.y, zPosition));
        points3D.push(new THREE.Vector3(to.x, to.y, zPosition));
      } else if (pathSegment.type === "arc") {
        const center = convertPointToWorld(pathSegment.center, offsets, scale);
        const radius = pathSegment.radius * scale;
        const startAngle = pathSegment.startAngle;

        // Use signedSweep if available, otherwise compute from angles and direction
        let sweepAngle;
        if (Number.isFinite(pathSegment.signedSweep)) {
          sweepAngle = pathSegment.signedSweep;
        } else {
          // Fallback: compute sweep with proper angle wrapping
          const endAngle = pathSegment.endAngle;
          const clockwise = pathSegment.clockwise;
          const twoPi = Math.PI * 2;

          if (clockwise) {
            // Clockwise: go from startAngle to endAngle in negative direction
            let sweep = startAngle - endAngle;
            while (sweep <= 0) sweep += twoPi;
            sweepAngle = -sweep;
          } else {
            // Counter-clockwise: go from startAngle to endAngle in positive direction
            let sweep = endAngle - startAngle;
            while (sweep <= 0) sweep += twoPi;
            sweepAngle = sweep;
          }
        }

        // Generate points along the arc as line segment pairs
        const arcSegments = 32;
        const angleStep = sweepAngle / arcSegments;

        // Create line segments between consecutive arc points
        for (let i = 0; i < arcSegments; i++) {
          const angle1 = startAngle + i * angleStep;
          const angle2 = startAngle + (i + 1) * angleStep;
          const x1 = center.x + radius * Math.cos(angle1);
          const y1 = center.y + radius * Math.sin(angle1);
          const x2 = center.x + radius * Math.cos(angle2);
          const y2 = center.y + radius * Math.sin(angle2);
          points3D.push(new THREE.Vector3(x1, y1, zPosition));
          points3D.push(new THREE.Vector3(x2, y2, zPosition));
        }
      }
    }
    // Note: Path closing is handled by the pathSegments forming a closed loop
  } else {
    // Simple polygon without arcs - create line segments between consecutive points
    const numSegments = closePath ? worldPoints.length : worldPoints.length - 1;
    for (let i = 0; i < numSegments; i++) {
      const pt1 = worldPoints[i];
      const pt2 = closePath
        ? worldPoints[(i + 1) % worldPoints.length]  // Wrap around to close the path
        : worldPoints[i + 1];                         // Don't wrap, leave path open
      points3D.push(new THREE.Vector3(pt1.x, pt1.y, zPosition));
      points3D.push(new THREE.Vector3(pt2.x, pt2.y, zPosition));
    }
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points3D);
  return geometry;
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
  const pathSegments = Array.isArray(segment?.pathSegments) ? segment.pathSegments : null;
  const isClosedPath = resolvePolygonClosure(segment, deduped, pathSegments);

  const worldPoints = deduped.map(point => convertPointToWorld(point, offsets, scale));
  const centroid = worldPoints
    .reduce((acc, pt) => acc.add(pt.clone()), new THREE.Vector2())
    .multiplyScalar(1 / worldPoints.length);

  const shape = new THREE.Shape();
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

  const baseFaceDir = Number.isFinite(routingFaceDir)
    ? routingFaceDir
    : determinePafFaceDirection(routing.face, wallSide);
  const faceDir = layer ? resolveLayerFaceDirection(layer, wallSide) : baseFaceDir;
  const surfaceZMm = resolvePafSurfaceZ(faceDir, sheathingSurfaces, wallThickness);
  const tinyLift = 0.5; // Increased lift to make lines more visible above surface
  const lineZMm = surfaceZMm + faceDir * tinyLift;
  const lineZ = lineZMm * scale;

  // Parse control code to determine rendering style
  const controlCode = extractControlCode(segment);
  const controlInfo = parseControlCode(controlCode);
  const adjustment = resolveFootprintAdjustment(controlInfo, DEFAULT_TOOL_RADIUS, { points: deduped });

  // Determine which material to use based on edge mode (tens digit)
  const edgeMode = controlInfo?.edgeMode?.code ?? 0;
  const isUndercut = edgeMode === 2;
  const baseMaterial = isUndercut ? materials.pafRoutingLineDashed : materials.pafRoutingLine;
  const highlightMaterial = isUndercut ? highlightMaterials.pafRoutingLineDashed : highlightMaterials.pafRoutingLine;

  // Create main path line geometry
  const geometry = createPafPathLineGeometry(worldPoints, pathSegments, offsets, scale, lineZ, isClosedPath);

  const line = new THREE.LineSegments(geometry, baseMaterial);

  const cornerArtifacts = buildCornerArtifacts(
    deduped,
    offsets,
    scale,
    lineZ,
    controlInfo,
    isClosedPath,
    materials
  );

  // For dashed lines, we need to compute line distances
  if (isUndercut) {
    line.computeLineDistances();
  }

  line.userData.kind = "paf";
  line.userData.routing = routing;
  line.userData.segment = segment;
  line.userData.editorId = routing?.__editorId ?? null;
  line.userData.originalMaterial = baseMaterial;
  line.userData.controlCode = controlCode;
  line.userData.controlInfo = controlInfo;
  line.userData.footprintAdjustment = adjustment;
  line.userData.assumedToolRadius = adjustment?.applied ? DEFAULT_TOOL_RADIUS : null;
  const footprint = computeCutoutFootprint(segment.points, controlInfo, DEFAULT_TOOL_RADIUS, {
    adjustment
  });
  if (footprint) {
    line.userData.cutoutFootprint = footprint;
  }
  const resolvedLayer = layer ?? inferLayerFromDirection(faceDir, wallSide);
  line.userData.layer = resolvedLayer;
  line.userData.setHoverState = state => {
    line.material = state ? highlightMaterial : baseMaterial;
  };

  // Create overcutting visualization if applicable
  if (adjustment?.applied && adjustment.expansion > 0) {
    const group = new THREE.Group();
    group.add(line);

    const expansionMm = adjustment.expansion / 2; // expansion per side
    const offsetPoints = offsetPolygonPoints(deduped, expansionMm, { closed: isClosedPath });
    const cleanedOffsetPoints = Array.isArray(offsetPoints) ? dedupeSequentialPoints(offsetPoints) : null;

    if (cleanedOffsetPoints && cleanedOffsetPoints.length >= 3) {
      const offsetWorldPoints = cleanedOffsetPoints.map(point => convertPointToWorld(point, offsets, scale));

      // Build expanded path segments and skip zero-length spans; optionally close loop for closed paths
      const expandedPoints3D = [];
      const segmentCount = isClosedPath ? offsetWorldPoints.length : offsetWorldPoints.length - 1;
      for (let i = 0; i < segmentCount; i += 1) {
        const pt1 = offsetWorldPoints[i];
        const nextIndex = isClosedPath ? (i + 1) % offsetWorldPoints.length : i + 1;
        if (!isClosedPath && nextIndex >= offsetWorldPoints.length) {
          continue;
        }
        const pt2 = offsetWorldPoints[nextIndex];
        if (pt1.distanceTo(pt2) < 1e-6) {
          continue;
        }
        expandedPoints3D.push(new THREE.Vector3(pt1.x, pt1.y, lineZ));
        expandedPoints3D.push(new THREE.Vector3(pt2.x, pt2.y, lineZ));
      }

      if (expandedPoints3D.length > 0) {
        const expandedGeometry = new THREE.BufferGeometry().setFromPoints(expandedPoints3D);
        const expandedLine = new THREE.LineSegments(expandedGeometry, materials.pafOvercuttingLine);
        expandedLine.userData = { overlayRole: "overcutOutline" };
        group.add(expandedLine);
      }
    }

    if (cornerArtifacts.length > 0) {
      cornerArtifacts.forEach(artifact => {
        if (artifact) {
          group.add(artifact);
        }
      });
    }

    group.position.set(0, 0, 0);

    // Transfer userData to group
    group.userData = { ...line.userData };
    group.userData.setHoverState = state => {
      line.material = state ? highlightMaterial : baseMaterial;
      for (const child of group.children) {
        if (child.userData?.overlayRole === "overcutOutline") {
          if (materials.pafOvercuttingLine && highlightMaterials.pafOvercuttingLine) {
            child.material = state ? highlightMaterials.pafOvercuttingLine : materials.pafOvercuttingLine;
          }
        } else if (child.userData?.cornerArtifact === "radius") {
          if (materials.pafCornerRadiusLine && highlightMaterials.pafCornerRadiusLine) {
            child.material = state ? highlightMaterials.pafCornerRadiusLine : materials.pafCornerRadiusLine;
          }
        } else if (child.userData?.cornerArtifact === "relief") {
          if (materials.pafCornerReliefLine && highlightMaterials.pafCornerReliefLine) {
            child.material = state ? highlightMaterials.pafCornerReliefLine : materials.pafCornerReliefLine;
          }
        }
      }
    };

    return group;
  }

  if (cornerArtifacts.length > 0) {
    const group = new THREE.Group();
    group.add(line);
    cornerArtifacts.forEach(artifact => {
      if (artifact) {
        group.add(artifact);
      }
    });
    group.position.set(0, 0, 0);

    group.userData = { ...line.userData };
    group.userData.setHoverState = state => {
      line.material = state ? highlightMaterial : baseMaterial;
      for (const child of group.children) {
        if (child.userData?.cornerArtifact === "radius") {
          if (materials.pafCornerRadiusLine && highlightMaterials.pafCornerRadiusLine) {
            child.material = state ? highlightMaterials.pafCornerRadiusLine : materials.pafCornerRadiusLine;
          }
        } else if (child.userData?.cornerArtifact === "relief") {
          if (materials.pafCornerReliefLine && highlightMaterials.pafCornerReliefLine) {
            child.material = state ? highlightMaterials.pafCornerReliefLine : materials.pafCornerReliefLine;
          }
        }
      }
    };

    return group;
  }

  return line;
}
