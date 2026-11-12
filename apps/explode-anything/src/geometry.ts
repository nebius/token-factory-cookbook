import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function box(w: number, h: number, d: number, material: THREE.Material, r = 0.06, pos = [0, 0, 0]) {
  const safeRadius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, safeRadius)), material);
  mesh.position.set(...pos as [number, number, number]);
  return mesh;
}

export function cylinder(rt: number, rb: number, height: number, material: THREE.Material, pos = [0, 0, 0], segments = 64, axis: 'x' | 'y' | 'z' = 'z') {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, height, segments), material);
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  mesh.position.set(...pos as [number, number, number]);
  return mesh;
}

export function rectFrame(w: number, h: number, innerW: number, innerH: number, depth: number, material: THREE.Material, pos = [0, 0, 0], radius = 0.08) {
  const shape = new THREE.Shape();
  roundedRectPath(shape, -w / 2, -h / 2, w, h, radius);
  const hole = new THREE.Path();
  roundedRectPath(hole, -innerW / 2, -innerH / 2, innerW, innerH, Math.min(radius * 0.5, innerW / 4, innerH / 4));
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: Math.min(0.025, depth * 0.2), bevelThickness: Math.min(0.018, depth * 0.2), curveSegments: 12 });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...pos as [number, number, number]);
  return mesh;
}

/** Closed biconvex lens surface: radial profile revolved around the optical axis. */
export function opticalElement(radius: number, thickness: number, material: THREE.Material) {
  const profile: THREE.Vector2[] = [];
  const edge = thickness * 0.16;
  const segments = 18;
  for (let i = 0; i <= segments; i++) {
    const r = radius * i / segments;
    const sag = thickness * 0.52 * (1 - (r / radius) ** 2);
    profile.push(new THREE.Vector2(r, edge + sag));
  }
  for (let i = segments; i >= 0; i--) {
    const r = radius * i / segments;
    const sag = thickness * 0.34 * (1 - (r / radius) ** 2);
    profile.push(new THREE.Vector2(r, -edge - sag));
  }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

export function ring(outer: number, inner: number, depth: number, material: THREE.Material, pos = [0, 0, 0], segments = 96) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.014, bevelThickness: 0.014, curveSegments: segments / 2 });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...pos as [number, number, number]);
  return mesh;
}

export function lathe(profile: [number, number][], material: THREE.Material, segments = 96) {
  const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, segments), material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

export function torus(radius: number, tube: number, material: THREE.Material, pos = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 96), material);
  mesh.position.set(...pos as [number, number, number]);
  return mesh;
}

export function roundedRectPath(shape: THREE.Shape | THREE.Path, x: number, y: number, w: number, h: number, r: number) {
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
}

export function shell(w: number, h: number, d: number, opening: { x: number; y: number; r: number }, material: THREE.Material) {
  const shape = new THREE.Shape();
  roundedRectPath(shape, -w / 2, -h / 2, w, h, 0.22);
  const hole = new THREE.Path();
  hole.absarc(opening.x, opening.y, opening.r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 4, curveSegments: 36 });
  geometry.translate(0, 0, -d / 2);
  return new THREE.Mesh(geometry, material);
}

export function hull(w: number, h: number, d: number, material: THREE.Material) {
  const shape = new THREE.Shape();
  roundedRectPath(shape, -w / 2, -h / 2, w, h, 0.16);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.035, bevelSegments: 3 });
  geo.translate(0, 0, -d / 2);
  const mesh = new THREE.Mesh(geo, material);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({ color: '#655f51', transparent: true, opacity: 0.36 }));
  mesh.add(edges);
  return mesh;
}

