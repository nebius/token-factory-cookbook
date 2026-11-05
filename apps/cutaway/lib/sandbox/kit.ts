import * as THREE from "three";

/**
 * Helpers handed to Kimi's part builders as `kit`. Units are millimetres, Y is up.
 * Every helper returns plain three.js objects, so Kimi can mix them with raw THREE calls.
 * The prompt documents this API in lib/kimi/kit-doc.ts; keep the two in sync.
 */

export type MatPreset =
  | "steel" | "aluminium" | "metal" | "copper" | "brass" | "gold" | "magnet"
  | "plastic" | "rubber" | "glass" | "silicon" | "ceramic" | "pcb" | "paint" | "carbon" | "fabric";

const PRESETS: Record<MatPreset, { color: string; metalness: number; roughness: number; opacity?: number }> = {
  steel: { color: "#9aa1a8", metalness: 0.9, roughness: 0.35 },
  aluminium: { color: "#c9ced3", metalness: 0.85, roughness: 0.3 },
  metal: { color: "#a7adb3", metalness: 0.85, roughness: 0.4 },
  copper: { color: "#c8743a", metalness: 0.9, roughness: 0.3 },
  brass: { color: "#c9a645", metalness: 0.9, roughness: 0.32 },
  gold: { color: "#e3b94c", metalness: 1, roughness: 0.25 },
  magnet: { color: "#4b5157", metalness: 0.6, roughness: 0.5 },
  plastic: { color: "#e6e4df", metalness: 0, roughness: 0.55 },
  rubber: { color: "#2b2d30", metalness: 0, roughness: 0.9 },
  glass: { color: "#bfe3f2", metalness: 0, roughness: 0.05, opacity: 0.35 },
  silicon: { color: "#3a3f63", metalness: 0.4, roughness: 0.3 },
  ceramic: { color: "#efe9dc", metalness: 0, roughness: 0.4 },
  pcb: { color: "#1f6b45", metalness: 0.1, roughness: 0.6 },
  paint: { color: "#d94b2b", metalness: 0.2, roughness: 0.45 },
  carbon: { color: "#222428", metalness: 0.3, roughness: 0.5 },
  fabric: { color: "#5d6470", metalness: 0, roughness: 1 },
};

export type MatOpts = { color?: string | number; metalness?: number; roughness?: number; opacity?: number };

export function mat(preset: MatPreset | string = "plastic", opts: MatOpts = {}): THREE.MeshStandardMaterial {
  const p = PRESETS[preset as MatPreset] ?? PRESETS.plastic;
  const opacity = opts.opacity ?? p.opacity ?? 1;
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? p.color),
    metalness: opts.metalness ?? p.metalness,
    roughness: opts.roughness ?? p.roughness,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
  m.userData.preset = PRESETS[preset as MatPreset] ? preset : "plastic";
  return m;
}

type Vec = [number, number, number];
const DEG = Math.PI / 180;

export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material | MatPreset | string = "plastic"): THREE.Mesh {
  return new THREE.Mesh(geometry, typeof material === "string" ? mat(material) : material);
}

/** Set position (mm) and rotation (degrees, XYZ order) and return the same object. */
export function at<T extends THREE.Object3D>(obj: T, position: Vec = [0, 0, 0], rotationDeg: Vec = [0, 0, 0]): T {
  obj.position.set(...position);
  obj.rotation.set(rotationDeg[0] * DEG, rotationDeg[1] * DEG, rotationDeg[2] * DEG);
  return obj;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const c of children) if (c) g.add(c);
  return g;
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Cylinder along Y. */
export function cyl(rTop: number, rBottom = rTop, h = 1, segments = 48): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, segments);
}

/** Hollow cylinder (pipe, ring, bearing race) along Y, centred on the origin. */
export function tube(rOuter: number, rInner: number, h: number, segments = 64): THREE.BufferGeometry {
  return lathe(
    [
      [rInner, -h / 2],
      [rOuter, -h / 2],
      [rOuter, h / 2],
      [rInner, h / 2],
      [rInner, -h / 2],
    ],
    segments,
  );
}

/** Revolve a profile of [radius, y] points around Y. */
export function lathe(points: [number, number][], segments = 64): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments);
  g.computeVertexNormals();
  return g;
}

/** Extrude a 2D outline of [x, y] points along +Z by depth. Holes are optional outlines. */
export function extrude(
  outline: [number, number][],
  depth: number,
  opts: { holes?: [number, number][][]; bevel?: number; curveSegments?: number } = {},
): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of opts.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const bevel = opts.bevel ?? 0;
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: opts.curveSegments ?? 24,
  });
}

/** Points on a circle, handy for extrude outlines and holes. */
export function circle(r: number, segments = 48, cx = 0, cy = 0): [number, number][] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });
}

