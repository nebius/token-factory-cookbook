import { describe, expect, it } from 'vitest';
import { completeLines, joinContinuation, lastNonEmptyLine, moduleParses, recoverReviewResponses, streamIsComplete } from './stitch.js';

const full = '```javascript\nexport const PARAMS = { a: { value: 1, min: 0, max: 2 } };\nexport const ASSUMPTIONS = [];\nexport function buildPlan(P) {\n  const w = P.a * 1000;\n  return { w };\n}\n```';
const cutAt = full.indexOf('P.a * 1000') + 3; // mid-line, like a dropped stream
const prefix = full.slice(0, cutAt);
const head = completeLines(prefix);

describe('stream continuation stitching', () => {
  it('drops the partial line and remembers the last complete one', () => {
    expect(head.endsWith('buildPlan(P) {\n')).toBe(true);
    expect(lastNonEmptyLine(head)).toBe('export function buildPlan(P) {');
  });

  it('reproduces the original bug: naive join with a reopened fence does not parse', () => {
    expect(moduleParses(prefix + '```javascript\n  const w = P.a * 1000;\n  return { w };\n}\n```')).toBe(false);
  });

  it('joins a clean continuation', () => {
    const out = joinContinuation(head, '  const w = P.a * 1000;\n  return { w };\n}\n```');
    expect(out).toBe(full);
    expect(moduleParses(out)).toBe(true);
  });

  it('strips a reopened tagged fence and leading prose', () => {
    const out = joinContinuation(head, 'Here is the rest:\n```js\n  const w = P.a * 1000;\n  return { w };\n}\n```');
    expect(out).toBe(full);
  });

  it('strips a reopened bare fence when another fence follows', () => {
    expect(joinContinuation(head, '```\n  const w = P.a * 1000;\n  return { w };\n}\n```')).toBe(full);
  });

  it('removes lines the model repeated from before the cut', () => {
    const out = joinContinuation(head, 'export const ASSUMPTIONS = [];\nexport function buildPlan(P) {\n  const w = P.a * 1000;\n  return { w };\n}\n```');
    expect(out).toBe(full);
  });

  it('keeps a legitimate closing fence at the start of the continuation', () => {
    const h = completeLines(full.replace(/```$/, '').trimEnd() + '\n');
    expect(joinContinuation(h, '```')).toBe(full.replace(/```$/, '').trimEnd() + '\n```');
  });

  it('parses unfenced modules too', () => {
    expect(moduleParses('export const PARAMS = {};')).toBe(true);
    expect(moduleParses('export const PARAMS = {')).toBe(false);
  });

  it('recovers a complete review after a damaged outer code string', () => {
    const damagedPrefix = '{"verdict":"REVISE","issues":[],"code":"const wl = ';
    const latest = JSON.stringify({ verdict: 'REVISE', issues: ['Replace the invalid partition helper.'], code: 'export const PARAMS = {};\nexport const ASSUMPTIONS = [];\nexport function buildPlan(P) { return { value: P.value }; }', improvements: [] });
    const recovered = recoverReviewResponses(damagedPrefix + latest);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].offset).toBe(damagedPrefix.length);
    expect(recovered[0].review.code).toContain('export function buildPlan');
  });

  it('selects the latest complete review object without treating braces inside code as wrappers', () => {
    const first = JSON.stringify({ verdict: 'REVISE', issues: [], code: 'export const PARAMS = {};', improvements: [] });
    const latestObject = { verdict: 'PASS', issues: [], code: '', improvements: ['Keep nested {"braces"} as string data only.'] };
    const recovered = recoverReviewResponses(`${first}\n${JSON.stringify(latestObject)}`);
    expect(recovered).toHaveLength(2);
    expect(recovered.at(-1).review).toEqual(latestObject);
  });

  it('does not treat EOF, length exhaustion, or a failed stream as complete', () => {
    expect(streamIsComplete(false, null, null)).toBe(false);
    expect(streamIsComplete(false, 'stop', new Error('dropped'))).toBe(false);
    expect(streamIsComplete(true, 'length', null)).toBe(false);
    expect(streamIsComplete(true, null, null)).toBe(true);
    expect(streamIsComplete(false, 'stop', null)).toBe(true);
  });
});
