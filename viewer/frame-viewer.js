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
    this.wallSide = 1;
    this.wallThickness = 90;
    this.activeFace = "pli";
    this.projectionMode = "orthographic";
    this.camera = null;
    this.controls = null;
    this.modelOffsets = null;

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x48505a, 0.85);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(1.5, 2.5, 3.5);
    this.scene.add(dirLight);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = "EditorOverlayGroup";
    this.overlayGroup.renderOrder = 1000;
    this.scene.add(this.overlayGroup);

    this.layerVisibility = {
      structure: true,
      pli: true,
      pla: true
    };
    this.availableLayerKeys = ["structure", "pli", "pla"];

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

    this.currentModel = null;
    this.shouldBlockViewerHotkeys = null; // Callback to check if editor is blocking hotkeys

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

  updateModel(model, options = {}) {
    if (!model) {
      return;
    }

    this.currentModel = model;
    const maintainCamera = options?.maintainCamera === true;

    const savedCameraState = (() => {
      if (!maintainCamera || !this.camera) {
        return null;
      }
      const state = {
        position: this.camera.position.clone(),
        quaternion: this.camera.quaternion.clone(),
        zoom: typeof this.camera.zoom === "number" ? this.camera.zoom : null,
        distance: null,
        projection: null
      };
      if (this.controls) {
        state.target = this.controls.target.clone();
        state.distance = state.position.distanceTo(state.target);
      } else {
        state.distance = state.position.length();
      }
      // Save projection parameters to prevent frustum recalculation
      if (this.camera.isOrthographicCamera) {
        state.projection = {
          left: this.camera.left,
          right: this.camera.right,
          top: this.camera.top,
          bottom: this.camera.bottom,
          near: this.camera.near,
          far: this.camera.far
        };
      } else if (this.camera.isPerspectiveCamera) {
        state.projection = {
          fov: this.camera.fov,
          aspect: this.camera.aspect,
          near: this.camera.near,
          far: this.camera.far
        };
      }
      return state;
    })();

    const minX = model.bounds.minX;
    const minY = model.bounds.minY;
    const wallWidth = model.wall?.width ?? model.bounds.maxX - minX;
    const wallHeight = model.wall?.height ?? model.bounds.maxY - minY;
    const wallThickness = model.wall?.thickness ?? 90;
    const wallSide = Number.isFinite(model.wall?.side) ? (model.wall.side >= 0 ? 1 : -1) : 1;
    this.wallDir = wallSide >= 0 ? 1 : -1;
    this.wallSide = wallSide;
    this.wallThickness = wallThickness;
    const sheathingSurfaces = estimateSheathingTopZ(
      model.sheathing ?? [],
      wallThickness,
      wallSide
    );
    this.sheathingSurfaces = sheathingSurfaces;
    this.rebuildLayerRegistry(model);

    const scale = calculateScale(wallWidth, wallHeight);

    // Update raycaster threshold to be scale-aware
    // Use 2mm in model units as the threshold for line picking
    this.raycaster.params.Line.threshold = scale * 2;

    const diag = Math.sqrt((wallWidth * scale) ** 2 + (wallHeight * scale) ** 2);
    const halfDiag = diag / 2 || 1;
    const fovRadians = THREE.MathUtils.degToRad(this.perspectiveFov / 2);
    const baseDistance = Math.max(halfDiag / Math.tan(fovRadians), 1);
    const safeDistance = baseDistance * 1.4 + 2;

    this.cachedDimensions = {
      width: wallWidth,
      height: wallHeight,
      scale,
      cameraDistance: maintainCamera && savedCameraState?.distance
        ? savedCameraState.distance
        : safeDistance
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
    this.modelOffsets = offsets;
    const baseContext = {
      materials: this.materials,
      highlightMaterials: this.highlightMaterials,
      nailMarkerGeometry: this.nailMarkerGeometry,
      scale,
      offsets,
      wallThickness,
      wallSide,
      sheathingSurfaces,
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
      const layerBase = normalizeLayerFamily(mesh.userData?.layerBase)
        ?? normalizeLayerFamily(panel?.layer)
        ?? (panel?.faceDirection >= 0 ? "pli" : "pla");
      const target = layerBase === "pla" ? this.groups.plaSheathing : this.groups.pliSheathing;
      target.add(mesh);
    }

    for (const row of model.nailRows ?? []) {
      const layer = row?.layer === "pla" ? "pla" : "pli";
      const mesh = createNailRowMesh(row, {
        ...baseContext,
        layer,
        layerCommand: row?.layerCommand ?? null,
        layerIndex: row?.layerIndex ?? null
      });
      if (!mesh) {
        continue;
      }
      const target = mesh.userData?.layerBase === "pla" ? this.groups.plaNailRows : this.groups.pliNailRows;
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
        layer: overrideLayer ?? undefined,
        layerCommand: routing?.layerCommand ?? null,
        layerIndex: routing?.layerIndex ?? null
      });
      for (const mesh of meshes) {
        if (!mesh) {
          continue;
        }
        const meshLayer = mesh.userData?.layerBase === "pla" ? "pla" : "pli";
        const target = meshLayer === "pla" ? this.groups.plaPafRoutings : this.groups.pliPafRoutings;
        target.add(mesh);
      }
    }

    this.applyLayerVisibility();
    this.notifyLayerVisibilityChange();

    if (maintainCamera) {
      if (savedCameraState && savedCameraState.projection) {
        // Restore saved projection parameters to prevent frustum changes
        if (this.camera.isOrthographicCamera) {
          this.camera.left = savedCameraState.projection.left;
          this.camera.right = savedCameraState.projection.right;
          this.camera.top = savedCameraState.projection.top;
          this.camera.bottom = savedCameraState.projection.bottom;
          this.camera.near = savedCameraState.projection.near;
          this.camera.far = savedCameraState.projection.far;
        } else if (this.camera.isPerspectiveCamera) {
          this.camera.fov = savedCameraState.projection.fov;
          this.camera.aspect = savedCameraState.projection.aspect;
          this.camera.near = savedCameraState.projection.near;
          this.camera.far = savedCameraState.projection.far;
        }
      } else {
        // No saved projection state, update normally
        this.updateCameraProjection();
      }

      if (savedCameraState) {
        this.camera.position.copy(savedCameraState.position);
        this.camera.quaternion.copy(savedCameraState.quaternion);
        if (this.camera.isOrthographicCamera && typeof savedCameraState.zoom === "number") {
          this.camera.zoom = savedCameraState.zoom;
        }
        this.camera.updateProjectionMatrix();

        if (this.controls && savedCameraState.target) {
          this.controls.target.copy(savedCameraState.target);
          this.controls.update();
          this.camera.position.copy(savedCameraState.position);
          this.camera.quaternion.copy(savedCameraState.quaternion);
        }
      }
      this.requestRender();
    } else {
      this.adjustCamera(wallWidth * scale, wallHeight * scale);
    }
  }

  getCurrentModel() {
    return this.currentModel;
  }

  getEditorOverlayGroup() {
    return this.overlayGroup;
  }

  clearEditorOverlays() {
    if (!this.overlayGroup) {
      return;
    }
    while (this.overlayGroup.children.length > 0) {
      const child = this.overlayGroup.children.pop();
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        child.material.dispose?.();
      }
    }
    this.requestRender();
  }

  addEditorOverlay(object) {
    if (!object || !this.overlayGroup) {
      return;
    }
    this.overlayGroup.add(object);
    this.requestRender();
  }

  removeEditorOverlay(object) {
    if (!object || !this.overlayGroup) {
      return;
    }
    this.overlayGroup.remove(object);
    this.requestRender();
  }

  handlePointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersects = this.raycaster.intersectObjects(this.modelGroup.children, true);
    let bestHit = null;
    let bestPriority = Number.NEGATIVE_INFINITY;
    for (const intersection of intersects) {
      const target = resolvePickTarget(intersection.object);
      if (!target?.userData?.kind) {
        continue;
      }
      const layer = target.userData.layer;
      if (layer && this.layerVisibility[layer] === false) {
        continue;
      }
      const priority =
        typeof target.userData.hoverPriority === "number" ? target.userData.hoverPriority : 0;
      if (
        priority > bestPriority ||
        (priority === bestPriority &&
          (!bestHit || intersection.distance < bestHit.distance))
      ) {
        bestHit = { object: target, distance: intersection.distance };
        bestPriority = priority;
      }
    }
    const hit = bestHit?.object ?? null;

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

  pickObjectAt(clientX, clientY) {
    if (!this.camera || !this.canvas) {
      return null;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersects = this.raycaster.intersectObjects(this.modelGroup.children, true);
    let bestHit = null;
    let bestPriority = Number.NEGATIVE_INFINITY;
    for (const intersection of intersects) {
      const target = resolvePickTarget(intersection.object);
      if (!target?.userData?.kind) {
        continue;
      }
      const layer = target.userData.layer;
      if (layer && this.layerVisibility[layer] === false) {
        continue;
      }
      const priority =
        typeof target.userData.hoverPriority === "number"
          ? target.userData.hoverPriority
          : 0;
      if (
        priority > bestPriority ||
        (priority === bestPriority && (!bestHit || intersection.distance < bestHit.distance))
      ) {
        bestHit = { object: target, distance: intersection.distance };
        bestPriority = priority;
      }
    }
    return bestHit?.object ?? null;
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
    // Check if editor is blocking viewer hotkeys (e.g., during numeric input)
    if (typeof this.shouldBlockViewerHotkeys === "function" && this.shouldBlockViewerHotkeys()) {
      return;
    }

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

  rebuildLayerRegistry(model) {
    const nextKeys = collectAvailableLayerKeys(model);
    this.availableLayerKeys = sortLayerKeys(nextKeys);

    const previous = this.layerVisibility ?? {};
    const nextVisibility = {};
    for (const key of this.availableLayerKeys) {
      nextVisibility[key] = previous[key] !== false;
    }

    this.layerVisibility = nextVisibility;
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
    this.applyObjectLayerVisibility();
    this.requestRender();
  }

  isObjectVisibleByLayer(object) {
    if (!object?.userData) {
      return true;
    }
    const key = normalizeLayerTokenForViewer(object.userData.layer);
    const base = normalizeLayerFamily(object.userData.layerBase ?? key);
    if (base && this.layerVisibility?.[base] === false) {
      return false;
    }
    if (key && this.layerVisibility?.[key] === false) {
      return false;
    }
    return true;
  }

  applyObjectLayerVisibility() {
    const groups = [
      this.groups?.pliSheathing,
      this.groups?.plaSheathing,
      this.groups?.pliNailRows,
      this.groups?.plaNailRows,
      this.groups?.pliPafRoutings,
      this.groups?.plaPafRoutings
    ].filter(group => group);

    for (const group of groups) {
      for (const child of group.children) {
        if (!child?.userData?.kind) {
          continue;
        }
        child.visible = this.isObjectVisibleByLayer(child);
      }
    }
  }

  setLayerVisibility(layer, visible) {
    const normalizedLayer = normalizeLayerTokenForViewer(layer);
    if (!normalizedLayer || !this.layerVisibility || !(normalizedLayer in this.layerVisibility)) {
      return;
    }
    const normalized = !!visible;
    if (this.layerVisibility[normalizedLayer] === normalized) {
      return;
    }
    this.layerVisibility[normalizedLayer] = normalized;
    if (this.layerGroups?.[normalizedLayer]) {
      this.layerGroups[normalizedLayer].visible = normalized;
    }
    this.applyObjectLayerVisibility();
    if (this.hoveredObject && !this.isObjectVisibleByLayer(this.hoveredObject)) {
      this.clearHoverState();
    } else {
      this.requestRender();
    }
    this.notifyLayerVisibilityChange();
  }

  getLayerVisibility() {
    const visibility = {};
    const keys = Array.isArray(this.availableLayerKeys) && this.availableLayerKeys.length > 0
      ? this.availableLayerKeys
      : Object.keys(this.layerVisibility ?? {});
    for (const key of keys) {
      visibility[key] = this.layerVisibility?.[key] !== false;
    }
    return visibility;
  }

  getScale() {
    return this.cachedDimensions?.scale ?? 1;
  }

  getWallDirection() {
    return this.wallDir ?? 1;
  }

  modelPointToWorld(point) {
    if (!point || !this.modelOffsets) {
      return null;
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    const { minX, minY, width, height } = this.modelOffsets;
    const scale = this.cachedDimensions?.scale || 1;
    const localX = point.x - minX;
    const localY = point.y - minY;
    const worldX = (localX - width / 2) * scale;
    const worldY = (localY - height / 2) * scale;
    return new THREE.Vector3(worldX, worldY, 0);
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

      // Position camera close for detailed view (scale * 400mm away)
      const scale = this.cachedDimensions.scale || 1;
      const closeDistance = scale * 400; // About 400mm from the BOY

      // Position camera at an angle for better 3D view
      const offset = new THREE.Vector3(closeDistance * 0.4, closeDistance * 0.25, closeDistance);
      this.camera.position.copy(worldPos).add(offset);

      this.controls.update();
      this.requestRender();
    }

    // Highlight the BOY with pulsing effect
    this.highlightBoy(targetMesh);
  }

  zoomToNailRow(details) {
    if (!details) {
      return;
    }

    const tolerance = 1; // mm tolerance for matching start/end coordinates
    const editorId = Number.isFinite(details.editorId) ? details.editorId : null;
    const targetStart = details.start;
    const targetEnd = details.end;

    const groups = [
      this.groups?.pliNailRows,
      this.groups?.plaNailRows
    ].filter(group => group);

    let targetMesh = null;
    let matchedRow = null;

    const pointsMatch = (a, b) => {
      if (!a || !b) {
        return false;
      }
      return Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance;
    };

    for (const group of groups) {
      for (const child of group.children) {
        const row = child.userData?.row;
        if (child.userData?.kind !== "nailRow" || !row) {
          continue;
        }

        const rowId = Number.isFinite(row.__editorId) ? row.__editorId : null;
        const idMatches = editorId !== null && rowId === editorId;
        const coordinateMatches =
          targetStart && targetEnd &&
          row.start && row.end &&
          ((pointsMatch(row.start, targetStart) && pointsMatch(row.end, targetEnd)) ||
           (pointsMatch(row.start, targetEnd) && pointsMatch(row.end, targetStart)));

        if (idMatches || coordinateMatches) {
          targetMesh = child;
          matchedRow = row;
          break;
        }
      }
      if (targetMesh) {
        break;
      }
    }

    const usableStart = matchedRow?.start ?? targetStart ?? null;
    const usableEnd = matchedRow?.end ?? targetEnd ?? null;

    const startWorld = this.modelPointToWorld(usableStart);
    const endWorld = this.modelPointToWorld(usableEnd);

    let focusPoint = null;
    if (startWorld && endWorld) {
      focusPoint = startWorld.clone().lerp(endWorld, 0.5);
    } else if (startWorld) {
      focusPoint = startWorld.clone();
    } else if (endWorld) {
      focusPoint = endWorld.clone();
    } else if (targetMesh) {
      focusPoint = new THREE.Vector3();
      targetMesh.getWorldPosition(focusPoint);
    }

    if (!focusPoint) {
      console.warn("Unable to determine focus point for nail row zoom.");
      return;
    }

    const layerDescriptor = resolveLayerDescriptorForViewer({
      layer: details.layer ?? matchedRow?.layer ?? "pli",
      layerCommand: details.layerCommand ?? matchedRow?.layerCommand ?? null,
      layerIndex: details.layerIndex ?? matchedRow?.layerIndex ?? null
    });
    const faceDir = resolveLayerFaceDirectionForViewer(layerDescriptor.base, this.wallSide ?? 1);
    const wallThickness = Number.isFinite(this.wallThickness) ? this.wallThickness : 90;
    const scale = this.cachedDimensions?.scale || 1;
    focusPoint.z = computeNailRowZForViewer(
      wallThickness,
      faceDir,
      this.sheathingSurfaces,
      layerDescriptor
    ) * scale;

    this.zoomToWorldPosition(focusPoint);

    if (targetMesh) {
      this.highlightMesh(targetMesh);
    }
  }

  zoomToPosition(x, y, layer) {
    // Find a mesh near the specified x, y position
    // This is used for outlets and other PAF operations
    let targetMesh = null;
    const tolerance = 50; // mm tolerance for position matching (larger since we're looking for area)

    // Pre-compute world target point from model coordinates
    const worldTarget = this.modelPointToWorld({ x, y });

    const searchGroups = [
      this.groups?.plaPafRoutings,
      this.groups?.pliPafRoutings
    ].filter(g => g);

    if (searchGroups.length === 0) {
      console.warn('PAF routing groups not found');
      return;
    }

    // Search for a mesh near the target position
    for (const group of searchGroups) {
      for (const child of group.children) {
        if (child.userData?.routing) {
          // Check if any segment in this routing is near the target position
          const routing = child.userData.routing;
          if (routing.segments) {
            for (const segment of routing.segments) {
              let isNear = false;

              if (segment.kind === "polygon" && segment.points) {
                // Check if any point is near the target
                for (const point of segment.points) {
                  if (Math.abs(point.x - x) < tolerance && Math.abs(point.y - y) < tolerance) {
                    isNear = true;
                    break;
                  }
                }
              } else if (segment.kind === "polyline" && segment.points) {
                for (const point of segment.points) {
                  if (Math.abs(point.x - x) < tolerance && Math.abs(point.y - y) < tolerance) {
                    isNear = true;
                    break;
                  }
                }
              } else if (segment.kind === "circle" && segment.position) {
                // Check if circle position is near the target
                if (Math.abs(segment.position.x - x) < tolerance && Math.abs(segment.position.y - y) < tolerance) {
                  isNear = true;
                }
              }

              if (isNear) {
                targetMesh = child;
                break;
              }
            }
          }

          if (targetMesh) break;
        }
      }
      if (targetMesh) break;
    }

    if (!targetMesh) {
      console.warn(`No mesh found near position x=${x}, y=${y}`);
      // Fallback: zoom to the computed world target (scaled to scene)
      // Calculate proper Z based on layer
      const layerDescriptor = resolveLayerDescriptorForViewer({ layer: layer ?? "pli" });
      const faceDir = resolveLayerFaceDirectionForViewer(layerDescriptor.base, this.wallSide ?? 1);
      const wallThickness = Number.isFinite(this.wallThickness) ? this.wallThickness : 90;
      const scale = this.cachedDimensions?.scale || 1;
      const surfaceZ = computeNailRowZForViewer(
        wallThickness,
        faceDir,
        this.sheathingSurfaces,
        layerDescriptor
      ) * scale;

      if (worldTarget) {
        worldTarget.z = surfaceZ;
        this.zoomToWorldPosition(worldTarget);
      } else {
        const worldPos = new THREE.Vector3(x * scale, y * scale, surfaceZ);
        this.zoomToWorldPosition(worldPos);
      }
      return;
    }

    // Get the world position of the mesh
    // For polygon groups, getWorldPosition returns (0,0,0) since the group itself isn't positioned
    // So we calculate the center from segment points instead
    let worldPos = new THREE.Vector3();
    const segment = targetMesh.userData?.segment;
    if (segment?.kind === "polygon" && Array.isArray(segment.points) && segment.points.length > 0) {
      // Calculate center from polygon points
      const points = segment.points;
      let sumX = 0, sumY = 0;
      for (const pt of points) {
        sumX += pt.x;
        sumY += pt.y;
      }
      const centerX = sumX / points.length;
      const centerY = sumY / points.length;
      const worldCenter = this.modelPointToWorld({ x: centerX, y: centerY });
      if (worldCenter) {
        // Calculate Z based on layer
        const layerDescriptor = resolveLayerDescriptorForViewer({
          layer: targetMesh.userData?.layer ?? "pli",
          layerCommand: targetMesh.userData?.layerCommand ?? null,
          layerIndex: targetMesh.userData?.layerIndex ?? null
        });
        const faceDir = resolveLayerFaceDirectionForViewer(layerDescriptor.base, this.wallSide ?? 1);
        const wallThickness = Number.isFinite(this.wallThickness) ? this.wallThickness : 90;
        const scale = this.cachedDimensions?.scale || 1;
        worldCenter.z = computeNailRowZForViewer(
          wallThickness,
          faceDir,
          this.sheathingSurfaces,
          layerDescriptor
        ) * scale;
        worldPos = worldCenter;
      } else {
        targetMesh.getWorldPosition(worldPos);
      }
    } else {
      targetMesh.getWorldPosition(worldPos);
    }

    this.zoomToWorldPosition(worldPos);
    this.highlightMesh(targetMesh);
  }

  zoomToWorldPosition(worldPos) {
    // Switch to perspective for better depth perception
    if (this.projectionMode !== "perspective") {
      this.setProjectionMode("perspective");
    }

    // Move camera to focus on this position
    if (this.controls && this.camera) {
      // Set controls target to the position
      this.controls.target.copy(worldPos);

      // Position camera close for detailed view (scale * 400mm away)
      const scale = this.cachedDimensions.scale || 1;
      const closeDistance = scale * 400; // About 400mm from the target

      // Position camera at an angle for better 3D view
      const offset = new THREE.Vector3(closeDistance * 0.4, closeDistance * 0.25, closeDistance);
      this.camera.position.copy(worldPos).add(offset);

      this.controls.update();
      this.requestRender();
    }
  }

  highlightBoy(boyMesh) {
    this.highlightMesh(boyMesh);
  }

  highlightMesh(mesh) {
    // Create a pulsing highlight effect
    let pulseCount = 0;
    const maxPulses = 6;
    const pulseInterval = 300; // ms

    const pulse = () => {
      if (pulseCount >= maxPulses) {
        // Reset to normal after pulsing
        if (mesh.userData.setHoverState) {
          mesh.userData.setHoverState(false);
          this.requestRender();
        }
        return;
      }

      // Toggle highlight state
      const shouldHighlight = pulseCount % 2 === 0;
      if (mesh.userData.setHoverState) {
        mesh.userData.setHoverState(shouldHighlight);
        this.requestRender();
      }

      pulseCount++;
      setTimeout(pulse, pulseInterval);
    };

    pulse();
  }
}

function resolveLayerFaceDirectionForViewer(layer, wallSide) {
  const wallDir = wallSide >= 0 ? 1 : -1;
  const normalized = normalizeLayerTokenForViewer(layer);
  if (!normalized) {
    return wallDir;
  }
  if (normalized.startsWith("pla")) {
    return -wallDir;
  }
  if (normalized.startsWith("pli")) {
    return wallDir;
  }
  return wallDir;
}

function computeNailRowZForViewer(wallThickness, faceDir, sheathingSurfaces, layerReference = null) {
  const thickness = Number.isFinite(wallThickness) ? wallThickness : 90;
  const epsilon = 1.2;
  const dir = faceDir >= 0 ? 1 : -1;
  let surfaceZ = null;
  const hasLayerReference =
    layerReference !== null &&
    layerReference !== undefined &&
    (typeof layerReference !== "object" || Object.keys(layerReference).length > 0);
  if (hasLayerReference) {
    const descriptor = resolveLayerDescriptorForViewer(layerReference);
    const layerKey = descriptor.key;
    if (layerKey && Number.isFinite(sheathingSurfaces?.byLayer?.[layerKey])) {
      surfaceZ = sheathingSurfaces.byLayer[layerKey];
    }
  }
  if (!Number.isFinite(surfaceZ) && faceDir >= 0) {
    surfaceZ = sheathingSurfaces?.positive ?? null;
  } else if (!Number.isFinite(surfaceZ)) {
    surfaceZ = sheathingSurfaces?.negative ?? null;
  }
  if (!Number.isFinite(surfaceZ)) {
    surfaceZ = dir * (thickness / 2);
  }
  return surfaceZ + dir * epsilon;
}

function normalizeLayerTokenForViewer(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized || null;
}

function normalizeLayerFamily(raw) {
  const normalized = normalizeLayerTokenForViewer(raw);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("pla")) {
    return "pla";
  }
  if (normalized.startsWith("pli")) {
    return "pli";
  }
  if (normalized === "structure") {
    return "structure";
  }
  return null;
}

