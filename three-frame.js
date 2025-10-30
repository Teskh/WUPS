import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.getElementById("threeCanvas");
const tooltip = document.getElementById("threeTooltip");
if (!canvas) {
  throw new Error("threeCanvas element missing from document");
}
if (!tooltip) {
  throw new Error("threeTooltip element missing from document");
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f4f9);

const camera = new THREE.PerspectiveCamera(
  36,
  canvas.clientWidth / Math.max(canvas.clientHeight, 1),
  0.1,
  2000
);
camera.position.set(0, 0, 10);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.enableRotate = true;
controls.enablePan = true;
controls.enableZoom = true;
controls.panSpeed = 0.9;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 1.0;
controls.screenSpacePanning = true;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE
};
controls.target.set(0, 0, 0);
controls.update();

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x48505a, 0.85);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(1.5, 2.5, 3.5);
scene.add(dirLight);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

const groups = {
  framing: new THREE.Group(),
  sheathing: new THREE.Group(),
  nailRows: new THREE.Group(),
  pafRoutings: new THREE.Group()
};

modelGroup.add(groups.framing, groups.sheathing, groups.nailRows, groups.pafRoutings);

const materials = {
  stud: new THREE.MeshStandardMaterial({ color: 0x3a7bd5, metalness: 0.04, roughness: 0.62 }),
  blocking: new THREE.MeshStandardMaterial({ color: 0x16a085, metalness: 0.03, roughness: 0.58 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xf39c12, metalness: 0.08, roughness: 0.55 }),
  sheathing: new THREE.MeshStandardMaterial({
    color: 0xc49b66,
    metalness: 0.04,
    roughness: 0.78,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide
  }),
  nailRow: new THREE.MeshStandardMaterial({ color: 0xd35400, metalness: 0.12, roughness: 0.45, side: THREE.DoubleSide }),
  pafRouting: new THREE.MeshStandardMaterial({
    color: 0x8e44ad,
    metalness: 0.16,
    roughness: 0.48,
    transparent: true,
    opacity: 0.78
  })
};

const highlightMaterials = {
  stud: materials.stud.clone(),
  blocking: materials.blocking.clone(),
  plate: materials.plate.clone(),
  sheathing: materials.sheathing.clone(),
  nailRow: materials.nailRow.clone(),
  pafRouting: materials.pafRouting.clone()
};

Object.values(highlightMaterials).forEach(mat => {
  mat.emissive.setHex(0xffffff);
  mat.emissiveIntensity = 0.28;
});

function createNailMarkerGeometry() {
  const size = 1;
  const armRatio = 0.2;
  const half = size / 2;
  const barHalf = (size * armRatio) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-barHalf, half);
  shape.lineTo(barHalf, half);
  shape.lineTo(barHalf, barHalf);
  shape.lineTo(half, barHalf);
  shape.lineTo(half, -barHalf);
  shape.lineTo(barHalf, -barHalf);
  shape.lineTo(barHalf, -half);
  shape.lineTo(-barHalf, -half);
  shape.lineTo(-barHalf, -barHalf);
  shape.lineTo(-half, -barHalf);
  shape.lineTo(-half, barHalf);
  shape.lineTo(-barHalf, barHalf);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.center();
  return geometry;
}

const nailMarkerGeometry = createNailMarkerGeometry();

const tempMatrix = new THREE.Matrix4();
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempVector3 = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();

let cachedDimensions = {
  width: 1,
  height: 1,
  scale: 1,
  cameraDistance: 10
};

function clearGroup(group) {
  for (let i = group.children.length - 1; i >= 0; i -= 1) {
    const child = group.children[i];
    if (!child.isInstancedMesh && child.geometry) {
      child.geometry.dispose();
    }
    group.remove(child);
  }
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  requestRender();
}

function calculateScale(width, height) {
  const maxDim = Math.max(width, height);
  return maxDim > 0 ? 8 / maxDim : 1;
}

