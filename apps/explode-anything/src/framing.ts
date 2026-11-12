import * as THREE from 'three';
import type { CameraModel } from './model';
import type { CameraPose, PresetName } from './types';

const OPTICAL_PARTS = [
  'lensRearMount', 'lensBarrel', 'focusRing', 'aperture', 'lensFrontRing',
  'element1', 'element2', 'element3', 'element4', 'element5', 'element6',
  'spacer1', 'spacer2',
];
const EXPLODED_OPTICAL_PARTS = ['aperture', 'element1', 'element2', 'element3', 'element4', 'element5', 'element6'];
const SENSOR_PARTS = ['sensorPCB', 'sensor', 'shutter'];

const DIRECTIONS: Record<PresetName, THREE.Vector3> = {
  hero: new THREE.Vector3(4.8, 2.35, 9).normalize(),
  front: new THREE.Vector3(0, 0.07, 1).normalize(),
  rear: new THREE.Vector3(-3.3, 1.5, -8).normalize(),
  exploded: new THREE.Vector3(5.8, 3.2, 10).normalize(),
  lens: new THREE.Vector3(4.2, -0.55, 9).normalize(),
  sensor: new THREE.Vector3(2.7, 1.35, 7).normalize(),
};

/** Fit bounding-box corners through the real projection, not a bounding sphere. */
function fitBounds(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  direction: THREE.Vector3,
  aspect: number,
  widthFill: number,
  heightFill: number,
  fitPoints?: THREE.Vector3[],
): CameraPose {
  const target = bounds.getCenter(new THREE.Vector3());
  const min = bounds.min;
  const max = bounds.max;
  const corners: THREE.Vector3[] = fitPoints ?? [];
  if (!fitPoints) {
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      corners.push(new THREE.Vector3(x, y, z));
    }
  }
  const probe = camera.clone();
  probe.aspect = aspect;
  probe.near = 0.08;
  probe.updateProjectionMatrix();
  const spanAt = (distance: number) => {
    probe.position.copy(target).addScaledVector(direction, distance);
    probe.lookAt(target);
    probe.updateMatrixWorld(true);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      const projected = corner.clone().project(probe);
      minX = Math.min(minX, projected.x);
      maxX = Math.max(maxX, projected.x);
      minY = Math.min(minY, projected.y);
      maxY = Math.max(maxY, projected.y);
    }
    return { width: maxX - minX, height: maxY - minY };
  };
  let near = 1;
  let far = 100;
  for (let i = 0; i < 28; i++) {
    const distance = (near + far) * 0.5;
    const span = spanAt(distance);
    if (span.width > widthFill * 2 || span.height > heightFill * 2) near = distance;
    else far = distance;
  }
  const position = target.clone().addScaledVector(direction, far);
  return { position: position.toArray(), target: target.toArray() };
}

export function poseForPreset(
  camera: THREE.PerspectiveCamera,
  model: CameraModel,
  preset: PresetName,
  aspect: number,
  currentAssembly: number,
): CameraPose {
  const fitAssembly = preset === 'exploded' ? 100 : preset === 'sensor' ? Math.max(currentAssembly, 65) : currentAssembly;
  const lensParts = currentAssembly > 0 ? EXPLODED_OPTICAL_PARTS : OPTICAL_PARTS;
  const ids = preset === 'lens' ? lensParts : preset === 'sensor' ? SENSOR_PARTS : undefined;
  const { bounds, points } = model.getFitGeometryAt(fitAssembly, ids);

  const narrow = aspect < 0.9;
  const fitting: Record<PresetName, [number, number]> = narrow ? {
    hero: [0.89, 0.64], front: [0.86, 0.64], rear: [0.86, 0.64],
    exploded: [0.9, 0.70], lens: [0.85, 0.65], sensor: [0.88, 0.62],
  } : {
    hero: [0.60, 0.76], front: [0.57, 0.75], rear: [0.57, 0.75],
    exploded: [0.84, 0.78], lens: [0.78, 0.68], sensor: [0.57, 0.64],
  };
  const direction = DIRECTIONS[preset].clone();
  if (preset === 'lens' && currentAssembly > 0) {
    fitting.lens = narrow ? [0.84, 0.70] : [0.82, 0.78];
    direction.set(5.6, -0.65, 9).normalize();
  }
  return fitBounds(camera, bounds, direction, aspect, ...fitting[preset], points);
}

export function poseForAssembly(
  camera: THREE.PerspectiveCamera,
  model: CameraModel,
  value: number,
  aspect: number,
  orbitTarget: THREE.Vector3,
): CameraPose {
  const { bounds, points } = model.getFitGeometryAt(value);
  const direction = camera.position.clone().sub(orbitTarget).normalize();
  return fitBounds(camera, bounds, direction, aspect, aspect < 0.9 ? 0.88 : 0.82, aspect < 0.9 ? 0.67 : 0.76, points);
}

export function poseForSelection(
  camera: THREE.PerspectiveCamera,
  model: CameraModel,
  id: string,
  aspect: number,
  orbitTarget: THREE.Vector3,
): CameraPose {
  const bounds = model.getBounds([id]);
  const direction = camera.position.clone().sub(orbitTarget).normalize();
  return fitBounds(camera, bounds, direction, aspect, aspect < 0.9 ? 0.8 : 0.47, 0.6);
}
