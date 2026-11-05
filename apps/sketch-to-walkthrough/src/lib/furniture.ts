import { furnitureSchema, FURNITURE_TYPES, roomCenter, type FurnitureItem, type FurnitureType, type PlanSpec } from './plan';

export type FurnitureDefinition = { width: number; depth: number; height: number; collision: boolean };
export const FURNITURE_CATALOGUE: Record<FurnitureType, FurnitureDefinition> = {
  bed_double: { width: 1700, depth: 2150, height: 650, collision: true },
  bed_single: { width: 1050, depth: 2150, height: 650, collision: true },
  nightstand: { width: 500, depth: 450, height: 550, collision: true },
  wardrobe: { width: 1400, depth: 650, height: 2200, collision: true },
  sofa: { width: 2300, depth: 950, height: 850, collision: true },
  armchair: { width: 950, depth: 950, height: 850, collision: true },
  coffee_table: { width: 1200, depth: 650, height: 430, collision: true },
  tv_unit: { width: 1800, depth: 450, height: 600, collision: true },
  dining_table: { width: 2400, depth: 2000, height: 760, collision: true },
  kitchen_run: { width: 2600, depth: 680, height: 920, collision: true },
  kitchen_island: { width: 1900, depth: 950, height: 920, collision: true },
  fridge: { width: 800, depth: 780, height: 1900, collision: true },
  toilet: { width: 700, depth: 780, height: 800, collision: true },
  basin_vanity: { width: 950, depth: 580, height: 900, collision: true },
  bathtub: { width: 1750, depth: 850, height: 600, collision: true },
  shower: { width: 1000, depth: 1000, height: 2200, collision: true },
  desk: { width: 1450, depth: 750, height: 760, collision: true },
  bookshelf: { width: 1400, depth: 380, height: 2000, collision: true },
  washer: { width: 700, depth: 750, height: 900, collision: true },
  car: { width: 2000, depth: 4700, height: 1500, collision: true },
  plant: { width: 600, depth: 600, height: 1100, collision: true },
  tree: { width: 1800, depth: 1800, height: 3600, collision: true },
  gym_bike: { width: 700, depth: 1300, height: 1250, collision: true },
  yoga_mat: { width: 750, depth: 1900, height: 15, collision: false },
  lounger: { width: 800, depth: 2000, height: 650, collision: true },
};

export type Point = [number, number];
export type Rect = { item: FurnitureItem; corners: Point[]; axes: Point[]; width: number; depth: number };
const EPS = 1;
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Point, n: number): Point => [a[0] * n, a[1] * n];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function itemDimensions(item: Pick<FurnitureItem, 'type' | 'size'>): [number, number] {
  const definition = FURNITURE_CATALOGUE[item.type];
  return item.size ?? [definition.width, definition.depth];
}

export type DiningChairPlacement = { x: number; y: number; rotation: number };
export function diningChairPlacements(tableWidth: number, footprintDepth: number, seats = 6): DiningChairPlacement[] {
  const endCount = seats >= 4 ? 2 : 0, sideSeats = seats - endCount;
  const sideClearance = endCount ? Math.min(560, tableWidth * 0.30) : 0;
  const half = Math.max(0, tableWidth / 2 - sideClearance);
  const placements: DiningChairPlacement[] = [];
  for (const side of [-1, 1]) {
    const count = side < 0 ? Math.ceil(sideSeats / 2) : Math.floor(sideSeats / 2);
    for (let i = 0; i < count; i++) placements.push({
      x: count === 1 ? 0 : -half + i * half * 2 / (count - 1),
      y: side * (footprintDepth / 2 - Math.min(220, footprintDepth * 0.11)),
      rotation: side > 0 ? 0 : 180,
    });
  }
  if (endCount) for (const side of [-1, 1]) placements.push({ x: side * (tableWidth / 2 - Math.min(220, tableWidth * 0.12)), y: 0, rotation: side > 0 ? -90 : 90 });
  return placements;
}

export function itemRect(item: FurnitureItem): Rect {
  const [width, depth] = itemDimensions(item);
  const angle = item.rotation * Math.PI / 180;
  const x: Point = [Math.cos(angle), Math.sin(angle)], y: Point = [-Math.sin(angle), Math.cos(angle)];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => add(item.position, add(scale(x, sx * width / 2), scale(y, sy * depth / 2))));
  return { item, corners, axes: [x, y], width, depth };
}

function cross(a: Point, b: Point, c: Point) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
export function pointOnSegment(p: Point, a: Point, b: Point) {
  return Math.abs(cross(a, b, p)) <= EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
export function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const l2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  if (!l2) return distance(p, a);
  const t = clamp(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2, 0, 1);
  return distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}
