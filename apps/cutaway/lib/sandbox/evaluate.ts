import * as THREE from "three";
import { kit } from "./kit";
import type { BuiltMesh, BuiltPart, Issue } from "./types";

/** Globals a builder must not reach. They are shadowed as undefined parameters. */
const BLOCKED = [
  "self", "globalThis", "window", "document", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "importScripts", "postMessage", "Worker", "SharedWorker", "indexedDB", "caches", "navigator", "location",
  "setTimeout", "setInterval", "queueMicrotask",
  // Node globals, for when builders run in the server-side sandbox.
  "process", "require", "module", "Buffer", "global", "__dirname", "__filename",
];

export const LIMITS = { trianglesWarn: 150_000, trianglesError: 600_000, envelopeWarn: 1.5, envelopeError: 3 };

/** Compile Kimi's builder body into a function of (THREE, kit). */
export function compile(code: string): (three: typeof THREE, k: typeof kit) => unknown {
  const fn = new Function("THREE", "kit", ...BLOCKED, `"use strict";\n${code}`);
  return (three, k) => fn(three, k, ...BLOCKED.map(() => undefined));
}

function serialiseMaterial(m: THREE.Material | THREE.Material[]): BuiltMesh["material"] {
  const mm = (Array.isArray(m) ? m[0] : m) as THREE.MeshStandardMaterial | undefined;
  const color = mm && "color" in mm && mm.color instanceof THREE.Color ? `#${mm.color.getHexString()}` : "#cccccc";
  return {
    preset: (mm?.userData?.preset as string) ?? "plastic",
    color,
    metalness: typeof mm?.metalness === "number" ? mm.metalness : 0.2,
    roughness: typeof mm?.roughness === "number" ? mm.roughness : 0.6,
    opacity: mm?.transparent ? (mm.opacity ?? 1) : 1,
  };
}

function bake(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): { position: Float32Array; normal: Float32Array; index: Uint32Array | null } {
  const g = geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const out = {
    position: new Float32Array(pos.array as ArrayLike<number>),
    normal: new Float32Array(nor.array as ArrayLike<number>),
    index: g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : null,
  };
  g.dispose();
  return out;
}

/** Flatten an Object3D into world-space meshes with plain arrays (transferable from a worker). */
export function serialise(root: THREE.Object3D): BuiltMesh[] {
  root.updateMatrixWorld(true);
  const meshes: BuiltMesh[] = [];
  const tmp = new THREE.Matrix4();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.geometry?.attributes?.position) return;
    const material = serialiseMaterial(o.material);
    if (o instanceof THREE.InstancedMesh) {
      for (let i = 0; i < Math.min(o.count, 2048); i++) {
        o.getMatrixAt(i, tmp);
        meshes.push({ ...bake(o.geometry, tmp.clone().premultiply(o.matrixWorld)), material });
      }
    } else {
      meshes.push({ ...bake(o.geometry, o.matrixWorld), material });
    }
  });
  return meshes;
}

function triangles(m: BuiltMesh): number {
  return (m.index ? m.index.length : m.position.length / 3) / 3;
}

/** Bounding box over all meshes; null when nothing finite was found. */
export function bounds(meshes: BuiltMesh[]): { min: [number, number, number]; max: [number, number, number] } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const p = m.position;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return Number.isFinite(min[0]) ? { min: min as [number, number, number], max: max as [number, number, number] } : null;
}

/** Run one builder and check what it made. Never throws. */
export function evaluatePart(id: string, code: string, sizeMm: [number, number, number]): BuiltPart {
  const issues: Issue[] = [];
  const fail = (message: string): BuiltPart => ({ id, ok: false, meshes: [], issues: [{ severity: "error", partId: id, message }], triangles: 0 });
  let result: unknown;
  try {
    result = compile(code)(THREE, kit);
  } catch (e) {
    return fail(`builder threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!(result instanceof THREE.Object3D)) return fail("builder must `return` a THREE.Object3D (Mesh or Group)");
  let meshes: BuiltMesh[];
  try {
    meshes = serialise(result);
  } catch (e) {
    return fail(`could not read the geometry: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (meshes.length === 0) return fail("builder returned no meshes");
  for (const m of meshes) {
    for (let i = 0; i < m.position.length; i++) {
      if (!Number.isFinite(m.position[i])) return fail("geometry has NaN or infinite coordinates");
    }
  }
  const tri = meshes.reduce((n, m) => n + triangles(m), 0);
  if (tri === 0) return fail("geometry has no triangles");
  if (tri > LIMITS.trianglesError) return fail(`too heavy: ${tri.toLocaleString()} triangles (limit ${LIMITS.trianglesError.toLocaleString()})`);
  if (tri > LIMITS.trianglesWarn) issues.push({ severity: "warning", partId: id, message: `heavy part: ${tri.toLocaleString()} triangles` });

  const b = bounds(meshes)!;
  const reach = Math.max(...b.min.map((v, k) => Math.abs(v) / (sizeMm[k] / 2 || 1)), ...b.max.map((v, k) => Math.abs(v) / (sizeMm[k] / 2 || 1)));
  if (reach > LIMITS.envelopeError) {
    return fail(`part reaches ${reach.toFixed(1)}× outside the device size ${sizeMm.join("×")} mm; check units (mm) and position`);
  }
  if (reach > LIMITS.envelopeWarn) {
    issues.push({ severity: "warning", partId: id, message: `part sticks out ${reach.toFixed(1)}× past the device size ${sizeMm.join("×")} mm` });
  }
  return { id, ok: true, meshes, issues, triangles: tri, bounds: b };
}
