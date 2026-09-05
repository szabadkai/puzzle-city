import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

const MILLIMETERS_PER_WORLD_UNIT = 3;
const BASE_THICKNESS = .4;
const BASE_MARGIN = .22;

type PrintableMesh = {
  geometry: THREE.BufferGeometry;
  matrixWorld: THREE.Matrix4;
};

function isActuallyVisible(object: THREE.Object3D, root: THREE.Object3D) {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
    if (current === root) return true;
  }
  return false;
}

function hasVolume(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  if (!geometry.boundingBox) return false;
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  return size.x > 1e-5 && size.y > 1e-5 && size.z > 1e-5;
}

/** Build a compact binary STL of the visible, solid town geometry on a shared print base. */
export function makeTownStl(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: PrintableMesh[] = [];
  const bounds = new THREE.Box3();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.nonPrintable || !isActuallyVisible(object, root) || !hasVolume(object.geometry)) return;
    const geometryBounds = object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld);
    bounds.union(geometryBounds);
    meshes.push({ geometry: object.geometry, matrixWorld: object.matrixWorld.clone() });
  });

  if (!meshes.length || bounds.isEmpty()) throw new Error('Build something before exporting a 3D model.');

  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  const baseTop = bounds.min.y + .1;
  const baseBottom = baseTop - BASE_THICKNESS;
  const placeOnBed = new THREE.Matrix4().makeTranslation(-centerX, -baseBottom, -centerZ);
  const millimeterScale = new THREE.Matrix4().makeScale(
    MILLIMETERS_PER_WORLD_UNIT,
    MILLIMETERS_PER_WORLD_UNIT,
    MILLIMETERS_PER_WORLD_UNIT,
  );
  const outputRoot = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();

  for (const source of meshes) {
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.multiplyMatrices(millimeterScale, placeOnBed).multiply(source.matrixWorld);
    outputRoot.add(mesh);
  }

  const baseGeometry = new THREE.BoxGeometry(
    bounds.max.x - bounds.min.x + BASE_MARGIN * 2,
    BASE_THICKNESS,
    bounds.max.z - bounds.min.z + BASE_MARGIN * 2,
  );
  const base = new THREE.Mesh(baseGeometry, material);
  base.scale.setScalar(MILLIMETERS_PER_WORLD_UNIT);
  base.position.y = BASE_THICKNESS * MILLIMETERS_PER_WORLD_UNIT / 2;
  outputRoot.add(base);
  outputRoot.updateMatrixWorld(true);

  const view = new STLExporter().parse(outputRoot, { binary: true });
  const blob = new Blob([view], { type: 'model/stl' });
  baseGeometry.dispose();
  material.dispose();
  outputRoot.clear();
  return blob;
}
