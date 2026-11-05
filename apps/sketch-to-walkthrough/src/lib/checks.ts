import { roomCenter, type PlanSpec } from './plan';
import { checkFurnitureGeometry, roomHasDoorPaths } from './furniture';

export type Check = { id: string; title: string; ok: boolean; detail: string };
export type CheckResults = { checks: Check[]; failures: string[]; ok: boolean };
const EPS = 0.5;
const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const length = (a: [number, number], b: [number, number]) => distance(a, b);

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  const on = (p: [number, number], q: [number, number], r: [number, number]) => Math.min(p[0], r[0]) - EPS <= q[0] && q[0] <= Math.max(p[0], r[0]) + EPS && Math.min(p[1], r[1]) - EPS <= q[1] && q[1] <= Math.max(p[1], r[1]) + EPS;
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS)) ||
    (Math.abs(d1) <= EPS && on(c, a, d)) || (Math.abs(d2) <= EPS && on(c, b, d)) || (Math.abs(d3) <= EPS && on(a, c, b)) || (Math.abs(d4) <= EPS && on(a, d, b));
}
function pointOnSegment(p: [number, number], a: [number, number], b: [number, number]) {
  return distance(p, a) + distance(p, b) <= length(a, b) + EPS;
}
function pointInPolygon(point: [number, number], polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygonArea(polygon: [number, number][]) {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
}
function polygonSimple(polygon: [number, number][]) {
  if (polygonArea(polygon) < 10000) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (distance(a, b) < EPS) return false;
    for (let j = i + 1; j < polygon.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (segmentsIntersect(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return false;
    }
  }
  return true;
}
function sharedBoundaryOnSide(a: PlanSpec['rooms'][number], b: PlanSpec['rooms'][number], side: 'N' | 'S' | 'E' | 'W', tolerance: number) {
  const axis = side === 'N' || side === 'S' ? 1 : 0;
  const tangent = axis === 1 ? 0 : 1;
  const direction = side === 'N' || side === 'E' ? 1 : -1;
  const aCenter = roomCenter(a.polygon), bCenter = roomCenter(b.polygon);
  const intervals = new Map<number, [number, number][]>();
  for (let i = 0; i < a.polygon.length; i++) {
    const a0 = a.polygon[i], a1 = a.polygon[(i + 1) % a.polygon.length];
    if (Math.abs(a0[axis] - a1[axis]) > EPS || (a0[axis] - aCenter[axis]) * direction < -EPS) continue;
    for (let j = 0; j < b.polygon.length; j++) {
      const b0 = b.polygon[j], b1 = b.polygon[(j + 1) % b.polygon.length];
      if (Math.abs(b0[axis] - b1[axis]) > EPS || (bCenter[axis] - b0[axis]) * direction < -EPS) continue;
      if (Math.abs(a0[axis] - b0[axis]) > tolerance) continue;
      const low = Math.max(Math.min(a0[tangent], a1[tangent]), Math.min(b0[tangent], b1[tangent]));
      const high = Math.min(Math.max(a0[tangent], a1[tangent]), Math.max(b0[tangent], b1[tangent]));
      if (high <= low) continue;
      // Collinear polygon vertices may split a single wall into several contiguous pieces.
      const key = Math.round(a0[axis] / EPS), pieces = intervals.get(key) ?? [];
      pieces.push([low, high]); intervals.set(key, pieces);
    }
  }
  let longest = 0;
  for (const pieces of intervals.values()) {
    pieces.sort((a, b) => a[0] - b[0]);
    let [low, high] = pieces[0];
    for (const [nextLow, nextHigh] of pieces.slice(1)) {
      if (nextLow > high + EPS) { longest = Math.max(longest, high - low); low = nextLow; high = nextHigh; }
      else high = Math.max(high, nextHigh);
    }
    longest = Math.max(longest, high - low);
  }
  return { length: longest, correctSide: (bCenter[axis] - aCenter[axis]) * direction > EPS };
}

export function adjacencyProblems(plan: PlanSpec): string[] {
  const problems: string[] = [], rooms = new Map(plan.rooms.map((room) => [room.id, room]));
  const tolerance = Math.max(120, ...plan.walls.map((wall) => wall.thickness));
  const seen = new Set<string>();
  for (const relation of plan.adjacency ?? []) {
    const a = rooms.get(relation.a), b = rooms.get(relation.b);
    if (!a || !b) { problems.push(`Adjacency ${relation.a} → ${relation.b} references a missing room.`); continue; }
    if (a.id === b.id) { problems.push(`Adjacency for ${a.name} cannot reference the same room twice.`); continue; }
    const key = `${a.id}|${b.id}|${relation.side}`;
    if (seen.has(key)) { problems.push(`Duplicate adjacency: ${b.name} is ${relation.side} of ${a.name}.`); continue; }
    seen.add(key);
    const shared = sharedBoundaryOnSide(a, b, relation.side, tolerance);
    if (shared.length < 600 - EPS || !shared.correctSide) {
      const sideIssue = shared.correctSide ? '' : ' It is on the wrong side.';
      problems.push(`${b.name} must be ${relation.side} of ${a.name} and share at least 600 mm of wall; found ${Math.round(shared.length)} mm.${sideIssue}`);
    }
  }
  return problems;
}

export type LeftoverRegion = { area: number; center: [number, number]; nearestRooms: string[] };
export type LeftoverSpace = { percentage: number; uncoveredArea: number; enclosedArea: number; regions: LeftoverRegion[] };

function clippedCellArea(minX: number, minY: number, step: number, exterior: [number, number][]) {
  let polygon: [number, number][] = [[minX, minY], [minX + step, minY], [minX + step, minY + step], [minX, minY + step]];
  for (let i = 0; i < exterior.length && polygon.length; i++) {
    const a = exterior[i], b = exterior[(i + 1) % exterior.length];
    const signedDistance = (point: [number, number]) => (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    const clipped: [number, number][] = [];
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j], q = polygon[(j + 1) % polygon.length];
      const pDistance = signedDistance(p), qDistance = signedDistance(q);
      const pInside = pDistance >= -EPS, qInside = qDistance >= -EPS;
      if (pInside !== qInside) {
        const t = pDistance / (pDistance - qDistance);
        clipped.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
      if (qInside) clipped.push(q);
    }
    polygon = clipped;
  }
  return polygon.length >= 3 ? Math.min(step * step, polygonArea(polygon)) : 0;
}

/** Sample occupancy on a fixed 200 mm grid and clip each cell's area at the exterior. */
export function measureLeftoverSpace(plan: PlanSpec, exteriorPolygon: [number, number][]): LeftoverSpace {
  const step = 200;
  const enclosedArea = polygonArea(exteriorPolygon);
  const xs = exteriorPolygon.map((p) => p[0]), ys = exteriorPolygon.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = Math.max(1, Math.ceil((maxX - minX) / step)), rows = Math.max(1, Math.ceil((maxY - minY) / step));
  const roomAllowance = Math.max(120, ...plan.walls.map((wall) => wall.thickness)) / 2 + EPS;
  // Exterior sampling already excludes outside rooms; an outdoor-named room inside the loop still occupies space.
  const roomPolygons = plan.rooms.map((room) => room.polygon);
  const exterior = [...exteriorPolygon];
  if (exterior.length > 1 && distance(exterior[0], exterior[exterior.length - 1]) < EPS) exterior.pop();
  const signedArea = exterior.reduce((sum, p, i) => { const q = exterior[(i + 1) % exterior.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (signedArea < 0) exterior.reverse();
  const uncovered: number[] = [], cells = new Map<number, { point: [number, number]; area: number }>();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = minX + col * step, y = minY + row * step, area = clippedCellArea(x, y, step, exterior);
    if (area <= EPS) continue;
    const center: [number, number] = [x + step / 2, y + step / 2];
    const candidates: [number, number][] = [center, [x + step / 4, y + step / 4], [x + step * 0.75, y + step / 4], [x + step / 4, y + step * 0.75], [x + step * 0.75, y + step * 0.75]];
    const point = candidates.find((candidate) => pointInPolygon(candidate, exteriorPolygon)) ?? center;
    const covered = roomPolygons.some((polygon) => pointInPolygon(point, polygon) || polygon.some((a, i) => pointSegmentDistance(point, a, polygon[(i + 1) % polygon.length]) <= roomAllowance)) ||
      plan.walls.some((wall) => pointSegmentDistance(point, wall.a, wall.b) <= wall.thickness / 2 + EPS);
    if (!covered) { const index = row * cols + col; uncovered.push(index); cells.set(index, { point, area }); }
  }
  const remaining = new Set(uncovered), regions: LeftoverRegion[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    remaining.delete(first);
    const queue = [first], component: number[] = [];
    while (queue.length) {
      const index = queue.shift()!; component.push(index);
      const col = index % cols;
      const neighbours = [index - cols, index + cols, ...(col > 0 ? [index - 1] : []), ...(col < cols - 1 ? [index + 1] : [])];
      for (const next of neighbours) if (remaining.has(next)) { remaining.delete(next); queue.push(next); }
    }
    const area = component.reduce((sum, index) => sum + cells.get(index)!.area, 0);
    const center = component.reduce((sum, index) => {
      const cell = cells.get(index)!, weight = cell.area / area;
      return [sum[0] + cell.point[0] * weight, sum[1] + cell.point[1] * weight] as [number, number];
    }, [0, 0] as [number, number]);
    const nearestRooms = plan.rooms.map((room) => ({ name: room.name, distance: distance(center, roomCenter(room.polygon)) })).sort((a, b) => a.distance - b.distance).slice(0, 2).map((room) => room.name);
    regions.push({ area, center, nearestRooms });
  }
  regions.sort((a, b) => b.area - a.area);
  const uncoveredArea = Math.min(enclosedArea, regions.reduce((sum, region) => sum + region.area, 0));
  return { percentage: enclosedArea ? uncoveredArea / enclosedArea * 100 : 0, uncoveredArea, enclosedArea, regions };
}

export function leftoverSpaceProblems(result: LeftoverSpace): string[] {
  if (result.percentage >= 3) {
    const largest = result.regions.slice(0, 3).map((region) => `${(region.area / 1e6).toFixed(1)} m² near (${(region.center[0] / 1000).toFixed(1)}, ${(region.center[1] / 1000).toFixed(1)}) m, closest to ${region.nearestRooms.join(' and ') || 'no named room'}`).join('; ');
    return [`Uncovered interior area is ${result.percentage.toFixed(1)}% (${(result.uncoveredArea / 1e6).toFixed(1)} m²); it must be under 3%. Largest unlabelled regions: ${largest}. Fill these with rooms or named circulation spaces.`];
  }
  return [];
}

function wallLoop(walls: PlanSpec['walls']) {
  const vertices = new Map<string, { point: [number, number]; count: number }>();
  const pointKey = (p: [number, number]) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
  for (const wall of walls) {
    for (const point of [wall.a, wall.b]) {
      const key = pointKey(point), existing = vertices.get(key);
      if (existing) existing.count++; else vertices.set(key, { point, count: 1 });
    }
  }
  if ([...vertices.values()].some((v) => v.count !== 2)) return false;
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
  for (const wall of walls) { link(pointKey(wall.a), pointKey(wall.b)); link(pointKey(wall.b), pointKey(wall.a)); }
  if (!adjacency.size) return false;
  const first = [...adjacency.keys()][0], visited = new Set([first]), queue = [first];
  while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  return visited.size === adjacency.size;
}

export function runChecks(plan: PlanSpec): CheckResults {
  const checks: Check[] = [];
  const add = (id: string, title: string, problems: string[], success: string) => checks.push({ id, title, ok: !problems.length, detail: problems.join(' ') || success });
  const badWalls: string[] = [];
  const ids = [...plan.walls.map((w) => w.id), ...plan.rooms.map((r) => r.id), ...plan.openings.map((o) => o.id)];
  if (new Set(ids).size !== ids.length) badWalls.push('Wall, room, and opening IDs must be globally unique.');
  for (const wall of plan.walls) if (length(wall.a, wall.b) < EPS) badWalls.push(`Wall ${wall.id} has zero length.`);
  for (let i = 0; i < plan.walls.length; i++) for (let j = i + 1; j < plan.walls.length; j++) {
    const a = plan.walls[i], b = plan.walls[j];
    if (segmentsIntersect(a.a, a.b, b.a, b.b)) {
      const collinear = [a.a, a.b].every((p) => Math.abs((b.b[0] - b.a[0]) * (p[1] - b.a[1]) - (b.b[1] - b.a[1]) * (p[0] - b.a[0])) < EPS);
      const onlyTouches = [a.a, a.b].some((p) => [b.a, b.b].some((q) => distance(p, q) < EPS)) ||
        [b.a, b.b].some((p) => [a.a, a.b].some((q) => distance(p, q) < EPS));
      const endpointTouch = [a.a, a.b].some((p) => pointOnSegment(p, b.a, b.b)) || [b.a, b.b].some((p) => pointOnSegment(p, a.a, a.b));
      if (collinear && !onlyTouches) badWalls.push(`Walls ${a.id} and ${b.id} overlap.`);
      else if (!endpointTouch) badWalls.push(`Walls ${a.id} and ${b.id} cross or overlap.`);
    }
  }
  const exterior = plan.walls.filter((w) => w.exterior);
  const closedExterior = wallLoop(exterior);
  if (!closedExterior) badWalls.push('Exterior wall endpoints must form one connected, closed loop (one wall in, one wall out at every corner).');
  add('walls', 'Structure & wall loop', badWalls, 'Exterior walls close cleanly. No crossing or overlapping walls.');

  const badRooms: string[] = [];
  // Exterior corners in arbitrary wall order are handled with a point-in-loop test below.
  const orderedExterior: [number, number][] = [];
  if (exterior.length) {
    const unused = [...exterior];
    let current = unused.shift()!;
    orderedExterior.push(current.a, current.b);
    while (unused.length) {
      const end = orderedExterior[orderedExterior.length - 1];
      const index = unused.findIndex((w) => distance(w.a, end) < EPS || distance(w.b, end) < EPS);
      if (index < 0) break;
      const next = unused.splice(index, 1)[0];
      orderedExterior.push(distance(next.a, end) < EPS ? next.b : next.a);
    }
  }
  for (let i = 0; i < plan.rooms.length; i++) {
    const room = plan.rooms[i];
    if (!polygonSimple(room.polygon)) badRooms.push(`Room ${room.id} has a self-intersecting, zero-length, or near-zero-area polygon.`);
    if (orderedExterior.length >= 4 && exterior.length > 3) {
      if (room.kind !== 'outdoor' && !room.polygon.every((p) => pointInPolygon(p, orderedExterior))) badRooms.push(`Room ${room.id} extends outside the exterior envelope.`);
    }
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const other = plan.rooms[j];
      const edgesCross = room.polygon.some((a, k) => other.polygon.some((c, l) => {
        const b = room.polygon[(k + 1) % room.polygon.length], d = other.polygon[(l + 1) % other.polygon.length];
        // Shared wall boundaries are expected; true edge crossings are not.
        const shared = (distance(a, c) < EPS && distance(b, d) < EPS) || (distance(a, d) < EPS && distance(b, c) < EPS);
        return !shared && segmentsIntersect(a, b, c, d);
      }));
      if (edgesCross || pointInPolygon(roomCenter(room.polygon), other.polygon) || pointInPolygon(roomCenter(other.polygon), room.polygon)) badRooms.push(`Rooms ${room.id} and ${other.id} overlap.`);
    }
  }
  add('rooms', 'Room geometry', badRooms, 'Room polygons are valid, non-overlapping; outdoor areas may extend beyond the exterior.');

  const badSizes: string[] = [], scheduledRooms = new Set<string>();
  for (const entry of plan.schedule ?? []) {
    const room = plan.rooms.find((r) => r.id === entry.roomId);
    if (!room) { badSizes.push(`Schedule references missing room ${entry.roomId}.`); continue; }
    if (scheduledRooms.has(room.id)) badSizes.push(`Room ${room.name} has duplicate written-size entries.`);
    scheduledRooms.add(room.id);
    const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
    const actual: [number, number] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    const written: [number, number] = [entry.writtenWidth, entry.writtenDepth];
    const matches = [[actual[0], actual[1]], [actual[1], actual[0]]].some((oriented) => oriented.every((value, axis) => {
      const tolerance = Math.max(150, written[axis] * 0.1);
      return Math.abs(value - written[axis]) <= tolerance + 0.001;
    }));
    if (!matches) badSizes.push(`Room ${room.name} is ${Math.round(actual[0])} × ${Math.round(actual[1])} mm; written size is ${entry.writtenWidth} × ${entry.writtenDepth} mm (±10% or ±150 mm, whichever is larger, either orientation).`);
  }
  add('sizes', 'Written room sizes', badSizes, plan.schedule?.length ? `${plan.schedule.length} written room sizes match their polygons within tolerance.` : 'No written room-size schedule was supplied.');

  const badAdjacency = adjacencyProblems(plan);
  add('adjacency', 'Sketch adjacency', badAdjacency, plan.adjacency?.length ? `${plan.adjacency.length} declared neighbouring rooms share at least 600 mm on the stated side.` : 'No sketch adjacency was supplied.');

  const leftover = closedExterior && orderedExterior.length >= 4 ? measureLeftoverSpace(plan, orderedExterior) : null;
  const badLeftover = leftover ? leftoverSpaceProblems(leftover) : ['Leftover space cannot be measured until the exterior forms one closed loop.'];
  add('coverage', 'No leftover space', badLeftover, leftover ? `${leftover.percentage.toFixed(1)}% of the enclosed area is uncovered after wall-thickness allowance; the limit is under 3%.` : 'Coverage measured.');

  const badOpenings: string[] = [], wallById = new Map(plan.walls.map((w) => [w.id, w]));
  for (const opening of plan.openings) {
    const wall = wallById.get(opening.wallId);
    if (!wall) { badOpenings.push(`Opening ${opening.id} references missing wall ${opening.wallId}.`); continue; }
    const wallLength = length(wall.a, wall.b);
    if (opening.offset < 100 || opening.offset + opening.width > wallLength - 100) badOpenings.push(`Opening ${opening.id} must fit its wall with at least 100 mm at both ends.`);
    if (opening.sill! + opening.height > plan.wallHeight - 100) badOpenings.push(`Opening ${opening.id} extends through the top of its wall.`);
    if (opening.type === 'door') {
      if (opening.width < 800) badOpenings.push(`Door ${opening.id} is ${opening.width} mm; doors need at least 800 mm.`);
      if ((opening.sill ?? 0) > 10) badOpenings.push(`Door ${opening.id} needs a sill at floor level.`);
    }
    if (opening.type === 'window' && (opening.sill === undefined || opening.sill < 600 || opening.sill > 1100)) badOpenings.push(`Window ${opening.id} needs a sill between 600 and 1100 mm.`);
    for (const other of plan.openings) if (other.id !== opening.id && other.wallId === opening.wallId && opening.offset < other.offset + other.width && other.offset < opening.offset + opening.width) badOpenings.push(`Openings ${opening.id} and ${other.id} overlap.`);
  }
  add('openings', 'Openings & clearances', badOpenings, 'Doors are ≥ 800 mm; windows have 600–1100 mm sills; every opening fits.');

  const reachability: string[] = [];
  if (!pointInPolygon(plan.entry.position, orderedExterior)) reachability.push('Entry is not inside the exterior envelope.');
  const adjacency = new Map<string, Set<string>>(plan.rooms.map((r) => [r.id, new Set()]));
  for (const opening of plan.openings) {
    if (opening.type === 'window') continue;
    const wall = wallById.get(opening.wallId); if (!wall) continue;
    const mid: [number, number] = [wall.a[0] + (wall.b[0] - wall.a[0]) * (opening.offset + opening.width / 2) / length(wall.a, wall.b), wall.a[1] + (wall.b[1] - wall.a[1]) * (opening.offset + opening.width / 2) / length(wall.a, wall.b)];
    const tangent: [number, number] = [(wall.b[0] - wall.a[0]) / length(wall.a, wall.b), (wall.b[1] - wall.a[1]) / length(wall.a, wall.b)];
    const samples: [number, number][] = [[mid[0] - tangent[1] * (wall.thickness + 30), mid[1] + tangent[0] * (wall.thickness + 30)], [mid[0] + tangent[1] * (wall.thickness + 30), mid[1] - tangent[0] * (wall.thickness + 30)]];
    const touching = samples.map((p) => plan.rooms.find((r) => pointInPolygon(p, r.polygon))?.id).filter((id): id is string => !!id);
    for (const a of touching) for (const b of touching) if (a !== b) { adjacency.get(a)?.add(b); adjacency.get(b)?.add(a); }
    if (!touching.length && wall.exterior) {
      const outside = samples.find((p) => !pointInPolygon(p, orderedExterior));
      const inside = samples.find((p) => pointInPolygon(p, orderedExterior));
      const room = inside && plan.rooms.find((r) => pointInPolygon(rCenter(r.polygon), r.polygon) && pointInPolygon(inside, r.polygon));
      if (outside && room) adjacency.get(room.id)?.add('__outside__');
    }
  }
  adjacency.set('__outside__', new Set());
  for (const [room, neighbors] of adjacency) for (const neighbor of neighbors) adjacency.get(neighbor)?.add(room);
  const start = plan.rooms.find((r) => pointInPolygon(plan.entry.position, r.polygon))?.id ?? '__outside__';
  const reached = new Set([start]), queue = [start];
  while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  for (const room of plan.rooms) if (!reached.has(room.id)) reachability.push(`Room ${room.name} is not reachable from the entry through doors or openings.`);
  for (const room of plan.rooms.filter((r) => /hall|corridor|passage/i.test(r.name))) {
    const minWidth = Math.min(...room.polygon.map((a, i) => {
      const b = room.polygon[(i + 1) % room.polygon.length];
      return room.polygon.filter((_, j) => j !== i && j !== (i + 1) % room.polygon.length).map((p) => pointSegmentDistance(p, a, b));
    }).flat());
    if (minWidth < 900) reachability.push(`Hallway ${room.name} is only ${Math.round(minWidth)} mm wide; minimum is 900 mm.`);
  }
  add('access', 'Access from entry', reachability, 'Every room connects to the entry. Hallway clearances are at least 900 mm.');

  const badFurniture = checkFurnitureGeometry(plan).map((issue) => `Furniture ${issue.itemId} ${issue.message}`);
  for (const room of plan.rooms) if (!roomHasDoorPaths(room, plan)) badFurniture.push(`Room ${room.name} has no 600 mm walkable path from every door into the room around its furniture.`);
  const sketchCount = plan.furniture.filter((f) => f.source === 'sketch').length, autoCount = plan.furniture.length - sketchCount;
  add('furniture', 'Furniture & circulation', badFurniture, plan.furniture.length ? `${plan.furniture.length} items fit their rooms, avoid openings and preserve 600 mm paths (${sketchCount} from sketch, ${autoCount} added by default).` : 'No furniture placed; circulation is unobstructed.');
  const failures = checks.filter((c) => !c.ok).flatMap((c) => [`${c.title}: ${c.detail}`]);
  return { checks, failures, ok: !failures.length };
}

export function pointSegmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const l2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  if (!l2) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
  return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])));
}

// Alias keeps the reachability predicate readable above.
const rCenter = roomCenter;
