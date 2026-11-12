import { describe, expect, it } from 'vitest';
import { adjacencyProblems, measureLeftoverSpace, runChecks } from './checks';
import { pointInPolygon, type Point } from './furniture';
import { interiorAnchor } from './label-layout';
import { buildFromModule } from './module';
import { SAMPLE_SOURCE } from './sample';
import type { PlanSpec } from './plan';

const sample = () => structuredClone(buildFromModule(SAMPLE_SOURCE).plan);

describe('geometry and label edge cases', () => {
  it('counts a named outdoor room that lies inside the exterior as covered space', () => {
    const plan = sample();
    plan.rooms[0].kind = 'outdoor';
    expect(runChecks(plan).checks.find((check) => check.id === 'coverage')!.ok).toBe(true);
  });

  it('combines contiguous collinear pieces into one shared boundary segment', () => {
    const plan = sample();
    plan.rooms = plan.rooms.slice(0, 2);
    plan.rooms[0].polygon = [[0, 0], [800, 0], [800, 1000], [400, 1000], [0, 1000]];
    plan.rooms[1].polygon = [[0, 1000], [800, 1000], [800, 2000], [0, 2000]];
    plan.adjacency = [{ a: plan.rooms[0].id, b: plan.rooms[1].id, side: 'N' }];
    expect(adjacencyProblems(plan)).toEqual([]);
  });

  it('clips coverage cells at the exterior rather than overcounting boundary area', () => {
    const plan: PlanSpec = {
      wallHeight: 2700,
      walls: [
        { id: 'south', a: [0, 0], b: [150, 0], thickness: 50, exterior: true },
        { id: 'east', a: [150, 0], b: [150, 150], thickness: 50, exterior: true },
        { id: 'north', a: [150, 150], b: [0, 150], thickness: 50, exterior: true },
        { id: 'west', a: [0, 150], b: [0, 0], thickness: 50, exterior: true },
      ],
      rooms: [{ id: 'garden', name: 'External garden', polygon: [[-1000, -1000], [-500, -1000], [-500, -500], [-1000, -500]], floor: 'grass', kind: 'outdoor' }],
      openings: [], furniture: [], entry: { position: [75, 75], facing: 0 },
    };
    const result = measureLeftoverSpace(plan, plan.walls.map((wall) => wall.a));
    expect(result.enclosedArea).toBe(22500);
    expect(result.uncoveredArea).toBeLessThanOrEqual(result.enclosedArea);
    expect(result.percentage).toBeLessThanOrEqual(100);
    expect(result.regions.every((region) => region.area <= result.enclosedArea)).toBe(true);
  });

  it('places labels inside a concave room rather than its notch', () => {
    const polygon: Point[] = [[0, 0], [1400, 0], [1400, 3000], [1200, 3000], [1200, 1000], [200, 1000], [200, 3000], [0, 3000]];
    expect(pointInPolygon(interiorAnchor(polygon), polygon, false)).toBe(true);
  });
});