export function pointInPolygon(point: Point, polygon: Point[], includeBoundary = true) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (pointOnSegment(point, a, b)) return includeBoundary;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function polygonArea(polygon: Point[]) {
  return Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
}
export function polygonsIntersect(a: Point[], b: Point[]) {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const axis: Point = [-(q[1] - p[1]), q[0] - p[0]];
    const pa = a.map((v) => dot(v, axis)), pb = b.map((v) => dot(v, axis));
    if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS) return false;
  }
  return true;
}
function polygonBoundaryDistance(point: Point, polygon: Point[]) {
  return Math.min(...polygon.map((a, i) => pointSegmentDistance(point, a, polygon[(i + 1) % polygon.length])));
}

export function furnitureInsideRoom(item: FurnitureItem, room: PlanSpec['rooms'][number]) {
  const rect = itemRect(item), polygon = room.polygon as Point[];
  if (!pointInPolygon(item.position, polygon) || !rect.corners.every((p) => pointInPolygon(p, polygon))) return false;
  return rect.corners.every((p, i) => {
    const q = rect.corners[(i + 1) % rect.corners.length];
    for (let step = 1; step < 8; step++) if (!pointInPolygon([p[0] + (q[0] - p[0]) * step / 8, p[1] + (q[1] - p[1]) * step / 8], polygon)) return false;
    return true;
  });
}

function wallSpace(wall: PlanSpec['walls'][number], offset: number, normalOffset = 0): Point {
  const length = distance(wall.a, wall.b), tangent: Point = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
  return [wall.a[0] + tangent[0] * offset - tangent[1] * normalOffset, wall.a[1] + tangent[1] * offset + tangent[0] * normalOffset];
}

export function openingClearPolygons(plan: PlanSpec) {
  return plan.openings.filter((o) => o.type !== 'window' && plan.walls.some((wall) => wall.id === o.wallId && distance(wall.a, wall.b) > EPS)).map((opening) => {
    const wall = plan.walls.find((w) => w.id === opening.wallId)!;
    const length = distance(wall.a, wall.b), normal: Point = [-(wall.b[1] - wall.a[1]) / length, (wall.b[0] - wall.a[0]) / length];
    const reach = wall.thickness / 2 + 450;
    return {
      opening,
      polygon: [
        wallSpace(wall, opening.offset, -reach), wallSpace(wall, opening.offset + opening.width, -reach),
        wallSpace(wall, opening.offset + opening.width, reach), wallSpace(wall, opening.offset, reach),
      ],
      normal,
    };
  });
}

export function doorSwingPolygons(plan: PlanSpec) {
  return plan.openings.filter((o) => o.type === 'door' && o.swing && plan.walls.some((wall) => wall.id === o.wallId && distance(wall.a, wall.b) > EPS)).map((opening) => {
    const wall = plan.walls.find((w) => w.id === opening.wallId)!;
    const length = distance(wall.a, wall.b), tangent: Point = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
    const normal: Point = [-tangent[1] * (opening.swing === 'right' ? -1 : 1), tangent[0] * (opening.swing === 'right' ? -1 : 1)];
    const hinge = wallSpace(wall, opening.offset);
    const points: Point[] = [hinge];
    for (let i = 0; i <= 12; i++) {
      const angle = i / 12 * Math.PI / 2;
      points.push(add(hinge, add(scale(tangent, Math.cos(angle) * opening.width), scale(normal, Math.sin(angle) * opening.width))));
    }
    return { opening, polygon: points };
  });
}

export function furnitureClearOfOpenings(item: FurnitureItem, plan: PlanSpec) {
  const rect = itemRect(item);
  return !openingClearPolygons(plan).some((zone) => polygonsIntersect(rect.corners, zone.polygon)) &&
    !doorSwingPolygons(plan).some((zone) => polygonsIntersect(rect.corners, zone.polygon));
}

