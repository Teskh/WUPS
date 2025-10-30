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

const frameGroup = new THREE.Group();
scene.add(frameGroup);

const materials = {
  stud: new THREE.MeshStandardMaterial({ color: 0x3a7bd5, metalness: 0.04, roughness: 0.62 }),
  blocking: new THREE.MeshStandardMaterial({ color: 0x16a085, metalness: 0.03, roughness: 0.58 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xf39c12, metalness: 0.08, roughness: 0.55 })
};

const highlightMaterials = {
  stud: materials.stud.clone(),
  blocking: materials.blocking.clone(),
  plate: materials.plate.clone()
};

Object.values(highlightMaterials).forEach(mat => {
  mat.emissive.setHex(0xffffff);
  mat.emissiveIntensity = 0.28;
});

let cachedDimensions = {
  width: 1,
  height: 1,
  scale: 1,
  cameraDistance: 10
};

function clearFrameGroup() {
  for (let i = frameGroup.children.length - 1; i >= 0; i -= 1) {
    const child = frameGroup.children[i];
    if (child.geometry) {
      child.geometry.dispose();
    }
    frameGroup.remove(child);
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

function createMemberMesh(element, material, scale, offsets, wallThickness) {
  const { minX, minY, width, height } = offsets;

  const localX = element.x - minX;
  const localY = element.y - minY;
  const centerX = (localX + element.width / 2 - width / 2) * scale;
  const centerY = (height / 2 - (localY + element.height / 2)) * scale;

  const depthSource = element.source?.[2];
  const depth = (Number.isFinite(depthSource) ? depthSource : wallThickness) * scale;

  const geometry = new THREE.BoxGeometry(
    Math.max(element.width * scale, scale * 2),
    Math.max(element.height * scale, scale * 2),
    Math.max(depth, scale * 6)
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(centerX, centerY, 0);
  mesh.userData.kind = material === materials.stud ? "stud" : material === materials.blocking ? "blocking" : "plate";
  mesh.userData.originalMaterial = material;
  mesh.userData.member = element;
  return mesh;
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

  const scale = calculateScale(wallWidth, wallHeight);
  cachedDimensions = {
    width: wallWidth,
    height: wallHeight,
    scale,
    cameraDistance: cachedDimensions.cameraDistance
  };

  clearFrameGroup();

  const offsets = { minX, minY, width: wallWidth, height: wallHeight };

  for (const plate of model.plates) {
    frameGroup.add(createMemberMesh(plate, materials.plate, scale, offsets, wallThickness));
  }

  for (const stud of model.studs) {
    frameGroup.add(createMemberMesh(stud, materials.stud, scale, offsets, wallThickness));
  }

  for (const block of model.blocking) {
    frameGroup.add(createMemberMesh(block, materials.blocking, scale, offsets, wallThickness));
  }

  adjustCamera(wallWidth * scale, wallHeight * scale);
  requestRender();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredMesh = null;
let needsRender = true;

function requestRender() {
  needsRender = true;
}

function handlePointerMove(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObjects(frameGroup.children, false);
  const hit = intersects[0]?.object ?? null;

  if (hit !== hoveredMesh) {
    if (hoveredMesh) {
      hoveredMesh.material = hoveredMesh.userData.originalMaterial;
    }
    hoveredMesh = hit;
    if (hoveredMesh && hoveredMesh.userData.kind) {
      const kind = hoveredMesh.userData.kind;
      hoveredMesh.material = highlightMaterials[kind] ?? hoveredMesh.userData.originalMaterial;
      canvas.style.cursor = "pointer";
    } else {
      canvas.style.cursor = "";
    }
    requestRender();
  }

  if (hit && tooltip) {
    const member = hit.userData.member;
    const kindLabel = hit.userData.kind ? capitalize(hit.userData.kind) : "Member";

    tooltip.textContent = `${kindLabel} — ${formatNumber(member.width)} × ${formatNumber(member.height)} × ${formatNumber(
      member.source?.[2]
    )} mm @ (${formatNumber(member.x)}, ${formatNumber(member.y)})`;
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
  if (hoveredMesh) {
    hoveredMesh.material = hoveredMesh.userData.originalMaterial;
    hoveredMesh = null;
    requestRender();
  }
  canvas.style.cursor = "";
  tooltip.classList.remove("show");
  tooltip.textContent = "";
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(0) : "?";
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
    if (hoveredMesh) {
      hoveredMesh.material = hoveredMesh.userData.originalMaterial;
      hoveredMesh = null;
    }
    tooltip.classList.remove("show");
    tooltip.textContent = "";
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
