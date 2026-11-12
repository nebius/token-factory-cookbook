import { describe, expect, it } from 'vitest';
import { SAMPLE_SOURCE } from './sample';
import { buildFromModule, SourceError, validateGeneratorSource } from './module';
import { planSchema } from './plan';
import { runChecks } from './checks';
import { collides, getWalkSpawn, minimumWallDistance } from './walkthrough';

const { plan } = buildFromModule(SAMPLE_SOURCE);
const copy = () => structuredClone(plan);

describe('PlanSpec validator', () => {
  it('accepts the complete generated sample', () => {
    expect(plan.rooms).toHaveLength(5);
    expect(planSchema.parse(plan).wallHeight).toBe(2700);
  });
  it.each([
    ['missing wallHeight', (p: any) => delete p.wallHeight],
    ['unknown floor', (p: any) => { p.rooms[0].floor = 'marble'; }],
    ['non-finite coordinates', (p: any) => { p.walls[0].a[0] = Infinity; }],
    ['too few polygon vertices', (p: any) => { p.rooms[0].polygon = p.rooms[0].polygon.slice(0, 2); }],
    ['missing wall reference shape', (p: any) => { delete p.openings[0].wallId; }],
    ['invalid entry', (p: any) => { p.entry.position = [20]; }],
    ['invalid sill type', (p: any) => { p.openings[5].sill = '900'; }],
  ])('rejects %s', (_name, mutate) => {
    const value = copy(); mutate(value);
    expect(planSchema.safeParse(value).success).toBe(false);
  });
});