/** Spur gear lying in the XZ plane (axis Y), centred on the origin. */
export function gear(o: { teeth: number; radius: number; thickness: number; toothDepth?: number; bore?: number }): THREE.BufferGeometry {
  const teeth = Math.max(4, Math.round(o.teeth));
  const depth = o.toothDepth ?? o.radius * 0.12;
  const rRoot = o.radius - depth / 2;
  const rTip = o.radius + depth / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    for (const [f, r] of [[0, rRoot], [0.2, rTip], [0.5, rTip], [0.7, rRoot]] as const) {
      const a = a0 + f * step;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const holes = o.bore ? [circle(o.bore, 32).reverse()] : [];
  const g = extrude(pts, o.thickness, { holes });
  g.translate(0, 0, -o.thickness / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Wire wound as a helix around Y (springs, coils). */
export function helix(o: { radius: number; pitch: number; turns: number; wire: number; segmentsPerTurn?: number }): THREE.BufferGeometry {
  const spt = o.segmentsPerTurn ?? 32;
  const n = Math.max(8, Math.round(o.turns * spt));
  const h = o.pitch * o.turns;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = t * o.turns * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * o.radius, t * h - h / 2, Math.sin(a) * o.radius);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, o.wire / 2, 8, false);
}

/** Tube swept along a path of points (wires, pipes, hoses). */
export function sweep(points: Vec[], radius: number, segments = 64): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segments, radius, 10, false);
}

/**
 * A twisted, tapered blade (fan, propeller, turbine, compressor) whose root sits at the
 * origin and which extends along +X. Rotate or array it with kit.radial.
 */
export function blade(o: {
  span: number;
  rootChord: number;
  tipChord?: number;
  thickness?: number;
  twistDeg?: number;
  pitchDeg?: number;
  sweep?: number;
  camber?: number;
}): THREE.BufferGeometry {
  const tip = o.tipChord ?? o.rootChord * 0.7;
  const th = o.thickness ?? Math.max(0.6, o.rootChord * 0.06);
  const twist = (o.twistDeg ?? 20) * DEG;
  const pitch = (o.pitchDeg ?? 30) * DEG;
  const camber = o.camber ?? 0.06;
  const spanSteps = 16;
  const chordSteps = 10;
  const positions: number[] = [];
  const index: number[] = [];
  const ring = chordSteps * 2;
  for (let i = 0; i <= spanSteps; i++) {
    const s = i / spanSteps;
    const x = s * o.span;
    const chord = o.rootChord + (tip - o.rootChord) * s;
    const ang = pitch - twist * s;
    const off = (o.sweep ?? 0) * s;
    const t = th * (1 - 0.5 * s);
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j < chordSteps; j++) {
        const u = side === 0 ? j / (chordSteps - 1) : 1 - j / (chordSteps - 1);
        const c = (u - 0.5) * chord;
        const thick = Math.sin(Math.PI * u) * t * 0.5;
        const camb = Math.sin(Math.PI * u) * camber * chord;
        const y0 = camb + (side === 0 ? thick : -thick);
        const z = c + off;
        positions.push(x, Math.cos(ang) * y0 + Math.sin(ang) * z, -Math.sin(ang) * y0 + Math.cos(ang) * z);
      }
    }
    if (i > 0) {
      const a = (i - 1) * ring;
      const b = i * ring;
      for (let k = 0; k < ring; k++) {
        const k2 = (k + 1) % ring;
        index.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** `count` copies arranged around the Y axis. make(i, angleDeg) returns each copy at its rest pose. */
export function radial(count: number, make: (i: number, angleDeg: number) => THREE.Object3D, radius = 0): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(1, Math.min(512, Math.round(count)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const pivot = new THREE.Group();
    pivot.rotation.y = -a * DEG;
    const child = make(i, a);
    if (radius) child.position.x += radius;
    pivot.add(child);
    g.add(pivot);
  }
  return g;
}

/** `count` copies offset by `step` mm each. */
export function linear(count: number, step: Vec, make: (i: number) => THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(1, Math.min(512, Math.round(count)));
  for (let i = 0; i < n; i++) {
    const child = make(i);
    child.position.x += step[0] * i;
    child.position.y += step[1] * i;
    child.position.z += step[2] * i;
    g.add(child);
  }
  return g;
}

/** A circuit board lying flat (thickness along Y) with chips on top. Positions are board-centred. */
export function pcb(o: {
  w: number;
  d: number;
  t?: number;
  color?: string;
  chips?: { x: number; z: number; w: number; d: number; h?: number; color?: string; preset?: MatPreset }[];
}): THREE.Group {
  const t = o.t ?? 1.6;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(box(o.w, t, o.d), mat("pcb", o.color ? { color: o.color } : {})));
  for (const c of o.chips ?? []) {
    const h = c.h ?? 1;
    const chip = new THREE.Mesh(box(c.w, h, c.d), mat(c.preset ?? "carbon", c.color ? { color: c.color } : {}));
    chip.position.set(c.x, t / 2 + h / 2, c.z);
    g.add(chip);
  }
  return g;
}

/** Deterministic random numbers so a part builds the same way every time. */
export function rand(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const kit = { mat, mesh, at, group, box, cyl, tube, lathe, extrude, circle, gear, helix, sweep, blade, radial, linear, pcb, rand };
export type Kit = typeof kit;