export type FurnitureIssue = { itemId: string; roomId?: string; message: string };
export function checkFurnitureGeometry(plan: PlanSpec): FurnitureIssue[] {
  const issues: FurnitureIssue[] = [], roomById = new Map(plan.rooms.map((r) => [r.id, r])), seen = new Set<string>();
  const structuralIds = new Set([...plan.walls.map((w) => w.id), ...plan.rooms.map((r) => r.id), ...plan.openings.map((o) => o.id)]);
  for (const item of plan.furniture) {
    const result = furnitureSchema.safeParse(item);
    if (!result.success) { issues.push({ itemId: item.id, message: 'invalid catalogue item or dimensions.' }); continue; }
    if (seen.has(item.id) || structuralIds.has(item.id)) issues.push({ itemId: item.id, message: 'ID must be unique across the plan.' });
    seen.add(item.id);
    const room = roomById.get(item.roomId);
    if (!room) { issues.push({ itemId: item.id, message: `references missing room ${item.roomId}.` }); continue; }
    if (!furnitureInsideRoom(item, room)) issues.push({ itemId: item.id, roomId: room.id, message: `is not fully inside ${room.name}.` });
    if (!furnitureClearOfOpenings(item, plan)) issues.push({ itemId: item.id, roomId: room.id, message: `intersects a door swing or opening clear width in ${room.name}.` });
  }
  for (let i = 0; i < plan.furniture.length; i++) for (let j = i + 1; j < plan.furniture.length; j++) {
    const a = plan.furniture[i], b = plan.furniture[j];
    if (a.roomId === b.roomId && polygonsIntersect(itemRect(a).corners, itemRect(b).corners)) issues.push({ itemId: `${a.id} / ${b.id}`, roomId: a.roomId, message: `overlap in ${roomById.get(a.roomId)?.name ?? a.roomId}.` });
  }
  return issues;
}

function roomDoors(room: PlanSpec['rooms'][number], plan: PlanSpec) {
  const polygon = room.polygon as Point[];
  return openingClearPolygons(plan).filter(({ opening, polygon: zone }) => {
    const wall = plan.walls.find((w) => w.id === opening.wallId)!;
    const mid = wallSpace(wall, opening.offset + opening.width / 2);
    return [200, 400, 650].some((reach) => [1, -1].some((sign) => pointInPolygon([mid[0] + (-(wall.b[1] - wall.a[1]) / distance(wall.a, wall.b)) * reach * sign, mid[1] + ((wall.b[0] - wall.a[0]) / distance(wall.a, wall.b)) * reach * sign], polygon))) && polygonsIntersect(zone, polygon);
  });
}

function navigable(point: Point, room: PlanSpec['rooms'][number], items: FurnitureItem[]) {
  const polygon = room.polygon as Point[];
  if (!pointInPolygon(point, polygon, false) || polygonBoundaryDistance(point, polygon) < 300) return false;
  return !items.some((item) => {
    if (!FURNITURE_CATALOGUE[item.type].collision) return false;
    const padded = { ...item, size: itemDimensions(item).map((n) => n + 600) as [number, number] };
    return pointInPolygon(point, itemRect(padded).corners);
  });
}

/** Flood-fill a 200 mm grid after expanding blocking furniture and walls by 300 mm. */
export function roomHasDoorPaths(room: PlanSpec['rooms'][number], plan: PlanSpec) {
  const items = plan.furniture.filter((f) => f.roomId === room.id), doors = roomDoors(room, plan);
  if (!items.length || !doors.length) return true;
  const polygon = room.polygon as Point[], xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), step = 200;
  const cols = Math.floor((maxX - minX) / step) + 1, rows = Math.floor((maxY - minY) / step) + 1;
  const nodes: Point[] = [], keys = new Map<string, number>();
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    const point: Point = [minX + x * step, minY + y * step];
    if (navigable(point, room, items)) { keys.set(`${x},${y}`, nodes.length); nodes.push(point); }
  }
  if (!nodes.length) return false;
  const nearest = (target: Point) => nodes.reduce((best, p, index) => distance(p, target) < distance(nodes[best], target) ? index : best, 0);
  const anchor = roomCenter(polygon), start = nearest(anchor), reached = new Set([start]), queue = [start];
  while (queue.length) {
    const index = queue.shift()!, point = nodes[index];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = keys.get(`${Math.round((point[0] - minX) / step) + dx},${Math.round((point[1] - minY) / step) + dy}`);
      if (next !== undefined && !reached.has(next)) { reached.add(next); queue.push(next); }
    }
  }
  return doors.every(({ opening }) => {
    const wall = plan.walls.find((w) => w.id === opening.wallId)!;
    const door = wallSpace(wall, opening.offset + opening.width / 2);
    const index = nearest(door);
    return distance(nodes[index], door) <= 1300 && reached.has(index);
  });
}

