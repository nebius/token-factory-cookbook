import jpeg from "jpeg-js";
import * as THREE from "three";
import type { BuiltPart } from "@/lib/sandbox/types";
import type { Meta, ViewName } from "@/lib/schema/teardown";
import { explodeOffsets } from "@/lib/viewer/explode";
import { frameBox } from "@/lib/viewer/frame";

/**
 * A small software renderer so the server can show Kimi its own model (and make library thumbnails)
 * without a browser. Flat-shaded, z-buffered, 2× supersampled. Uses the same views, explode paths and
 * cut plane as the 3D viewer.
 */

export type RasterSpec = { view: ViewName; explode?: number; clip?: boolean };

const DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, 0.08, 1],
  back: [0, 0.08, -1],
  left: [-1, 0.08, 0],
  right: [1, 0.08, 0],
  top: [0, 1, 0.02],
  iso: [1, 0.75, 1.15],
};
// Review pictures for Kimi stay on light paper so dark parts stay visible; library pictures pass their own.
const REVIEW_BG = "#efe9de";
const SS = 2;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rasterViews(meta: Meta, built: BuiltPart[], specs: RasterSpec[], width = 768, height = 576, background = REVIEW_BG): string[] {
  const bg = hexRgb(background);
  return specs.map((s) => renderOne(meta, built, s, width, height, bg));
}

function renderOne(meta: Meta, built: BuiltPart[], spec: RasterSpec, width: number, height: number, BG: [number, number, number]): string {
  const W = width * SS;
  const H = height * SS;
  const color = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) color.set(BG, i * 3);
  const depth = new Float32Array(W * H).fill(Infinity);

  const offsets = explodeOffsets(meta.parts, spec.explode ?? 0);
  const ok = built.filter((b) => b.ok && b.bounds);
  const [sx, sy, sz] = meta.device.sizeMm;
  const devR = Math.max(20, Math.hypot(sx, sy, sz) / 2);

  // Fit the camera the way the viewer does: the box around every part at its exploded position.
  const box = new THREE.Box3();
  for (const b of ok) {
    const o = offsets.get(b.id) ?? [0, 0, 0];
    box.expandByPoint(new THREE.Vector3(b.bounds!.min[0] + o[0], b.bounds!.min[1] + o[1], b.bounds!.min[2] + o[2]));
    box.expandByPoint(new THREE.Vector3(b.bounds!.max[0] + o[0], b.bounds!.max[1] + o[1], b.bounds!.max[2] + o[2]));
  }
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(sx, sy, sz));
  const cam = new THREE.PerspectiveCamera(32, width / height, devR / 100, devR * 60);
  const dir = new THREE.Vector3(...DIRS[spec.view]).normalize();
  const { center, distance } = frameBox(box, dir, THREE.MathUtils.degToRad(32), cam.aspect);
  cam.position.copy(center).addScaledVector(dir, distance);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
  const light = new THREE.Vector3(1, 1.6, 1.2).normalize();
  const view = dir.clone();

  const clip = !!spec.clip;
  const sxs = new Float32Array(3);
  const sys = new Float32Array(3);
  const szs = new Float32Array(3);
  const wx = new Float32Array(3);
  const a = new THREE.Vector3();
  const b2 = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (const part of ok) {
    const o = offsets.get(part.id) ?? [0, 0, 0];
    for (const mesh of part.meshes) {
      const rgb = hexRgb(mesh.material.color);
      const metal = mesh.material.metalness;
      const pos = mesh.position;
      const count = mesh.index ? mesh.index.length : pos.length / 3;
      for (let t = 0; t + 2 < count; t += 3) {
        let behind = false;
        for (let k = 0; k < 3; k++) {
          const vi = mesh.index ? mesh.index[t + k] : t + k;
          const x = pos[vi * 3] + o[0];
          const y = pos[vi * 3 + 1] + o[1];
          const z = pos[vi * 3 + 2] + o[2];
          (k === 0 ? a : k === 1 ? b2 : c).set(x, y, z);
          const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
          if (cw <= 1e-6) {
            behind = true;
            break;
          }
          sxs[k] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * W;
          sys[k] = (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5)) * H;
          szs[k] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / cw;
          wx[k] = x;
        }
        if (behind) continue;
        if (clip && wx[0] > 0 && wx[1] > 0 && wx[2] > 0) continue;
        n.subVectors(b2, a).cross(c.clone().sub(a));
        if (n.lengthSq() === 0) continue;
        n.normalize();
        const diffuse = Math.abs(n.dot(light));
        const facing = Math.abs(n.dot(view));
        const shade = Math.min(1.15, 0.38 + 0.5 * diffuse + 0.22 * facing + metal * 0.12 * Math.pow(facing, 8));
        const r = Math.min(255, rgb[0] * shade);
        const g = Math.min(255, rgb[1] * shade);
        const bl = Math.min(255, rgb[2] * shade);

        const minX = Math.max(0, Math.floor(Math.min(sxs[0], sxs[1], sxs[2])));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(sxs[0], sxs[1], sxs[2])));
        const minY = Math.max(0, Math.floor(Math.min(sys[0], sys[1], sys[2])));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(sys[0], sys[1], sys[2])));
        if (minX > maxX || minY > maxY) continue;
        const area = (sxs[1] - sxs[0]) * (sys[2] - sys[0]) - (sxs[2] - sxs[0]) * (sys[1] - sys[0]);
        if (Math.abs(area) < 1e-9) continue;
        for (let y = minY; y <= maxY; y++) {
          const py = y + 0.5;
          for (let x = minX; x <= maxX; x++) {
            const pxx = x + 0.5;
            const w0 = ((sxs[1] - pxx) * (sys[2] - py) - (sxs[2] - pxx) * (sys[1] - py)) / area;
            const w1 = ((sxs[2] - pxx) * (sys[0] - py) - (sxs[0] - pxx) * (sys[2] - py)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const zz = w0 * szs[0] + w1 * szs[1] + w2 * szs[2];
            const idx = y * W + x;
            if (zz >= depth[idx]) continue;
            if (clip && w0 * wx[0] + w1 * wx[1] + w2 * wx[2] > 0) continue;
            depth[idx] = zz;
            const ci = idx * 3;
            color[ci] = r;
            color[ci + 1] = g;
            color[ci + 2] = bl;
          }
        }
      }
    }
  }

  // Downsample with a box filter, then encode.
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const ci = ((y * SS + dy) * W + (x * SS + dx)) * 3;
          r += color[ci];
          g += color[ci + 1];
          bl += color[ci + 2];
        }
      }
      const oi = (y * width + x) * 4;
      rgba[oi] = r / (SS * SS);
      rgba[oi + 1] = g / (SS * SS);
      rgba[oi + 2] = bl / (SS * SS);
      rgba[oi + 3] = 255;
    }
  }
  const jpg = jpeg.encode({ data: rgba, width, height }, 85);
  return `data:image/jpeg;base64,${Buffer.from(jpg.data).toString("base64")}`;
}