function createMemberMesh(element, material, scale, offsets, wallThickness, wallSide) {
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
  const kind = material === materials.stud ? "stud" : material === materials.blocking ? "blocking" : "plate";
  mesh.userData.kind = kind;
  mesh.userData.originalMaterial = material;
  mesh.userData.member = element;
  mesh.userData.setHoverState = state => {
    const targetMaterial = state ? highlightMaterials[kind] ?? material : material;
    mesh.material = targetMaterial;
  };
  return mesh;
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

function createSheathingMesh(panel, scale, offsets, wallThickness, wallSide) {
  const contourSource = panel.points && panel.points.length >= 3 ? panel.points : fallbackPanelPoints(panel);
  const deduped = dedupeSequentialPoints(contourSource);
  if (deduped.length < 3) {
    return null;
  }

  const worldPoints = deduped.map(point => convertPointToWorld(point, offsets, scale));
  const centroid = worldPoints.reduce((acc, pt) => acc.add(pt.clone()), new THREE.Vector2()).multiplyScalar(1 / worldPoints.length);

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

function computeNailRowZ(wallThickness, wallSide) {
  const epsilon = 1.2;
  const halfWall = wallThickness / 2;
  const dir = wallSide >= 0 ? 1 : -1;
  return dir * (halfWall + epsilon);
}

function createNailRowMesh(row, scale, offsets, wallThickness, wallSide) {
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
  tempVector2.set(start.x, start.y, centerZ);
  tempVector3.set(end.x, end.y, centerZ);
  if (wallSide >= 0) {
    tempQuaternion.identity();
  } else {
    tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  }
  tempScale.set(markerSizeWorld, markerSizeWorld, markerSizeWorld);

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

function createPafSegmentMesh(segment, routing, scale, offsets, wallThickness, wallSide, sheathingTopZMm) {
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
  const depthMm = (() => {
    if (Number.isFinite(segment?.depth)) {
      return Math.max(segment.depth, 0.5);
    }
    if (Number.isFinite(segment?.depthRaw)) {
      return Math.max(Math.abs(segment.depthRaw), 0.5);
    }
    return Math.min(12, wallThickness);
  })();

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

function createPafMeshes(routing, scale, offsets, wallThickness, wallSide, sheathingTopZMm) {
  if (!routing?.segments) {
    return [];
  }
  const meshes = [];
  for (const segment of routing.segments) {
    const mesh = createPafSegmentMesh(segment, routing, scale, offsets, wallThickness, wallSide, sheathingTopZMm);
    if (mesh) {
      meshes.push(mesh);
    }
  }
  return meshes;
}

function estimateSheathingTopZ(panels, wallThickness, wallSide) {
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

function adjustCamera(width, height) {
  const diag = Math.sqrt(width * width + height * height);
  const halfDiag = diag / 2 || 1;
  const distance = halfDiag / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const safeDistance = distance * 1.4 + 2;
  cachedDimensions.cameraDistance = safeDistance;

  camera.position.set(0, 0, safeDistance);
  camera.near = Math.max(safeDistance * 0.02, 0.1);
  camera.far = Math.max(safeDistance * 6, 100);
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();
  controls.saveState();
  requestRender();
}

function updateModel(model) {
  if (!model) {
    return;
  }

  const minX = model.bounds.minX;
  const minY = model.bounds.minY;
  const wallWidth = model.wall?.width ?? model.bounds.maxX - minX;
  const wallHeight = model.wall?.height ?? model.bounds.maxY - minY;
  const wallThickness = model.wall?.thickness ?? 90;
  const wallSide = Number.isFinite(model.wall?.side) ? (model.wall.side >= 0 ? 1 : -1) : 1;
  const sheathingTopZMm = estimateSheathingTopZ(model.sheathing ?? [], wallThickness, wallSide);

  const scale = calculateScale(wallWidth, wallHeight);
  cachedDimensions = {
    width: wallWidth,
    height: wallHeight,
    scale,
    cameraDistance: cachedDimensions.cameraDistance
  };

  clearHoverState();
  clearGroup(groups.framing);
  clearGroup(groups.sheathing);
  clearGroup(groups.nailRows);
  clearGroup(groups.pafRoutings);

  const offsets = { minX, minY, width: wallWidth, height: wallHeight };

  for (const plate of model.plates) {
    const mesh = createMemberMesh(plate, materials.plate, scale, offsets, wallThickness, wallSide);
    groups.framing.add(mesh);
  }

  for (const stud of model.studs) {
    const mesh = createMemberMesh(stud, materials.stud, scale, offsets, wallThickness, wallSide);
    groups.framing.add(mesh);
  }

  for (const block of model.blocking) {
    const mesh = createMemberMesh(block, materials.blocking, scale, offsets, wallThickness, wallSide);
    groups.framing.add(mesh);
  }

  for (const panel of model.sheathing ?? []) {
    const mesh = createSheathingMesh(panel, scale, offsets, wallThickness, wallSide);
    if (mesh) {
      groups.sheathing.add(mesh);
    }
  }

  for (const row of model.nailRows ?? []) {
    const mesh = createNailRowMesh(row, scale, offsets, wallThickness, wallSide);
    if (mesh) {
      groups.nailRows.add(mesh);
    }
  }

  for (const routing of model.pafRoutings ?? []) {
    const meshes = createPafMeshes(routing, scale, offsets, wallThickness, wallSide, sheathingTopZMm);
    for (const mesh of meshes) {
      groups.pafRoutings.add(mesh);
    }
  }

  adjustCamera(wallWidth * scale, wallHeight * scale);
  requestRender();
}

const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.2 };
const pointer = new THREE.Vector2();
let hoveredMesh = null;
let needsRender = true;

function requestRender() {
  needsRender = true;
}

function clearHoverState() {
  if (hoveredMesh && hoveredMesh.userData?.setHoverState) {
    hoveredMesh.userData.setHoverState(false);
  }
  hoveredMesh = null;
  tooltip.classList.remove("show");
  tooltip.textContent = "";
  canvas.style.cursor = "";
  requestRender();
}

function setHoveredObject(target) {
  if (target === hoveredMesh) {
    return;
  }
  if (hoveredMesh && hoveredMesh.userData?.setHoverState) {
    hoveredMesh.userData.setHoverState(false);
  }
  hoveredMesh = target;
  if (hoveredMesh && hoveredMesh.userData?.setHoverState) {
    hoveredMesh.userData.setHoverState(true);
    canvas.style.cursor = hoveredMesh.userData.kind ? "pointer" : "";
  } else {
    canvas.style.cursor = "";
  }
  requestRender();
}

function formatTooltipContent(object) {
  if (!object?.userData) {
    return null;
  }
  const { kind } = object.userData;
  switch (kind) {
    case "stud":
    case "blocking":
    case "plate": {
      const member = object.userData.member;
      if (!member) {
        return null;
      }
      const kindLabel = capitalize(kind);
      const depth = member.source?.[2];
      return `${kindLabel} — ${formatNumber(member.width)} × ${formatNumber(member.height)} × ${formatNumber(depth)} mm @ (${formatNumber(
        member.x
      )}, ${formatNumber(member.y)})`;
    }
    case "sheathing": {
      const panel = object.userData.panel;
      if (!panel) {
        return null;
      }
      const label = panel.material ? `Sheathing (${panel.material})` : "Sheathing";
      const dims = `${formatNumber(panel.width)} × ${formatNumber(panel.height)} × ${formatNumber(panel.thickness)} mm`;
      const originText = `@ (${formatNumber(panel.x)}, ${formatNumber(panel.y)})`;
      const offsetText = Number.isFinite(panel.offset) ? `offset ${formatNumber(panel.offset)} mm` : null;
      const rotationText = Number.isFinite(panel.rotation) ? `${formatNumber(panel.rotation)}°` : null;
      const extras = [offsetText, rotationText].filter(Boolean).join(", ");
      return extras ? `${label} — ${dims} ${originText} — ${extras}` : `${label} — ${dims} ${originText}`;
    }
    case "nailRow": {
      const row = object.userData.row;
      if (!row) {
        return null;
      }
      const span = Math.hypot(row.end.x - row.start.x, row.end.y - row.start.y);
      const nails = Number.isFinite(object.userData.nails) ? object.userData.nails : null;
      const declaredSpacing = Number.isFinite(row.spacing) ? row.spacing : null;
      const derivedSpacing = nails && nails > 1 ? span / (nails - 1) : null;
      const spacingText = declaredSpacing ?? derivedSpacing;
      const details = [`Nail row — span ${formatNumber(span)} mm`, `from (${formatNumber(row.start.x)}, ${formatNumber(row.start.y)})`];
      if (nails) {
        details.push(`${nails} nails`);
      }
      if (Number.isFinite(spacingText)) {
        const spacingLabel = declaredSpacing ? "spacing" : "spacing≈";
        details.push(`${spacingLabel} ${formatNumber(spacingText)} mm`);
      }
      if (Number.isFinite(row.gauge)) {
        details.push(`gauge ${formatNumber(row.gauge)} mm`);
      }
      return details.join(" · ");
    }
    case "paf": {
      const routing = object.userData.routing;
      const segment = object.userData.segment;
      const basePoint = segment?.position ?? segment?.start;
      if (!routing || !segment || !basePoint) {
        return null;
      }
      const toolParts = [];
      if (Number.isFinite(routing.tool)) {
        toolParts.push(`tool ${routing.tool}`);
      }
      if (Number.isFinite(routing.face)) {
        toolParts.push(`face ${routing.face}`);
      }
      if (Number.isFinite(routing.passes)) {
        toolParts.push(`${routing.passes} pass${routing.passes === 1 ? "" : "es"}`);
      }
      const radiusMm = Number.isFinite(segment.radius)
        ? segment.radius
        : Number.isFinite(segment.toolDiameter)
          ? segment.toolDiameter / 2
          : null;
      const diameterMm = Number.isFinite(radiusMm) ? radiusMm * 2 : Number.isFinite(segment.toolDiameter) ? segment.toolDiameter : null;
      const depthMm = Number.isFinite(segment.depth)
        ? segment.depth
        : Number.isFinite(segment.depthRaw)
          ? Math.abs(segment.depthRaw)
          : null;
      const detailParts = [
        `@ (${formatNumber(basePoint.x)}, ${formatNumber(basePoint.y)})`
      ];
      if (Number.isFinite(radiusMm)) {
        detailParts.push(`radius ${formatNumber(radiusMm)} mm`);
      } else if (Number.isFinite(diameterMm)) {
        detailParts.push(`Ø${formatNumber(diameterMm)} mm`);
      }
      if (Number.isFinite(depthMm)) {
        detailParts.push(`depth ${formatNumber(depthMm)} mm`);
      }
      if (Number.isFinite(segment.orientation)) {
        detailParts.push(`orientation ${formatNumber(segment.orientation)}°`);
      }
      const metaText = toolParts.length ? ` (${toolParts.join(", ")})` : "";
      return `PAF routing${metaText} — ${detailParts.join(" · ")}`;
    }
    default:
      return null;
  }
}

function handlePointerMove(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObjects(modelGroup.children, true);
  const hit = intersects.find(intersection => intersection.object?.userData?.kind)?.object ?? null;

  setHoveredObject(hit);

  if (hit && tooltip) {
    const tooltipText = formatTooltipContent(hit);
    if (!tooltipText) {
      tooltip.classList.remove("show");
      tooltip.textContent = "";
      return;
    }
    tooltip.textContent = tooltipText;
    tooltip.classList.add("show");

    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = localX + 16;
    let top = localY + 16;

    if (left + tooltipRect.width > rect.width) {
      left = rect.width - tooltipRect.width - 12;
    }
    if (top + tooltipRect.height > rect.height) {
      top = rect.height - tooltipRect.height - 12;
    }

    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${Math.max(12, top)}px`;
  } else if (tooltip) {
    tooltip.classList.remove("show");
    tooltip.textContent = "";
  }
}

function handlePointerLeave() {
  clearHoverState();
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "?";
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function animate() {
  requestAnimationFrame(animate);
  const changed = controls.update();
  if (needsRender || changed) {
    renderer.render(scene, camera);
    needsRender = false;
  }
}

animate();
resizeRenderer();

window.addEventListener("resize", () => {
  resizeRenderer();
});

canvas.addEventListener("mousemove", handlePointerMove);
canvas.addEventListener("mouseleave", handlePointerLeave);
canvas.addEventListener("contextmenu", event => {
  event.preventDefault();
});
window.addEventListener("keydown", event => {
  if (event.key === "1") {
    controls.reset();
    clearHoverState();
    requestRender();
  }
});

controls.addEventListener("change", requestRender);

const initialModel = window.__lastWupModel;
if (initialModel) {
  updateModel(initialModel.model, initialModel.label);
  resizeRenderer();
}

document.addEventListener("wup:model", event => {
  updateModel(event.detail.model, event.detail.label);
  resizeRenderer();
});