function roomTypes(room: PlanSpec['rooms'][number]): FurnitureType[] {
  const name = room.name.toLowerCase(), area = polygonArea(room.polygon as Point[]) / 1e6;
  if (/garage/.test(name)) {
    const xs = room.polygon.map((p) => p[0]), count = Math.max(1, Math.floor((Math.max(...xs) - Math.min(...xs)) / 2800));
    return Array.from({ length: Math.min(3, count) }, () => 'car');
  }
  if (/courtyard/.test(name)) return ['tree', 'plant', 'plant'];
  if (/terrace|patio/.test(name)) return area > 15 ? ['dining_table', 'sofa', 'coffee_table'] : ['lounger'];
  if (/pool/.test(name)) return [];
  if (/garden|lawn/.test(name)) return ['tree', 'plant'];
  if (/bath|ensuite|ensuite|shower/.test(name)) return ['bathtub', 'toilet', 'basin_vanity'];
  if (/powder|\bwc\b|toilet/.test(name)) return ['toilet', 'basin_vanity'];
  if (/laundry|mudroom/.test(name)) return ['washer', 'basin_vanity'];
  if (/dressing|closet|wardrobe/.test(name)) return ['wardrobe', 'wardrobe'];
  if (/utility|storage|pantry/.test(name)) return ['bookshelf'];
  if (/kitchen/.test(name)) return ['kitchen_run', 'fridge', ...(area >= 14 ? ['kitchen_island' as const] : [])];
  if (/dining/.test(name)) return ['dining_table'];
  if (/bedroom|bed\s*0|primary suite|guest bed/.test(name)) return ['bed_double', 'nightstand', 'nightstand', 'wardrobe'];
  if (/study|library|office/.test(name)) return ['desk', 'bookshelf', 'armchair'];
  if (/gym|yoga/.test(name)) return ['gym_bike', 'yoga_mat', 'yoga_mat'];
  if (/media|living|great room|lounge/.test(name)) return ['sofa', 'coffee_table', 'tv_unit', 'armchair'];
  return [];
}

function candidatePositions(room: PlanSpec['rooms'][number], item: FurnitureItem) {
  const [width, depth] = itemDimensions(item), polygon = room.polygon as Point[];
  const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, positions: FurnitureItem[] = [];
  for (const rotation of [0, 90, 180, 270]) {
    const rotated = rotation % 180 !== 0, w = rotated ? depth : width, d = rotated ? width : depth;
    if (w >= maxX - minX || d >= maxY - minY) continue;
    const points: Point[] = [
      [cx, cy], [minX + w / 2, cy], [maxX - w / 2, cy], [cx, minY + d / 2], [cx, maxY - d / 2],
      [minX + w / 2, minY + d / 2], [maxX - w / 2, minY + d / 2], [minX + w / 2, maxY - d / 2], [maxX - w / 2, maxY - d / 2],
    ];
    for (const position of points) positions.push({ ...item, position, rotation });
  }
  return positions;
}

/** Adds only non-conflicting defaults. Every accepted item is rechecked, including 600 mm paths. */
export function autoFurnish(plan: PlanSpec): PlanSpec {
  const furnished: PlanSpec = { ...structuredClone(plan), furniture: plan.furniture.filter((f) => f.source === 'sketch').map((f) => ({ ...f, source: 'sketch' as const })) };
  const usedIds = new Set([...furnished.walls.map((w) => w.id), ...furnished.rooms.map((r) => r.id), ...furnished.openings.map((o) => o.id), ...furnished.furniture.map((f) => f.id)]);
  for (const room of furnished.rooms) {
    if (furnished.furniture.some((f) => f.roomId === room.id)) continue;
    for (const type of roomTypes(room)) {
      let serial = furnished.furniture.filter((f) => f.roomId === room.id && f.type === type).length + 1;
      let id = `auto_${room.id.slice(0, 60)}_${type}_${serial}`;
      while (usedIds.has(id)) { serial += 1; id = `auto_${room.id.slice(0, 60)}_${type}_${serial}`; }
      usedIds.add(id);
      const item = furnitureSchema.parse({ id, roomId: room.id, type, position: roomCenter(room.polygon), rotation: 0, source: 'auto' });
      let placed = false;
      for (const candidate of candidatePositions(room, item)) {
        if (!furnitureInsideRoom(candidate, room) || !furnitureClearOfOpenings(candidate, furnished)) continue;
        if (furnished.furniture.some((other) => other.roomId === room.id && polygonsIntersect(itemRect(candidate).corners, itemRect(other).corners))) continue;
        const trial = { ...furnished, furniture: [...furnished.furniture, candidate] };
        if (!roomHasDoorPaths(room, trial)) continue;
        furnished.furniture.push(candidate); placed = true; break;
      }
      // A default is optional; dropping it is preferable to violating circulation.
      if (!placed) continue;
    }
  }
  return furnished;
}

export function applyFurnishing(plan: PlanSpec, enabled: boolean): PlanSpec {
  const base = { ...structuredClone(plan), furniture: plan.furniture.filter((f) => f.source === 'sketch') };
  return enabled ? autoFurnish(base) : base;
}

export function catalogueTypes() { return [...FURNITURE_TYPES]; }