function parseLayerTokenForViewer(raw) {
  const normalized = normalizeLayerTokenForViewer(raw);
  if (!normalized) {
    return null;
  }
  if (normalized === "structure") {
    return {
      base: "structure",
      index: null,
      key: "structure",
      command: "STRUCTURE"
    };
  }
  const match = normalized.match(/^(pli|pla)(\d+)?$/);
  if (!match) {
    return null;
  }
  const base = match[1];
  const index = match[2] != null ? Number.parseInt(match[2], 10) : null;
  const hasIndex = Number.isFinite(index);
  return {
    base,
    index: hasIndex ? index : null,
    key: hasIndex ? `${base}${index}` : base,
    command: hasIndex ? `${base.toUpperCase()}${index}` : base.toUpperCase()
  };
}

function resolveLayerDescriptorForViewer(input = null) {
  const ref = input && typeof input === "object" ? input : { layer: input };
  const fromCommand = parseLayerTokenForViewer(ref.layerCommand) ?? parseLayerTokenForViewer(ref.command);
  const fromLayer =
    parseLayerTokenForViewer(ref.layer) ??
    parseLayerTokenForViewer(ref.key) ??
    parseLayerTokenForViewer(ref.base);
  const rawIndexHint = Number.isFinite(ref.layerIndex) ? ref.layerIndex : ref.index;
  const indexHintRaw = Number.isFinite(rawIndexHint) ? Math.trunc(rawIndexHint) : null;
  const indexHint = Number.isFinite(indexHintRaw) && indexHintRaw >= 0 ? indexHintRaw : null;
  const base = fromCommand ?? fromLayer ?? parseLayerTokenForViewer("pli");
  if (!base) {
    return {
      base: "pli",
      index: null,
      key: "pli",
      command: "PLI"
    };
  }
  const resolvedIndex = base.index ?? indexHint;
  if (base.base === "structure") {
    return base;
  }
  if (Number.isFinite(resolvedIndex)) {
    return {
      base: base.base,
      index: resolvedIndex,
      key: `${base.base}${resolvedIndex}`,
      command: `${base.base.toUpperCase()}${resolvedIndex}`
    };
  }
  return {
    base: base.base,
    index: null,
    key: base.base,
    command: base.base.toUpperCase()
  };
}

