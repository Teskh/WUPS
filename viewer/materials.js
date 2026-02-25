import * as THREE from "three";

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

export function createMaterialLibrary() {
  const materials = {
    stud: new THREE.MeshStandardMaterial({ color: 0xc8d2dd, metalness: 0.0, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    blocking: new THREE.MeshStandardMaterial({ color: 0xb8c6be, metalness: 0.0, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xaebfce, metalness: 0.0, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    edgeLine: new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 }),
    sheathing: new THREE.MeshStandardMaterial({
      color: 0xe0b98b,
      metalness: 0.0,
      roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide
    }),
    nailRow: new THREE.MeshStandardMaterial({
      color: 0x88929b,
      metalness: 0.1,
      roughness: 0.7,
      side: THREE.DoubleSide
    }),
    boyOperation: new THREE.MeshStandardMaterial({
      color: 0xffb6b9,
      metalness: 0.0,
      roughness: 0.9,
      transparent: true,
      opacity: 0.6
    }),
    boyArrow: new THREE.MeshStandardMaterial({
      color: 0xff6b6b,
      metalness: 0.0,
      roughness: 0.8,
      transparent: false
    }),
    pafRouting: new THREE.MeshStandardMaterial({
      color: 0xb39bc8,
      metalness: 0.0,
      roughness: 0.9,
      transparent: true,
      opacity: 0.8
    }),
    pafOvercutting: new THREE.MeshStandardMaterial({
      color: 0xf9c8a0,
      metalness: 0.0,
      roughness: 0.95,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false
    }),
    pafRoutingLine: new THREE.LineBasicMaterial({
      color: 0x9575cd,  // Soft purple
      linewidth: 4,
      transparent: false,
      opacity: 1.0
    }),
    pafRoutingLineDashed: new THREE.LineDashedMaterial({
      color: 0x9575cd,  // Soft purple
      linewidth: 4,
      dashSize: 10,
      gapSize: 5,
      transparent: false,
      opacity: 1.0
    }),
    pafOvercuttingLine: new THREE.LineBasicMaterial({
      color: 0xffb74d,  // Soft amber
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    }),
    pafCornerRadiusLine: new THREE.LineBasicMaterial({
      color: 0x4caf50,
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    }),
    pafCornerReliefLine: new THREE.LineBasicMaterial({
      color: 0xf44336,
      linewidth: 2,
      transparent: true,
      opacity: 0.85
    })
  };

  const highlightMaterials = {
    stud: materials.stud.clone(),
    blocking: materials.blocking.clone(),
    plate: materials.plate.clone(),
    sheathing: materials.sheathing.clone(),
    nailRow: materials.nailRow.clone(),
    boyOperation: materials.boyOperation.clone(),
    boyArrow: materials.boyArrow.clone(),
    pafRouting: materials.pafRouting.clone(),
    pafOvercutting: materials.pafOvercutting.clone(),
    pafRoutingLine: materials.pafRoutingLine.clone(),
    pafRoutingLineDashed: materials.pafRoutingLineDashed.clone(),
    pafOvercuttingLine: materials.pafOvercuttingLine.clone(),
    pafCornerRadiusLine: materials.pafCornerRadiusLine.clone(),
    pafCornerReliefLine: materials.pafCornerReliefLine.clone()
  };

  highlightMaterials.plate.opacity = 0.8;
  highlightMaterials.plate.depthWrite = false;

  Object.values(highlightMaterials).forEach(mat => {
    if (mat.emissive !== undefined) {
      mat.emissive.setHex(0xffffff);
      mat.emissiveIntensity = 0.28;
    }
  });

  // Line materials don't have emissive, so we brighten them by increasing opacity
  highlightMaterials.pafRoutingLine.opacity = 1.0;
  highlightMaterials.pafRoutingLineDashed.opacity = 1.0;
  highlightMaterials.pafOvercuttingLine.opacity = 0.8;
  highlightMaterials.pafCornerRadiusLine.opacity = 1.0;
  highlightMaterials.pafCornerReliefLine.opacity = 1.0;

  const nailMarkerGeometry = createNailMarkerGeometry();

  return {
    materials,
    highlightMaterials,
    nailMarkerGeometry
  };
}
