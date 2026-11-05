import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { measureLeftoverSpace, runChecks } from './checks';
import { moduleWithParams } from './exports';
import { buildFromModule, SourceError, validateGeneratorSource } from './module';
import { planSchema, type PlanSpec } from './plan';
import { planToSVG } from './plan-svg';
import { SAMPLE_SOURCE } from './sample';
import { lockDownFunctionConstructors } from './sandbox';

const wrap = (body: string, helpers = '') => `export const PARAMS = {}; export const ASSUMPTIONS = []; ${helpers} export function buildPlan(P) { ${body} }`;
const sample = () => structuredClone(buildFromModule(SAMPLE_SOURCE).plan);

describe('generator sandbox', () => {
  it('resolves names in their own scope: a helper parameter does not make a global safe elsewhere', () => {
    expect(() => validateGeneratorSource(wrap('return fetch("https://example.com");', 'function helper(fetch) { return fetch; }'))).toThrow(/Unknown or unsafe global “fetch”/);
    expect(() => validateGeneratorSource(wrap('{ let self = 1; } return self;'))).toThrow(/self/);
  });

  it('still allows a helper to use its own parameters and locals', () => {
    expect(validateGeneratorSource(wrap('return helper(P.a);', 'function helper(fetch) { const x = fetch * 2; return x; }'))).toBe(true);
  });

  it('rejects assignment through a binding that resolves to a global or shared export', () => {
    expect(() => validateGeneratorSource(wrap('Math.PI = 3; return 1;'))).toThrow(SourceError);
    expect(() => validateGeneratorSource(wrap('PARAMS.a = 1; return 1;'))).toThrow(SourceError);
    expect(validateGeneratorSource(wrap('return 1;', 'function helper(Math) { Math.x = 1; }'))).toBe(true); // a local named Math
  });

  it('rejects async and generator functions and template-literal constructor keys', () => {
    expect(() => validateGeneratorSource(wrap('return 1;', 'function* g() {}'))).toThrow(SourceError);
    expect(() => validateGeneratorSource(wrap('return 1;', 'async function g() {}'))).toThrow(SourceError);
    expect(() => validateGeneratorSource(wrap('return Math[`constructor`];'))).toThrow(SourceError);
  });

  it('blocks a run-time computed constructor key once the worker realm is locked down', () => {
    const escape = "Math['con' + 'structor']['con' + 'structor']('return globalThis')()";
    expect(validateGeneratorSource(wrap(`return ${escape};`))).toBe(true); // can't be seen statically
    const realm = vm.createContext({});
    expect(vm.runInContext(`typeof (${escape})`, realm)).toBe('object'); // the escape works in an open realm
    vm.runInContext(`(${lockDownFunctionConstructors.toString()})()`, realm);
    expect(() => vm.runInContext(escape, realm)).toThrow(/is not a function/); // TypeError from the other realm
    expect(vm.runInContext("[(function () {}).constructor, (async function () {}).constructor, (function* () {}).constructor]", realm)).toEqual([undefined, undefined, undefined]);
    expect(vm.runInContext("new Function('return 41 + 1')()", realm)).toBe(42); // the app's own evaluator still works
  });
});

describe('plan limits and checks', () => {
  it('rejects plans larger than 100 m before any grid check runs', () => {
    const plan = sample();
    plan.walls[0].b = [1_000_000, plan.walls[0].b[1]];
    expect(planSchema.safeParse(plan).success).toBe(false);
    expect(planSchema.safeParse(sample()).success).toBe(true);
  });

  it('measures coverage correctly inside a concave (L-shaped) exterior', () => {
    const exterior: [number, number][] = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]];
    const walls = exterior.map((a, i) => ({ id: `w${i}`, a, b: exterior[(i + 1) % exterior.length], thickness: 100, exterior: true }));
    const plan = {
      wallHeight: 2700, walls,
      // Only the vertical wing has a room; the horizontal wing (4000 × 2000) is empty.
      rooms: [{ id: 'west', name: 'West', floor: 'wood', kind: 'indoor', polygon: [[50, 50], [1950, 50], [1950, 5950], [50, 5950]] }],
      openings: [], furniture: [], entry: { position: [1000, 1000], facing: 0 },
    } as unknown as PlanSpec;
    const result = measureLeftoverSpace(plan, exterior);
    expect(result.enclosedArea).toBeGreaterThan(19_000_000); // 20 m² L-shape, not just one wing
    expect(result.percentage).toBeGreaterThan(30); // the empty east wing is reported
  });

  it('treats an omitted door sill as zero when checking the opening height', () => {
    const plan = sample();
    const door = plan.openings.find((o) => o.type === 'door')!;
    delete door.sill;
    door.height = plan.wallHeight; // taller than wall height minus 100 mm
    const openings = runChecks(plan).checks.find((check) => check.id === 'openings')!;
    expect(openings.ok).toBe(false);
    expect(openings.detail).toContain('extends through the top of its wall');
  });
});

describe('plan drawing and exports', () => {
  it('draws door leaves only for doors, on the side given by swing', () => {
    const plan = sample();
    const door = plan.openings.find((o) => o.type === 'door')!;
    const doorCount = plan.openings.filter((o) => o.type === 'door').length;
    expect((planToSVG(plan).match(/data-door-swing=/g) ?? []).length).toBe(doorCount);
    door.type = 'opening';
    expect((planToSVG(plan).match(/data-door-swing=/g) ?? []).length).toBe(doorCount - 1);
    door.type = 'door'; door.swing = 'left';
    const left = planToSVG(plan);
    door.swing = 'right';
    const right = planToSVG(plan);
    expect(left).not.toBe(right);
  });

  it('exports plan.js from a fenced model response', () => {
    const fenced = '```javascript\n' + SAMPLE_SOURCE + '\n```';
    const { params } = buildFromModule(fenced);
    const exported = moduleWithParams(fenced, params);
    expect(exported.startsWith('export const PARAMS')).toBe(true);
    expect(exported).not.toContain('```');
  });
});