function extractLayerKeyFromEntity(entity, fallbackSide = null) {
  const descriptor = resolveLayerDescriptorForViewer({
    layer: entity?.layer ?? fallbackSide ?? null,
    layerCommand: entity?.layerCommand ?? null,
    layerIndex: entity?.layerIndex ?? null
  });
  return descriptor.key;
}

function collectAvailableLayerKeys(model) {
  const keys = new Set(["structure", "pli", "pla"]);
  const panels = Array.isArray(model?.sheathing) ? model.sheathing : [];
  const rows = Array.isArray(model?.nailRows) ? model.nailRows : [];
  const routings = Array.isArray(model?.pafRoutings) ? model.pafRoutings : [];

  for (const panel of panels) {
    const key = extractLayerKeyFromEntity(panel, panel?.faceDirection >= 0 ? "pli" : "pla");
    if (key) {
      keys.add(key);
    }
  }
  for (const row of rows) {
    const key = extractLayerKeyFromEntity(row, row?.layer);
    if (key) {
      keys.add(key);
    }
  }
  for (const routing of routings) {
    const key = extractLayerKeyFromEntity(routing, routing?.layer);
    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

function sortLayerKeys(keys) {
  const list = Array.from(keys ?? []);
  const rank = key => {
    if (key === "structure") return 0;
    if (key === "pli") return 1;
    if (key === "pla") return 2;
    const match = key.match(/^(pli|pla)(\d+)$/);
    if (!match) return 99;
    const sideRank = match[1] === "pli" ? 3 : 4;
    const index = Number.parseInt(match[2], 10);
    return sideRank * 100 + index;
  };
  return list.sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.localeCompare(b);
  });
}

function resolvePickTarget(object) {
  let current = object;
  while (current) {
    if (current.userData?.kind) {
      return current;
    }
    current = current.parent;
  }
  return null;
}
