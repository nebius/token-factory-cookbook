import { pointSegmentDistance } from './checks';
import { roomCenter, type PlanSpec } from './plan';
import { FURNITURE_CATALOGUE, itemDimensions, itemRect, pointInPolygon } from './furniture';

export const BODY_RADIUS = 210;

type Point = [number, number];
export type WalkSpawn = { position: Point; facing: number; roomId: string; clearance: number };

export function collides(p: Point, plan: PlanSpec) {
  const furnitureHit = plan.furniture.some((item) => {
    if (!FURNITURE_CATALOGUE[item.type].collision) return false;
    const padded = { ...item, size: itemDimensions(item).map((n) => n + BODY_RADIUS * 2) as [number, number] };
    return pointInPolygon(p, itemRect(padded).corners);
  });
  if (furnitureHit) return true;
  return plan.walls.some((wall) => {
    if (pointSegmentDistance(p, wall.a, wall.b) >= BODY_RADIUS + wall.thickness / 2) return false;
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const dx = (wall.b[0] - wall.a[0]) / length, dy = (wall.b[1] - wall.a[1]) / length;
    const along = (p[0] - wall.a[0]) * dx + (p[1] - wall.a[1]) * dy;
    const opening = plan.openings.find((o) => o.wallId === wall.id && o.type !== 'window' && along > o.offset + BODY_RADIUS && along < o.offset + o.width - BODY_RADIUS);
    return !opening;
  });
}

export function minimumWallDistance(point: Point, plan: PlanSpec) {
  return Math.min(...plan.walls.map((wall) => pointSegmentDistance(point, wall.a, wall.b)));
}

function surfaceClearance(point: Point, plan: PlanSpec) {
  return Math.min(...plan.walls.map((wall) => pointSegmentDistance(point, wall.a, wall.b) - wall.thickness / 2));
}

function inside(point: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function sightDistance(position: Point, facing: number, room: PlanSpec['rooms'][number], plan: PlanSpec) {
  const angle = facing * Math.PI / 180;
  let travelled = 0;
  for (let step = 100; step <= 20000; step += 100) {
    const point: Point = [position[0] + Math.sin(angle) * step, position[1] + Math.cos(angle) * step];
    if (!inside(point, room.polygon) || collides(point, plan)) break;
    travelled = step;
  }
  return travelled;
}

/** Find an interior, collision-free spawn with roughly one metre of wall clearance. */
export function getWalkSpawn(plan: PlanSpec): WalkSpawn {
  const entryRoom = plan.rooms.find((room) => inside(plan.entry.position, room.polygon));
  const rooms = [...plan.rooms].sort((a, b) => {
    if (a === entryRoom) return -1;
    if (b === entryRoom) return 1;
    return distance(roomCenter(a.polygon), plan.entry.position) - distance(roomCenter(b.polygon), plan.entry.position);
  });
  let looseFallback: { position: Point; room: PlanSpec['rooms'][number]; score: number; clearance: number } | undefined;

  // Narrow entry halls may not contain a point 900 mm from both walls. In that case,
  // use the nearest room with a safe spawn rather than placing the camera against a door.
  for (const requiredClearance of [1000, 900]) {
    let best: { position: Point; room: PlanSpec['rooms'][number]; score: number; clearance: number } | undefined;
    for (const room of rooms) {
      const polygon = room.polygon as Point[];
      const center = roomCenter(polygon);
      const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const stepX = Math.max(200, (maxX - minX) / 28), stepY = Math.max(200, (maxY - minY) / 28);
      const candidates: Point[] = [center, ...(inside(plan.entry.position, polygon) ? [plan.entry.position] : [])];
      for (let x = minX + stepX / 2; x < maxX; x += stepX) for (let y = minY + stepY / 2; y < maxY; y += stepY) candidates.push([x, y]);
      for (const position of candidates) {
        if (!inside(position, polygon) || collides(position, plan)) continue;
        const clearance = surfaceClearance(position, plan);
        const score = room === entryRoom ? distance(position, center) + distance(position, plan.entry.position) * 0.1 : distance(position, plan.entry.position) + distance(position, center) * 0.1;
        if (clearance >= requiredClearance && (!best || score < best.score)) best = { position, room, score, clearance };
        if (requiredClearance === 900 && (!looseFallback || clearance > looseFallback.clearance)) looseFallback = { position, room, score, clearance };
      }
    }
    if (best) return finishSpawn(best, plan);
  }
  if (looseFallback) return finishSpawn(looseFallback, plan);
  const room = entryRoom ?? plan.rooms[0];
  return { position: [...plan.entry.position], facing: plan.entry.facing, roomId: room.id, clearance: surfaceClearance(plan.entry.position, plan) };
}

function finishSpawn(candidate: { position: Point; room: PlanSpec['rooms'][number]; clearance: number }, plan: PlanSpec): WalkSpawn {
  const center = roomCenter(candidate.room.polygon);
  let facing: number;
  if (distance(candidate.position, center) > 100) facing = Math.atan2(center[0] - candidate.position[0], center[1] - candidate.position[1]) * 180 / Math.PI;
  else {
    let longest = -1;
    facing = plan.entry.facing;
    for (let angle = 0; angle < 360; angle += 15) {
      const sight = sightDistance(candidate.position, angle, candidate.room, plan);
      if (sight > longest) { longest = sight; facing = angle; }
    }
  }
  return { position: candidate.position, facing: (facing + 360) % 360, roomId: candidate.room.id, clearance: candidate.clearance };
}