export function textPlane(text: string, width: number, height: number, options: { color?: string; fontSize?: number; align?: CanvasTextAlign; background?: string } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(64, Math.round(1024 * height / width));
  const ctx = canvas.getContext('2d')!;
  if (options.background) { ctx.fillStyle = options.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.fillStyle = options.color ?? '#ddd9ce';
  ctx.font = `500 ${options.fontSize ?? Math.round(canvas.height * 0.58)}px Arial, sans-serif`;
  ctx.textAlign = options.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, ctx.textAlign === 'center' ? canvas.width / 2 : 8, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  return mesh;
}

export function gripTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#898989'; ctx.fillRect(0, 0, 192, 192);
  // A staggered, irregular pebble grain stays legible at the hero camera distance.
  for (let y = 0; y < 192; y += 7) for (let x = 0; x < 192; x += 7) {
    const n = ((x * 13 + y * 71) % 41) / 41;
    const shade = Math.round(100 + n * 82);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.beginPath();
    ctx.ellipse(x + (Math.floor(y / 7) % 2 ? 3 : 0), y, 1.5 + n * 0.55, 1.25 + n * 0.45, n * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.5, 3.5);
  return texture;
}

export function brushedTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(256, 256);
  // Deterministic seeded noise so the exhibit looks the same on every visit.
  let seed = 439;
  for (let y = 0; y < 256; y++) {
    const row = 130 + ((y * 17) % 57);
    for (let x = 0; x < 256; x++) {
      seed = (seed * 16807) % 2147483647;
      const c = Math.min(230, row + (seed % 32));
      const i = (y * 256 + x) * 4;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = c;
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  return texture;
}

export function screw(material: THREE.Material, dark: THREE.Material, scale = 0.46) {
  const root = new THREE.Group();
  // At the ~130 mm body scale, a 0.46 head is about 1.7 mm across.
  const head = cylinder(0.065 * scale, 0.058 * scale, 0.025 * scale, material, [0, 0, -0.019 * scale], 32);
  root.add(head);
  const cap = new THREE.Shape();
  cap.absarc(0, 0, 0.065 * scale, 0, Math.PI * 2, false);
  const arm = 0.011 * scale;
  const reach = 0.043 * scale;
  const recess = new THREE.Path();
  const points = [
    [-arm, -reach], [arm, -reach], [arm, -arm], [reach, -arm],
    [reach, arm], [arm, arm], [arm, reach], [-arm, reach],
    [-arm, arm], [-reach, arm], [-reach, -arm], [-arm, -arm],
  ];
  points.forEach(([x, y], i) => i ? recess.lineTo(x, y) : recess.moveTo(x, y));
  recess.closePath();
  cap.holes.push(recess);
  const faceGeometry = new THREE.ExtrudeGeometry(cap, {
    depth: 0.007 * scale, bevelEnabled: false, curveSegments: 12,
  });
  faceGeometry.translate(0, 0, -0.007 * scale);
  // The cross is cut into the metal face, not drawn on top as a sticker.
  root.add(new THREE.Mesh(faceGeometry, [material, dark]));
  const crossFloor = new THREE.Shape();
  points.forEach(([x, y], i) => i ? crossFloor.lineTo(x, y) : crossFloor.moveTo(x, y));
  crossFloor.closePath();
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(crossFloor), dark);
  floor.position.z = -0.0055 * scale;
  root.add(floor);
  root.add(cylinder(0.026 * scale, 0.026 * scale, 0.12 * scale, material, [0, 0, -0.065 * scale], 16));
  return root;
}

export function pcbTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 640;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f4136'; ctx.fillRect(0, 0, 1024, 640);
  let seed = 223;
  const rand = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  ctx.strokeStyle = '#65875a'; ctx.lineWidth = 2;
  for (let i = 0; i < 90; i++) {
    const x = rand() * 1024, y = rand() * 640;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 260, y);
    ctx.lineTo(x + (rand() - 0.5) * 260, y + (rand() - 0.5) * 220);
    ctx.lineTo(x + (rand() - 0.5) * 220, y + (rand() - 0.5) * 220);
    ctx.stroke();
    ctx.fillStyle = '#c2a762'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = '#74906e';
    ctx.fillRect(rand() * 1010, rand() * 630, 5 + rand() * 15, 3 + rand() * 7);
  }
  ctx.font = '14px monospace'; ctx.fillStyle = '#d5d0a0'; ctx.fillText('EA / DIGITAL ENGINE', 28, 605); ctx.fillText('REV 01  •  CONCEPT', 28, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#303336');
  const panels = [
    { p: [6, 7, 8], s: [8, 10], c: '#fff6e4', power: 4.0 },
    { p: [-7, 3, 3], s: [5, 8], c: '#d5e6ff', power: 3.5 },
    { p: [0, 9, -6], s: [9, 5], c: '#ffffff', power: 3.5 },
    { p: [-4, -1, 8], s: [3, 2], c: '#ead3af', power: 2.0 },
  ];
  for (const { p, s, c, power } of panels) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(power), side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(s[0], s[1]), material);
    panel.position.set(...p as [number, number, number]); panel.lookAt(0, 0, 0);
    scene.add(panel);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.035, 0.1, 100);
  scene.traverse(o => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  });
  generator.dispose();
  return target;
}
