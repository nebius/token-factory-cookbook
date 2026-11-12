import * as THREE from "three";

/**
 * Where to put a perspective camera so a box fills the frame from one direction.
 * Uses the box's projected corners rather than a bounding sphere, so tall or flat machines are not shown tiny.
 * `dir` points from the target towards the camera; `vfov` is in radians.
 */
export function frameBox(box: THREE.Box3, dir: THREE.Vector3, vfov: number, aspect: number, margin = 1.12): { center: THREE.Vector3; distance: number } {
  const center = box.getCenter(new THREE.Vector3());
  const z = dir.clone().normalize();
  // Same basis as Object3D.lookAt with Y up.
  const x = new THREE.Vector3(0, 1, 0).cross(z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = z.clone().cross(x);
  const tanV = Math.tan(vfov / 2);
  const tanH = tanV * aspect;
  let distance = 0;
  const c = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    const depth = c.dot(z);
    distance = Math.max(distance, depth + (margin * Math.abs(c.dot(x))) / tanH, depth + (margin * Math.abs(c.dot(y))) / tanV);
  }
  return { center, distance: Math.max(distance, 1e-3) };
}

/** The library picture: a three-quarter view, pulled a little apart so it reads as a cutaway. */
export const THUMBNAIL = { view: "iso", explode: 0.2 } as const;
/** Library pictures sit on the same light sky paper as the 3D stage. */
export const THUMBNAIL_SIZE = { width: 960, height: 720, background: "#dde9ff" } as const;
