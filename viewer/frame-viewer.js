import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createMaterialLibrary } from "./materials.js";
import {
  calculateScale,
  createMemberMesh,
  createSheathingMesh,
  createNailRowMesh,
  createBoyOperationMesh,
  createPafMeshes,
  estimateSheathingTopZ
} from "./geometry.js";
import { formatTooltipContent } from "./tooltip.js";
import { clearGroup } from "./utils.js";

export class FrameViewer {
  constructor({ canvas, tooltip } = {}) {
    if (!canvas) {
      throw new Error("FrameViewer requires a canvas element");
    }

    this.canvas = canvas;
    this.tooltip = tooltip ?? null;

    const { materials, highlightMaterials, nailMarkerGeometry } = createMaterialLibrary();
    this.materials = materials;
    this.highlightMaterials = highlightMaterials;
    this.nailMarkerGeometry = nailMarkerGeometry;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f4f9);

    this.perspectiveFov = 36;
    this.wallDir = 1;
    this.activeFace = "pli";
    this.projectionMode = "orthographic";
    this.camera = null;
    this.controls = null;

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x48505a, 0.85);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(1.5, 2.5, 3.5);
    this.scene.add(dirLight);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    this.layerVisibility = {
      structure: true,
      pli: true,
      pla: true
    };

    this.layerGroups = {
      structure: new THREE.Group(),
      pli: new THREE.Group(),
      pla: new THREE.Group()
    };
    this.layerGroups.structure.name = "StructureLayer";
    this.layerGroups.pli.name = "PliLayer";
    this.layerGroups.pla.name = "PlaLayer";

    this.groups = {
      framing: new THREE.Group(),
      boyOperations: new THREE.Group(),
      pliSheathing: new THREE.Group(),
      plaSheathing: new THREE.Group(),
      pliNailRows: new THREE.Group(),
      plaNailRows: new THREE.Group(),
      pliPafRoutings: new THREE.Group(),
      plaPafRoutings: new THREE.Group()
    };

    this.groups.framing.name = "FramingGroup";
    this.groups.boyOperations.name = "BoyOperationsGroup";
    this.groups.pliSheathing.name = "PliSheathingGroup";
    this.groups.plaSheathing.name = "PlaSheathingGroup";
    this.groups.pliNailRows.name = "PliNailRowsGroup";
    this.groups.plaNailRows.name = "PlaNailRowsGroup";
    this.groups.pliPafRoutings.name = "PliPafGroup";
    this.groups.plaPafRoutings.name = "PlaPafGroup";

    this.layerGroups.structure.add(this.groups.framing, this.groups.boyOperations);
    this.layerGroups.pli.add(
      this.groups.pliSheathing,
      this.groups.pliNailRows,
      this.groups.pliPafRoutings
    );
    this.layerGroups.pla.add(
      this.groups.plaSheathing,
      this.groups.plaNailRows,
      this.groups.plaPafRoutings
    );

    this.modelGroup.add(
      this.layerGroups.structure,
      this.layerGroups.pli,
      this.layerGroups.pla
    );

    this.applyLayerVisibility();
    this.onLayerVisibilityChange = null;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 0.2 };
    this.pointer = new THREE.Vector2();
    this.hoveredObject = null;
    this.needsRender = true;

    this.cachedDimensions = {
      width: 1,
      height: 1,
      scale: 1,
      cameraDistance: 10
    };

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.requestRender = this.requestRender.bind(this);
    this.animate = this.animate.bind(this);

    this.setProjectionMode(this.projectionMode);

    canvas.addEventListener("mousemove", this.handlePointerMove);
    canvas.addEventListener("mouseleave", this.handlePointerLeave);
    canvas.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);

    this.resizeRenderer();
    this.animate();
  }

  updateModel(model) {
    if (!model) {
      return;
    }

    const minX = model.bounds.minX;
    const minY = model.bounds.minY;
    const wallWidth = model.wall?.width ?? model.bounds.maxX - minX;
    const wallHeight = model.wall?.height ?? model.bounds.maxY - minY;
    const wallThickness = model.wall?.thickness ?? 90;
    const wallSide = Number.isFinite(model.wall?.side) ? (model.wall.side >= 0 ? 1 : -1) : 1;
    this.wallDir = wallSide >= 0 ? 1 : -1;
    const sheathingSurfaces = estimateSheathingTopZ(
      model.sheathing ?? [],
      wallThickness,
      wallSide
    );

    const scale = calculateScale(wallWidth, wallHeight);
    this.cachedDimensions = {
      width: wallWidth,
      height: wallHeight,
      scale,
      cameraDistance: this.cachedDimensions.cameraDistance
    };

    this.clearHoverState();
    clearGroup(this.groups.framing);
    clearGroup(this.groups.boyOperations);
    clearGroup(this.groups.pliSheathing);
    clearGroup(this.groups.plaSheathing);
    clearGroup(this.groups.pliNailRows);
    clearGroup(this.groups.plaNailRows);
    clearGroup(this.groups.pliPafRoutings);
    clearGroup(this.groups.plaPafRoutings);

    const offsets = { minX, minY, width: wallWidth, height: wallHeight };
    const baseContext = {
      materials: this.materials,
      highlightMaterials: this.highlightMaterials,
      nailMarkerGeometry: this.nailMarkerGeometry,
      scale,
      offsets,
      wallThickness,
      wallSide,
      plates: model.plates ?? []
    };

    for (const plate of model.plates ?? []) {
      const mesh = createMemberMesh(plate, "plate", baseContext);
      if (mesh) {
        this.groups.framing.add(mesh);
      }
    }

    for (const stud of model.studs ?? []) {
      const mesh = createMemberMesh(stud, "stud", baseContext);
      if (mesh) {
        this.groups.framing.add(mesh);
      }
    }

    for (const block of model.blocking ?? []) {
      const mesh = createMemberMesh(block, "blocking", baseContext);
      if (mesh) {
        this.groups.framing.add(mesh);
      }
    }

    for (const panel of model.sheathing ?? []) {
      const mesh = createSheathingMesh(panel, baseContext);
      if (!mesh) {
        continue;
      }
      const layer = typeof panel?.layer === "string" ? panel.layer : panel?.faceDirection >= 0 ? "pli" : "pla";
      const target = layer === "pla" ? this.groups.plaSheathing : this.groups.pliSheathing;
      target.add(mesh);
    }

    for (const row of model.nailRows ?? []) {
      const layer = row?.layer === "pla" ? "pla" : "pli";
      const mesh = createNailRowMesh(row, { ...baseContext, layer });
      if (!mesh) {
        continue;
      }
      const target = layer === "pla" ? this.groups.plaNailRows : this.groups.pliNailRows;
      target.add(mesh);
    }

    for (const operation of model.boyOperations ?? []) {
      const mesh = createBoyOperationMesh(operation, baseContext);
      if (mesh) {
        this.groups.boyOperations.add(mesh);
      }
    }

    for (const routing of model.pafRoutings ?? []) {
      const overrideLayer = typeof routing?.layer === "string" ? routing.layer : null;
      const meshes = createPafMeshes(routing, {
        ...baseContext,
        sheathingSurfaces,
        layer: overrideLayer ?? undefined
      });
      for (const mesh of meshes) {
        if (!mesh) {
          continue;
        }
        const meshLayer = mesh.userData?.layer === "pla" ? "pla" : "pli";
        const target = meshLayer === "pla" ? this.groups.plaPafRoutings : this.groups.pliPafRoutings;
        target.add(mesh);
      }
    }

    this.adjustCamera(wallWidth * scale, wallHeight * scale);
    this.requestRender();
  }

  handlePointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersects = this.raycaster.intersectObjects(this.modelGroup.children, true);
    const hit = intersects.find(intersection => {
      const obj = intersection.object;
      if (!obj?.userData?.kind) {
        return false;
      }
      const layer = obj.userData.layer;
      if (layer && this.layerVisibility[layer] === false) {
        return false;
      }
      return true;
    })?.object ?? null;

    this.setHoveredObject(hit);

    if (!this.tooltip) {
      return;
    }

    if (hit) {
      const tooltipText = formatTooltipContent(hit);
      if (!tooltipText) {
        this.tooltip.classList.remove("show");
        this.tooltip.textContent = "";
        return;
      }
      this.tooltip.textContent = tooltipText;
      this.tooltip.classList.add("show");

      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const tooltipRect = this.tooltip.getBoundingClientRect();

      let left = localX + 16;
      let top = localY + 16;

      if (left + tooltipRect.width > rect.width) {
        left = rect.width - tooltipRect.width - 12;
      }
      if (top + tooltipRect.height > rect.height) {
        top = rect.height - tooltipRect.height - 12;
      }

      this.tooltip.style.left = `${Math.max(12, left)}px`;
      this.tooltip.style.top = `${Math.max(12, top)}px`;
    } else {
      this.tooltip.classList.remove("show");
      this.tooltip.textContent = "";
    }
  }

  handlePointerLeave() {
    this.clearHoverState();
  }

  handleContextMenu(event) {
    event.preventDefault();
  }

  handleResize() {
    this.resizeRenderer();
  }

  handleKeyDown(event) {
    switch (event.key) {
      case "1":
        this.resetViewToFace("pli");
        break;
      case "2":
        this.resetViewToFace("pla");
        break;
      case "3":
        this.toggleProjectionMode();
        break;
      default:
        break;
    }
  }

  resizeRenderer() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.updateCameraProjection();
    this.requestRender();
  }

  adjustCamera(width, height) {
    const diag = Math.sqrt(width * width + height * height);
    const halfDiag = diag / 2 || 1;
    const fovRadians = THREE.MathUtils.degToRad(this.perspectiveFov / 2);
    const baseDistance = Math.max(halfDiag / Math.tan(fovRadians), 1);
    const safeDistance = baseDistance * 1.4 + 2;

    this.cachedDimensions.width = width;
    this.cachedDimensions.height = height;
    this.cachedDimensions.cameraDistance = safeDistance;

    if (this.camera?.isOrthographicCamera) {
      this.camera.zoom = 1;
    }

    this.updateCameraProjection();
    this.positionCameraForFace(this.activeFace);
    this.requestRender();
  }

  clearHoverState() {
    if (this.hoveredObject && this.hoveredObject.userData?.setHoverState) {
      this.hoveredObject.userData.setHoverState(false);
    }
    this.hoveredObject = null;
    if (this.tooltip) {
      this.tooltip.classList.remove("show");
      this.tooltip.textContent = "";
    }
    this.canvas.style.cursor = "";
    this.requestRender();
  }

  setHoveredObject(target) {
    if (target === this.hoveredObject) {
      return;
    }
    if (this.hoveredObject && this.hoveredObject.userData?.setHoverState) {
      this.hoveredObject.userData.setHoverState(false);
    }
    this.hoveredObject = target;
    if (this.hoveredObject && this.hoveredObject.userData?.setHoverState) {
      this.hoveredObject.userData.setHoverState(true);
      this.canvas.style.cursor = this.hoveredObject.userData.kind ? "pointer" : "";
    } else {
      this.canvas.style.cursor = "";
    }
    this.requestRender();
  }

  resetViewToFace(face) {
    this.clearHoverState();
    this.positionCameraForFace(face);
  }

  resetView() {
    this.resetViewToFace("pli");
  }

  setProjectionMode(mode) {
    const targetMode = mode === "perspective" ? "perspective" : "orthographic";
    if (this.projectionMode === targetMode && this.camera) {
      return;
    }

    const aspect = this.getCanvasAspect();
    let newCamera;
    if (targetMode === "orthographic") {
      const frustumSize = Math.max(this.cachedDimensions.width || 8, this.cachedDimensions.height || 8) + 4;
      const halfHeight = frustumSize / 2;
      const halfWidth = halfHeight * aspect;
      newCamera = new THREE.OrthographicCamera(
        -halfWidth,
        halfWidth,
        halfHeight,
        -halfHeight,
        -5000,
        5000
      );
    } else {
      newCamera = new THREE.PerspectiveCamera(this.perspectiveFov, aspect, 0.1, 2000);
    }

    if (this.controls) {
      this.controls.removeEventListener("change", this.requestRender);
      this.controls.dispose();
    }

    this.camera = newCamera;
    this.camera.position.set(0, 0, this.cachedDimensions.cameraDistance);
    this.camera.up.set(0, 1, 0);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.configureControls();

    this.projectionMode = targetMode;
    if (this.camera.isOrthographicCamera) {
      this.camera.zoom = 1;
    }
    this.updateCameraProjection();
    this.positionCameraForFace(this.activeFace);
    this.notifyProjectionModeChange();
  }

  toggleProjectionMode() {
    const next = this.projectionMode === "orthographic" ? "perspective" : "orthographic";
    this.setProjectionMode(next);
  }

  getProjectionMode() {
    return this.projectionMode;
  }

  configureControls() {
    if (!this.controls) {
      return;
    }
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.enableRotate = true;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.panSpeed = 0.9;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 1.0;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.controls.addEventListener("change", this.requestRender);
  }

  getCanvasAspect() {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    return width / height;
  }

  updateCameraProjection() {
    if (!this.camera) {
      return;
    }
    const aspect = this.getCanvasAspect();
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = aspect;
      const distance = this.cachedDimensions.cameraDistance || 10;
      this.camera.near = Math.max(distance * 0.02, 0.1);
      this.camera.far = Math.max(distance * 6, 100);
      this.camera.updateProjectionMatrix();
      return;
    }

    const width = this.cachedDimensions.width || 8;
    const height = this.cachedDimensions.height || 8;
    const margin = Math.max(width, height) * 0.25 + 2;
    let halfHeight = height / 2 + margin;
    let halfWidth = width / 2 + margin;
    if (halfWidth / halfHeight > aspect) {
      halfHeight = halfWidth / aspect;
    } else {
      halfWidth = halfHeight * aspect;
    }
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;

    const distance = this.cachedDimensions.cameraDistance || 10;
    const span = distance * 2 + margin * 4;
    this.camera.near = 0.1;
    this.camera.far = Math.max(span, distance * 3);
    this.camera.updateProjectionMatrix();
  }

  positionCameraForFace(face) {
    const resolved = face === "pla" ? "pla" : "pli";
    this.activeFace = resolved;
    const direction = resolved === "pli" ? this.wallDir : -this.wallDir;
    const distance = this.cachedDimensions.cameraDistance || 10;
    if (this.camera) {
      this.camera.position.set(0, 0, direction * distance);
    }
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
    this.requestRender();
  }

  notifyProjectionModeChange() {
    if (typeof this.onProjectionModeChange === "function") {
      this.onProjectionModeChange(this.projectionMode);
    }
  }

  notifyLayerVisibilityChange() {
    if (typeof this.onLayerVisibilityChange === "function") {
      this.onLayerVisibilityChange(this.getLayerVisibility());
    }
  }

  applyLayerVisibility() {
    if (!this.layerGroups) {
      return;
    }
    for (const [layer, group] of Object.entries(this.layerGroups)) {
      if (!group) {
        continue;
      }
      const visible = this.layerVisibility?.[layer] !== false;
      group.visible = visible;
    }
    this.requestRender();
  }

  setLayerVisibility(layer, visible) {
    if (!this.layerGroups?.[layer]) {
      return;
    }
    const normalized = !!visible;
    if (this.layerVisibility[layer] === normalized) {
      return;
    }
    this.layerVisibility[layer] = normalized;
    this.layerGroups[layer].visible = normalized;
    const hoveredLayer = this.hoveredObject?.userData?.layer ?? null;
    if (!normalized && hoveredLayer === layer) {
      this.clearHoverState();
    } else {
      this.requestRender();
    }
    this.notifyLayerVisibilityChange();
  }

  getLayerVisibility() {
    return {
      structure: this.layerVisibility.structure !== false,
      pli: this.layerVisibility.pli !== false,
      pla: this.layerVisibility.pla !== false
    };
  }

  requestRender() {
    this.needsRender = true;
  }

  animate() {
    this.animationFrame = requestAnimationFrame(this.animate);
    const changed = this.controls.update();
    if (this.needsRender || changed) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }

  zoomToBoy(boyX, boyZ) {
    // Find the BOY mesh in the scene (BOY meshes are in this.groups.boyOperations)
    let targetMesh = null;
    const tolerance = 1; // mm tolerance for position matching

    if (!this.groups?.boyOperations) {
      console.warn('BOY operations group not found');
      return;
    }

    for (const child of this.groups.boyOperations.children) {
      if (child.userData?.kind === "boy" && child.userData?.operation) {
        const op = child.userData.operation;
        if (Math.abs(op.x - boyX) < tolerance && Math.abs(op.z - boyZ) < tolerance) {
          targetMesh = child;
          break;
        }
      }
    }

    if (!targetMesh) {
      console.warn(`BOY at x=${boyX}, z=${boyZ} not found in scene`);
      console.warn('Available BOYs:', this.groups.boyOperations.children.map(c => c.userData?.operation));
      return;
    }

    // Get the world position of the BOY
    const worldPos = new THREE.Vector3();
    targetMesh.getWorldPosition(worldPos);

    // Switch to perspective for better depth perception
    if (this.projectionMode !== "perspective") {
      this.setProjectionMode("perspective");
    }

    // Move camera to focus on this BOY with close zoom
    if (this.controls && this.camera) {
      // Set controls target to the BOY position
      this.controls.target.copy(worldPos);

      // Position camera very close for detailed view (scale * 200mm away)
      const scale = this.cachedDimensions.scale || 1;
      const closeDistance = scale * 100; // About 200mm from the BOY

      // Position camera at an angle for better 3D view
      const offset = new THREE.Vector3(closeDistance * 0.5, closeDistance * 0.3, closeDistance);
      this.camera.position.copy(worldPos).add(offset);

      this.controls.update();
      this.requestRender();
    }

    // Highlight the BOY with pulsing effect
    this.highlightBoy(targetMesh);
  }

  highlightBoy(boyMesh) {
    // Create a pulsing highlight effect
    let pulseCount = 0;
    const maxPulses = 6;
    const pulseInterval = 300; // ms

    const pulse = () => {
      if (pulseCount >= maxPulses) {
        // Reset to normal after pulsing
        if (boyMesh.userData.setHoverState) {
          boyMesh.userData.setHoverState(false);
          this.requestRender();
        }
        return;
      }

      // Toggle highlight state
      const shouldHighlight = pulseCount % 2 === 0;
      if (boyMesh.userData.setHoverState) {
        boyMesh.userData.setHoverState(shouldHighlight);
        this.requestRender();
      }

      pulseCount++;
      setTimeout(pulse, pulseInterval);
    };

    pulse();
  }
}
