import * as THREE from "three";

export function calculateScale(width, height) {
  const maxDim = Math.max(width, height);
  return maxDim > 0 ? 8 / maxDim : 1;
}

export function estimateSheathingTopZ(panels, wallThickness, wallSide) {
  const faceDir = wallSide >= 0 ? 1 : -1;
  if (!Array.isArray(panels) || panels.length === 0) {
    const epsilon = 0.6;
    return faceDir * (wallThickness / 2 + epsilon);
  }
  let extremum = null;
  for (const panel of panels) {
    const thickness = Number.isFinite(panel?.thickness) ? panel.thickness : wallThickness;
    const centerZ = computePanelZ(panel, wallThickness, wallSide);
    if (!Number.isFinite(centerZ)) {
      continue;
    }
    const top = centerZ + faceDir * (thickness / 2);
    if (!Number.isFinite(top)) {
      continue;
    }
    if (extremum === null) {
      extremum = top;
    } else if (faceDir >= 0) {
      extremum = Math.max(extremum, top);
    } else {
      extremum = Math.min(extremum, top);
    }
  }
  if (extremum === null) {
    const epsilon = 0.6;
    return faceDir * (wallThickness / 2 + epsilon);
  }
  return extremum;
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
  const centerY = (height / 2 - (localY + element.height / 2)) * scale;

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
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials.sheathing : materials.sheathing;
  };
  return mesh;
}

export function createNailRowMesh(row, context) {
  const { materials, highlightMaterials, nailMarkerGeometry, scale, offsets, wallThickness, wallSide } = context;
  if (!materials?.nailRow || !highlightMaterials?.nailRow || !nailMarkerGeometry) {
    return null;
  }

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
  const centerZ = computeNailRowZ(wallThickness, wallSide) * scale;

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

  if (wallSide >= 0) {
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
  instanced.userData.setHoverState = state => {
    instanced.material = state ? highlightMaterials.nailRow : materials.nailRow;
  };

  return instanced;
}

export function createPafMeshes(routing, context) {
  const {
    materials,
    highlightMaterials,
    scale,
    offsets,
    wallThickness,
    wallSide,
    sheathingTopZMm
  } = context;
  if (!materials?.pafRouting || !highlightMaterials?.pafRouting) {
    return [];
  }
  if (!routing?.segments) {
    return [];
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
      sheathingTopZMm
    });
    if (mesh) {
      meshes.push(mesh);
    }
  }
  return meshes;
}

function convertPointToWorld(point, offsets, scale) {
  const localX = point.x - offsets.minX;
  const localY = point.y - offsets.minY;
  const worldX = (localX - offsets.width / 2) * scale;
  const worldY = (offsets.height / 2 - localY) * scale;
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
  const thickness = Number.isFinite(panel.thickness) ? panel.thickness : wallThickness;
  const faceDir = wallSide >= 0 ? 1 : -1;
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

function computeNailRowZ(wallThickness, wallSide) {
  const epsilon = 1.2;
  const halfWall = wallThickness / 2;
  const dir = wallSide >= 0 ? 1 : -1;
  return dir * (halfWall + epsilon);
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
  const { materials, highlightMaterials, scale, offsets, wallThickness, wallSide, sheathingTopZMm } = context;
  if (segment?.kind === "polygon") {
    return createPafPolygonMesh(segment, routing, context);
  }
  if (segment?.kind === "polyline") {
    return null;
  }

  const basePoint = segment?.position ?? segment?.start;
  if (!basePoint) {
    return null;
  }

  const faceDir = determinePafFaceDirection(routing.face, wallSide);
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

  const surfaceZMm = Number.isFinite(sheathingTopZMm)
    ? sheathingTopZMm
    : faceDir * (wallThickness / 2);
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
    sheathingTopZMm
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

  const depthMm = resolvePafSegmentDepthMm(segment, wallThickness);
  const depthWorld = Math.max(depthMm * scale, scale * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depthWorld, bevelEnabled: false });
  geometry.translate(0, 0, -depthWorld / 2);

  const faceDir = determinePafFaceDirection(routing.face, wallSide);
  const surfaceZMm = Number.isFinite(sheathingTopZMm)
    ? sheathingTopZMm
    : faceDir * (wallThickness / 2);
  const tinyLift = 0.05;
  const topZMm = surfaceZMm + faceDir * tinyLift;
  const centerZMm = topZMm - faceDir * (depthMm / 2);

  const mesh = new THREE.Mesh(geometry, materials.pafRouting);
  mesh.position.set(centroid.x, centroid.y, centerZMm * scale);

  mesh.userData.kind = "paf";
  mesh.userData.routing = routing;
  mesh.userData.segment = segment;
  mesh.userData.originalMaterial = materials.pafRouting;
  mesh.userData.setHoverState = state => {
    mesh.material = state ? highlightMaterials.pafRouting : materials.pafRouting;
  };

  return mesh;
}