describe('sandbox source validation', () => {
  it.each([
    'fetch("https://example.com")',
    'export const PARAMS = {}; export const ASSUMPTIONS = []; export function buildPlan(P) { return fetch(P.x); }',
    'await import("node:fs")',
    'export const PARAMS = {}; export const ASSUMPTIONS = []; export function buildPlan(P) { return new Function("return 1")(); }',
    'export const PARAMS = {}; export const ASSUMPTIONS = []; export function buildPlan(P) { return globalThis; }',
    'export const PARAMS = {}; export const ASSUMPTIONS = []; export function buildPlan(P) { return Math.constructor("return self")(); }',
  ])('rejects unsafe source: %s', (source) => {
    expect(() => validateGeneratorSource(source)).toThrow();
  });
  const wrap = (body: string) => `export const PARAMS = {}; export const ASSUMPTIONS = []; export function buildPlan(P) { ${body} }`;
  it.each([
    'let x = 1; x = 2; x += 3; x++; return x;',
    'const walls = []; const o = { w: 1 }; o.w = P.a * 2; o.w += 10; walls.push(o); return walls;',
    'const rooms = [{ a: [0, 0] }]; rooms[0].a[1] = 5; return rooms;',
  ])('allows assignment to its own variables: %s', (body) => {
    expect(validateGeneratorSource(wrap(body))).toBe(true);
  });
  it.each([
    'Math.PI = 3; return 1;',
    'Number.MAX_VALUE = 1; return 1;',
    'PARAMS.a = 1; return 1;',
    'ASSUMPTIONS.length = 0; return 1;',
    'self.onmessage = 1; return 1;',
    'leaked = 1; return 1;',
    'const o = {}; o.__proto__ = {}; return o;',
  ])('still rejects assignment to shared or undeclared targets: %s', (body) => {
    expect(() => validateGeneratorSource(wrap(body))).toThrow(SourceError);
  });
  it('rejects missing exports', () => {
    expect(() => buildFromModule('export const PARAMS = {}')).toThrow(SourceError);
  });
  it('rejects structurally invalid parameter ranges', () => {
    expect(() => buildFromModule(SAMPLE_SOURCE.replace('value: 2700, min: 2400', 'value: 2700, min: 3400'))).toThrow();
  });
  it.each([2400, 3400])('accepts a parameter exactly at an inclusive bound (%s)', (value) => {
    const result = buildFromModule(SAMPLE_SOURCE, { wall_height: value });
    expect(result.plan.wallHeight).toBe(value);
  });
  it('clamps a parameter locally and records the repair', () => {
    const result = buildFromModule(SAMPLE_SOURCE.replace('value: 2700, min: 2400', 'value: 3600, min: 2400'));
    expect(result.params.wall_height.value).toBe(3400);
    expect(result.plan.wallHeight).toBe(3400);
    expect(result.repairs.join()).toContain('clamped 3600 to 3400');
  });
  it('repairs an unknown param group locally instead of rejecting the version', () => {
    const source = SAMPLE_SOURCE.replace('group: "global", label: "Wall height"', 'group: "grid", label: "Wall height"');
    expect(source).not.toBe(SAMPLE_SOURCE);
    const result = buildFromModule(source);
    expect(result.params.wall_height.group).toBe('global');
    expect(result.repairs.join()).toContain('group "grid" is not global/room; using "global"');
  });
  it('links a missing assumption param by name and records the repair', () => {
    const result = buildFromModule(SAMPLE_SOURCE.replace(', param: "wall_height"', ''));
    expect(result.assumptions[0].param).toBe('wall_height');
    expect(result.repairs.join()).toContain('linked missing param to wall_height');
  });
  it('keeps an unmatched missing assumption param as text only', () => {
    const source = SAMPLE_SOURCE.replace('{ id: "height",', '{ id: "unmatched_note",').replace(', param: "wall_height"', '');
    const result = buildFromModule(source);
    expect(result.assumptions[0].param).toBeUndefined();
    expect(result.repairs.join()).toContain('text-only assumption');
  });
  it('allows pure nested named helper declarations', () => {
    const source = SAMPLE_SOURCE.replace('const wall = (id, a, b, thickness, exterior) => ({ id, a, b, thickness, exterior });', 'function wall(id, a, b, thickness, exterior) { return { id, a, b, thickness, exterior }; }');
    expect(buildFromModule(source).plan.walls).toHaveLength(10);
  });
  it('allows private pure helpers at module scope while preserving exact exports', () => {
    const helper = 'function wall(id, a, b, thickness, exterior) { return { id, a, b, thickness, exterior }; }\n';
    const source = SAMPLE_SOURCE.replace('  const wall = (id, a, b, thickness, exterior) => ({ id, a, b, thickness, exterior });\n', '').replace('export function buildPlan', `${helper}export function buildPlan`);
    expect(buildFromModule(source).plan.walls).toHaveLength(10);
  });
  it('rebuilds all geometry from changed parameters', () => {
    const result = buildFromModule(SAMPLE_SOURCE, { hall_width: 1400 });
    expect(result.plan.rooms.find((r) => r.id === 'hall')!.polygon[1][0]).toBe(6840);
  });
  it('extracts a fenced JavaScript module', () => {
    const result = buildFromModule(`Here is the plan:\n\`\`\`javascript\n${SAMPLE_SOURCE}\n\`\`\``);
    expect(result.plan.walls).toHaveLength(10);
  });
});

describe('walkthrough spawn', () => {
  it('moves the narrow-hall entry into a collision-free room with wall clearance', () => {
    const spawn = getWalkSpawn(plan);
    expect(spawn.roomId).not.toBe('hall');
    expect(collides(spawn.position, plan)).toBe(false);
    expect(spawn.clearance).toBeGreaterThanOrEqual(1000);
    expect(minimumWallDistance(spawn.position, plan)).toBeGreaterThanOrEqual(900);
  });
  it('faces toward a room sight line and leaves the PlanSpec entry unchanged', () => {
    const original = structuredClone(plan.entry);
    const spawn = getWalkSpawn(plan);
    expect(spawn.facing).toBeGreaterThanOrEqual(0);
    expect(spawn.facing).toBeLessThan(360);
    expect(plan.entry).toEqual(original);
  });
});

