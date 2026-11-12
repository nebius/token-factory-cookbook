import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { frameBox } from "@/lib/viewer/frame";

describe("frameBox", () => {
  const vfov = THREE.MathUtils.degToRad(32);
  const tall = new THREE.Box3(new THREE.Vector3(-15, -100, -15), new THREE.Vector3(15, 100, 15));

  it("keeps every corner inside the picture, with the long side nearly filling it", () => {
    for (const dir of [new THREE.Vector3(0, 0.08, 1), new THREE.Vector3(1, 0.75, 1.15), new THREE.Vector3(0, 1, 0.02)]) {
      const { center, distance } = frameBox(tall, dir, vfov, 4 / 3);
      const cam = new THREE.PerspectiveCamera(32, 4 / 3, 1, 10_000);
      cam.position.copy(center).addScaledVector(dir.clone().normalize(), distance);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      let maxY = 0;
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3(i & 1 ? 15 : -15, i & 2 ? 100 : -100, i & 4 ? 15 : -15).project(cam);
        expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
        maxY = Math.max(maxY, Math.abs(v.x), Math.abs(v.y));
      }
      expect(maxY).toBeGreaterThan(0.8);
    }
  });

  it("comes closer than a bounding sphere in the three-quarter view", () => {
    const sphere = tall.getBoundingSphere(new THREE.Sphere());
    const { distance } = frameBox(tall, new THREE.Vector3(1, 0.75, 1.15), vfov, 4 / 3, 1);
    expect(distance).toBeLessThan(sphere.radius / Math.sin(vfov / 2));
  });
});
