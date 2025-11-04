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
    stud: new THREE.MeshStandardMaterial({ color: 0x3a7bd5, metalness: 0.04, roughness: 0.62 }),
    blocking: new THREE.MeshStandardMaterial({ color: 0x16a085, metalness: 0.03, roughness: 0.58 }),
    plate: new THREE.MeshStandardMaterial({
      color: 0xf39c12,
      metalness: 0.08,
      roughness: 0.55,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    }),
    sheathing: new THREE.MeshStandardMaterial({
      color: 0xc49b66,
      metalness: 0.04,
      roughness: 0.78,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    }),
    nailRow: new THREE.MeshStandardMaterial({
      color: 0xd35400,
      metalness: 0.12,
      roughness: 0.45,
      side: THREE.DoubleSide
    }),
    boyOperation: new THREE.MeshStandardMaterial({
      color: 0xff6b6b,
      metalness: 0.1,
      roughness: 0.5,
      transparent: true,
      opacity: 0.5
    }),
    boyArrow: new THREE.MeshStandardMaterial({
      color: 0xff0000,
      metalness: 0.3,
      roughness: 0.4,
      transparent: false
    }),
    pafRouting: new THREE.MeshStandardMaterial({
      color: 0x8e44ad,
      metalness: 0.16,
      roughness: 0.48,
      transparent: true,
      opacity: 0.78
    }),
    pafOvercutting: new THREE.MeshStandardMaterial({
      color: 0xff9800,
      metalness: 0.08,
      roughness: 0.6,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false
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
    pafOvercutting: materials.pafOvercutting.clone()
  };

  highlightMaterials.plate.opacity = 0.8;
  highlightMaterials.plate.depthWrite = false;

  Object.values(highlightMaterials).forEach(mat => {
    mat.emissive.setHex(0xffffff);
    mat.emissiveIntensity = 0.28;
  });

  const nailMarkerGeometry = createNailMarkerGeometry();

  return {
    materials,
    highlightMaterials,
    nailMarkerGeometry
  };
}
