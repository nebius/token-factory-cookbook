import * as THREE from 'three';
import { diningChairPlacements, FURNITURE_CATALOGUE, itemRect } from './furniture';
import type { FurnitureItem, FurnitureType } from './plan';

/** Shared low-poly geometry and a deliberately small calm material palette. */
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const sphereGeometry = new THREE.SphereGeometry(0.5, 10, 7);
const material = (color: string, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
const M = {
  oak: material('#ad8660'), oakLight: material('#c5a47d'), darkWood: material('#705641'),
  linen: material('#d9d3c3'), cushion: material('#e9e4d7'), sage: material('#81998a'),
  dark: material('#34433e'), metal: material('#89938d', 0.48), white: material('#e9ece5'),
  porcelain: material('#f1f1e9', 0.35), water: new THREE.MeshPhysicalMaterial({ color: '#72b4b0', roughness: 0.16, transparent: true, opacity: 0.82 }),
  leaf: material('#66866b'), leafLight: material('#8ca279'), soil: material('#756b50'), rubber: material('#3e4642'),
  screen: material('#293733', 0.3), car: material('#aeb9b0', 0.3), glass: new THREE.MeshPhysicalMaterial({ color: '#8faeaf', roughness: 0.15, transparent: true, opacity: 0.75 }),
  mat: material('#788f8b'), paper: material('#d4cbb7'),
};
type Group = THREE.Group;
function box(parent: Group, mat: THREE.Material, size: [number, number, number], at: [number, number, number], rotation = 0) {
  const mesh = new THREE.Mesh(boxGeometry, mat); mesh.scale.set(size[0] / 1000, size[1] / 1000, size[2] / 1000); mesh.position.set(at[0] / 1000, at[1] / 1000, at[2] / 1000); mesh.rotation.y = rotation; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(parent: Group, mat: THREE.Material, size: [number, number, number], at: [number, number, number]) {
  const mesh = new THREE.Mesh(cylinderGeometry, mat); mesh.scale.set(size[0] / 1000, size[1] / 1000, size[2] / 1000); mesh.position.set(at[0] / 1000, at[1] / 1000, at[2] / 1000); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function ellipsoid(parent: Group, mat: THREE.Material, size: [number, number, number], at: [number, number, number]) {
  const mesh = new THREE.Mesh(sphereGeometry, mat); mesh.scale.set(size[0] / 1000, size[1] / 1000, size[2] / 1000); mesh.position.set(at[0] / 1000, at[1] / 1000, at[2] / 1000); mesh.castShadow = true; parent.add(mesh); return mesh;
}
function legs(parent: Group, width: number, depth: number, height: number) {
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(parent, M.darkWood, [70, height, 70], [x * (width / 2 - 100), height / 2, z * (depth / 2 - 100)]);
}
function sofa(parent: Group, width: number, depth: number, chair = false) {
  const h = chair ? 430 : 460; box(parent, M.linen, [width, 220, depth], [0, 180, 0]);
  box(parent, M.linen, [width, 550, 190], [0, 390, -depth / 2 + 95]);
  box(parent, M.cushion, [width - (chair ? 100 : 280), 140, depth - 250], [0, h, 50]);
  if (!chair) for (const x of [-1, 1]) box(parent, M.linen, [150, 420, depth], [x * (width / 2 - 75), 300, 0]);
}
function bed(parent: Group, width: number, depth: number, single: boolean) {
  box(parent, M.oak, [width, 320, depth], [0, 190, 0]); box(parent, M.white, [width - 80, 220, depth - 100], [0, 440, 20]);
  box(parent, M.sage, [width - 70, 80, depth * 0.62], [0, 580, depth * 0.16]);
  box(parent, M.oakLight, [width, 850, 100], [0, 480, -depth / 2 + 45]);
  const pillowWidth = single ? width - 220 : width / 2 - 160;
  for (const x of single ? [0] : [-1, 1]) box(parent, M.cushion, [pillowWidth, 120, 390], [x * (single ? 0 : width / 4), 580, -depth / 2 + 310]);
}
function table(parent: Group, width: number, depth: number, height = 740) {
  box(parent, M.oakLight, [width, 90, depth], [0, height, 0]); legs(parent, width, depth, height);
}
function storage(parent: Group, width: number, depth: number, height: number, shelves = false) {
  box(parent, M.oak, [width, height, depth], [0, height / 2, 0]);
  if (shelves) for (let y = 300; y < height; y += 400) box(parent, M.darkWood, [width - 100, 35, depth + 15], [0, y, 15]);
  else for (const x of [-1, 1]) box(parent, M.oakLight, [width / 2 - 20, height - 80, 25], [x * width / 4, height / 2, depth / 2 + 15]);
}
function chairInstances(parent: Group, tableWidth: number, tableDepth: number, seatCount = 6) {
  const seats = new THREE.InstancedMesh(boxGeometry, M.linen, seatCount), backs = new THREE.InstancedMesh(boxGeometry, M.oak, seatCount);
  seats.name = `Dining seats (${seatCount})`; backs.name = `Dining chair backs (${seatCount})`;
  const dummy = new THREE.Object3D(); let index = 0;
  const placements = diningChairPlacements(tableWidth, tableDepth, seatCount);
  for (const { x, y: z, rotation: degrees } of placements) {
    const rotation = degrees * Math.PI / 180;
    dummy.position.set(x / 1000, 0.46, z / 1000); dummy.rotation.set(0, rotation, 0); dummy.scale.set(0.48, 0.12, 0.48); dummy.updateMatrix(); seats.setMatrixAt(index, dummy.matrix);
    const backX = x + Math.sin(rotation) * 210, backZ = z + Math.cos(rotation) * 210;
    dummy.position.set(backX / 1000, 0.77, backZ / 1000); dummy.scale.set(0.48, 0.58, 0.08); dummy.updateMatrix(); backs.setMatrixAt(index, dummy.matrix); index++;
  }
  seats.castShadow = backs.castShadow = true; parent.add(seats, backs);
}
function plumbing(parent: Group, width: number, depth: number, bath: boolean) {
  if (bath) {
    box(parent, M.porcelain, [width, 520, depth], [0, 300, 0]);
    box(parent, M.water, [width - 180, 30, depth - 190], [0, 560, 0]);
    cylinder(parent, M.metal, [45, 360, 45], [width / 2 - 120, 700, -depth / 2 + 100]);
  } else {
    ellipsoid(parent, M.porcelain, [width, 450, depth * 0.72], [0, 390, depth * 0.1]);
    box(parent, M.porcelain, [width * 0.82, 650, depth * 0.35], [0, 410, -depth * 0.31]);
    box(parent, M.white, [width * 0.75, 45, depth * 0.6], [0, 620, depth * 0.08]);
  }
}
function plant(parent: Group, width: number, depth: number, tree: boolean) {
  const pot = Math.min(width, depth) * (tree ? 0.36 : 0.58), height = FURNITURE_CATALOGUE[tree ? 'tree' : 'plant'].height;
  cylinder(parent, M.oak, [pot, tree ? 500 : 360, pot], [0, tree ? 250 : 180, 0]);
  cylinder(parent, M.soil, [pot * 0.85, 25, pot * 0.85], [0, tree ? 505 : 365, 0]);
  cylinder(parent, M.darkWood, [tree ? 150 : 55, height * 0.68, tree ? 150 : 55], [0, height * 0.38, 0]);
  const count = tree ? 8 : 6, leaves = new THREE.InstancedMesh(sphereGeometry, M.leaf, count), dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2, radius = tree ? width * 0.26 : width * 0.22;
    dummy.position.set(Math.cos(angle) * radius / 1000, (tree ? 2600 + (i % 3) * 300 : 650 + (i % 3) * 140) / 1000, Math.sin(angle) * radius / 1000);
    const size = tree ? Math.min(width, depth) * 0.55 : width * 0.7; dummy.scale.set(size / 1000, (tree ? size : size * 0.5) / 1000, size / 1000); dummy.rotation.set(0, angle, 0); dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
  }
  leaves.castShadow = true; parent.add(leaves);
}
function gymBike(parent: Group) {
  cylinder(parent, M.metal, [70, 650, 70], [0, 430, -380]); cylinder(parent, M.metal, [70, 850, 70], [0, 550, 320]);
  box(parent, M.dark, [500, 110, 350], [0, 780, -200]); box(parent, M.metal, [600, 60, 70], [0, 1050, 350]);
  const wheel = cylinder(parent, M.rubber, [600, 130, 600], [0, 390, 300]); wheel.rotation.z = Math.PI / 2;
  box(parent, M.metal, [650, 60, 70], [0, 450, 220]);
}
function car(parent: Group, width: number, depth: number) {
  box(parent, M.car, [width, 650, depth], [0, 650, 0]); box(parent, M.car, [width * 0.84, 600, depth * 0.52], [0, 1220, -depth * 0.03]);
  box(parent, M.glass, [width * 0.74, 380, depth * 0.44], [0, 1270, -depth * 0.03]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) { const wheel = cylinder(parent, M.rubber, [650, 250, 650], [x * width / 2, 450, z * depth * 0.3]); wheel.rotation.z = Math.PI / 2; }
  for (const x of [-1, 1]) box(parent, M.cushion, [width * 0.28, 120, 50], [x * width * 0.28, 720, depth / 2 + 20]);
}

export type FurnitureBuilder = (parent: Group, width: number, depth: number, seats?: number) => void;
export const FURNITURE_BUILDERS: Record<FurnitureType, FurnitureBuilder> = {
  bed_double: (p, w, d) => bed(p, w, d, false),
  bed_single: (p, w, d) => bed(p, w, d, true),
  nightstand: (p, w, d) => { storage(p, w, d, 500); box(p, M.dark, [40, 60, 30], [0, 390, d / 2 + 20]); },
  wardrobe: (p, w, d) => storage(p, w, d, 2200),
  sofa: (p, w, d) => sofa(p, w, d),
  armchair: (p, w, d) => sofa(p, w, d, true),
  coffee_table: (p, w, d) => table(p, w, d, 390),
  tv_unit: (p, w, d) => { storage(p, w, d, 520); box(p, M.dark, [w * 0.75, 850, 80], [0, 990, -d * 0.22]); box(p, M.screen, [w * 0.70, 760, 20], [0, 995, -d * 0.22 + 50]); },
  dining_table: (p, w, d, seats) => { table(p, w * 0.78, d * 0.47); chairInstances(p, w * 0.78, d, seats); },
  kitchen_run: (p, w, d) => { storage(p, w, d, 850); box(p, M.white, [w, 70, d + 30], [0, 900, 0]); box(p, M.dark, [w * 0.25, 30, d * 0.55], [-w * 0.23, 945, 0]); for (const x of [-1, 1]) cylinder(p, M.metal, [100, 25, 100], [x * 100 + w * 0.25, 955, 0]); },
  kitchen_island: (p, w, d) => { storage(p, w, d, 850); box(p, M.white, [w + 60, 80, d + 60], [0, 900, 0]); },
  fridge: (p, w, d) => { box(p, M.metal, [w, 1900, d], [0, 950, 0]); box(p, M.white, [30, 900, 35], [-w * 0.3, 1200, d / 2 + 20]); },
  toilet: (p, w, d) => plumbing(p, w, d, false),
  basin_vanity: (p, w, d) => { storage(p, w, d, 800); ellipsoid(p, M.porcelain, [w * 0.82, 160, d * 0.75], [0, 850, 0]); cylinder(p, M.metal, [45, 300, 45], [0, 1050, -d * 0.25]); },
  bathtub: (p, w, d) => plumbing(p, w, d, true),
  shower: (p, w, d) => { box(p, M.porcelain, [w, 90, d], [0, 45, 0]); box(p, M.glass, [w, 2050, 20], [0, 1100, d / 2]); box(p, M.glass, [20, 2050, d], [w / 2, 1100, 0]); cylinder(p, M.metal, [55, 2050, 55], [-w * 0.3, 1080, -d * 0.3]); },
  desk: (p, w, d) => { table(p, w, d); box(p, M.dark, [w * 0.45, 350, 50], [0, 1150, -d * 0.2]); box(p, M.paper, [w * 0.3, 15, d * 0.4], [w * 0.2, 815, 0]); },
  bookshelf: (p, w, d) => storage(p, w, d, 2000, true),
  washer: (p, w, d) => { box(p, M.white, [w, 900, d], [0, 450, 0]); const drum = cylinder(p, M.dark, [w * 0.6, 50, w * 0.6], [0, 470, d / 2 + 25]); drum.rotation.x = Math.PI / 2; cylinder(p, M.metal, [w * 0.78, 30, w * 0.78], [0, 470, d / 2 + 5]).rotation.x = Math.PI / 2; },
  car: (p, w, d) => car(p, w, d),
  plant: (p, w, d) => plant(p, w, d, false),
  tree: (p, w, d) => plant(p, w, d, true),
  gym_bike: (p) => gymBike(p),
  yoga_mat: (p, w, d) => box(p, M.mat, [w, 15, d], [0, 8, 0]),
  lounger: (p, w, d) => { box(p, M.oak, [w, 300, d], [0, 300, 0]); box(p, M.cushion, [w - 60, 100, d * 0.66], [0, 500, d * 0.15]); const back = box(p, M.cushion, [w - 60, 90, d * 0.4], [0, 720, -d * 0.31]); back.rotation.x = -0.55; },
};

export function buildFurnitureItem(item: FurnitureItem) {
  const definition = FURNITURE_CATALOGUE[item.type], [width, depth] = item.size ?? [definition.width, definition.depth];
  const root = new THREE.Group(); root.name = `${item.id} (${item.type})`; root.userData = { furniture: true, furnitureId: item.id, furnitureType: item.type, source: item.source, seats: item.seats, blocking: definition.collision, footprint: itemRect(item).corners };
  FURNITURE_BUILDERS[item.type](root, width, depth, item.seats);
  root.position.set(item.position[0] / 1000, 0, -item.position[1] / 1000); root.rotation.y = item.rotation * Math.PI / 180;
  return root;
}