describe('deterministic engineering checks', () => {
  it('passes the sample, including entry reachability', () => {
    const result = runChecks(plan);
    expect(result.failures).toEqual([]);
    expect(result.checks).toHaveLength(8);
    expect(result.ok).toBe(true);
  });
  it('rejects an open exterior loop', () => {
    const value = copy(); value.walls[1].b[0] += 200;
    expect(runChecks(value).checks.find((c) => c.id === 'walls')!.ok).toBe(false);
  });
  it('rejects a zero-length wall', () => {
    const value = copy(); value.walls[4].b = value.walls[4].a;
    expect(runChecks(value).failures.join()).toContain('zero length');
  });
  it('rejects overlapping walls', () => {
    const value = copy(); value.walls[4].a = [500, 0]; value.walls[4].b = [5500, 0];
    expect(runChecks(value).failures.join()).toContain('overlap');
  });
  it('rejects self-intersecting rooms', () => {
    const value = copy(); const r = value.rooms[0].polygon;
    [r[1], r[2]] = [r[2], r[1]];
    expect(runChecks(value).checks.find((c) => c.id === 'rooms')!.ok).toBe(false);
  });
  it('rejects overlapping rooms', () => {
    const value = copy(); value.rooms[1].polygon = structuredClone(value.rooms[0].polygon);
    expect(runChecks(value).failures.join()).toContain('overlap');
  });
  it('rejects a room outside the exterior', () => {
    const value = copy(); value.rooms[0].polygon = value.rooms[0].polygon.map(([x, y]) => [x - 1000, y] as [number, number]);
    expect(runChecks(value).failures.join()).toContain('outside the exterior');
  });
  it.each([79, 3801])('rejects an opening that leaves less than 100 mm (offset %s)', (offset) => {
    const value = copy(); value.openings[1].offset = offset;
    expect(runChecks(value).failures.join()).toContain('at least 100 mm');
  });
  it('rejects a narrow door', () => {
    const value = copy(); value.openings[1].width = 799;
    expect(runChecks(value).failures.join()).toContain('at least 800');
  });
  it.each([599, 1101])('rejects an invalid window sill (%s mm)', (sill) => {
    const value = copy(); value.openings[5].sill = sill;
    expect(runChecks(value).failures.join()).toContain('600 and 1100');
  });
  it('rejects a disconnected room', () => {
    const value = copy(); value.openings = value.openings.filter((o) => o.id !== 'bed2_door');
    expect(runChecks(value).failures.join()).toContain('Bedroom 02 is not reachable');
  });
  it('rejects an entry outside the exterior', () => {
    const value = copy(); value.entry.position = [-500, 600];
    expect(runChecks(value).checks.find((c) => c.id === 'access')!.ok).toBe(false);
  });
  it('rejects a sub-900 mm hallway', () => {
    const value = buildFromModule(SAMPLE_SOURCE, { hall_width: 950 }).plan;
    expect(runChecks(value).failures.join()).toContain('minimum is 900');
  });
  it('preserves engineering checks at every individual sample slider bound', () => {
    const { params } = buildFromModule(SAMPLE_SOURCE);
    for (const [name, def] of Object.entries(params)) for (const value of [def.min, def.max]) {
      const result = buildFromModule(SAMPLE_SOURCE, { [name]: value });
      expect(runChecks(result.plan).failures, `${name}=${value}`).toEqual([]);
    }
  });
  it('preserves engineering checks at accumulated slider extremes', () => {
    const { params } = buildFromModule(SAMPLE_SOURCE);
    for (const extreme of ['min', 'max'] as const) {
      const values = Object.fromEntries(Object.entries(params).map(([name, def]) => [name, def[extreme]]));
      const result = buildFromModule(SAMPLE_SOURCE, values);
      expect(runChecks(result.plan).failures, extreme).toEqual([]);
    }
  });
  it('rejects an opening taller than its wall', () => {
    const value = copy(); value.openings[5].height = 2200;
    expect(runChecks(value).failures.join()).toContain('top of its wall');
  });
});
