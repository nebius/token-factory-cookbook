import type { Meta } from "@/lib/schema/teardown";
import type { Issue } from "@/lib/sandbox/types";

export const PART_COUNT = { min: 8, max: 160 };
const MAX_DEPTH = 4;

/** Cross-reference checks the schema can't express. Codes come from `codeIds` (parts that have a builder). */
export function checkMeta(meta: Meta, codeIds: Iterable<string>): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, partId?: string) => issues.push({ severity: "error", partId, message });
  const warn = (message: string, partId?: string) => issues.push({ severity: "warning", partId, message });

  const ids = new Set<string>();
  for (const p of meta.parts) {
    if (ids.has(p.id)) err(`duplicate part id "${p.id}"`, p.id);
    ids.add(p.id);
  }
  if (meta.parts.length < PART_COUNT.min) warn(`only ${meta.parts.length} parts; a useful teardown has at least ${PART_COUNT.min}`);

  const byId = new Map(meta.parts.map((p) => [p.id, p]));
  for (const p of meta.parts) {
    if (p.parentId && !byId.has(p.parentId)) err(`parent "${p.parentId}" does not exist`, p.id);
    const seen = new Set<string>([p.id]);
    let cur = p.parentId ? byId.get(p.parentId) : undefined;
    let depth = 1;
    while (cur) {
      if (seen.has(cur.id)) {
        err("parent chain loops back on itself", p.id);
        break;
      }
      seen.add(cur.id);
      depth++;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (depth > MAX_DEPTH) warn(`assembly tree is ${depth} levels deep (max ${MAX_DEPTH})`, p.id);
    const [x, y, z] = p.explode.direction;
    if (p.explode.distance > 0 && x === 0 && y === 0 && z === 0) err("explode direction is [0,0,0]", p.id);
  }

  const codes = new Set(codeIds);
  for (const p of meta.parts) if (!codes.has(p.id)) err("no <part> builder was written for this part", p.id);
  for (const c of codes) if (!byId.has(c)) warn(`builder "${c}" has no matching part in <meta>`, c);

  const missing = (where: string, list: string[]) => {
    for (const id of list) if (!byId.has(id)) err(`${where} references unknown part "${id}"`);
  };
  for (const s of meta.systems) missing(`system "${s.name}"`, s.path);
  meta.steps.forEach((s, i) => missing(`step ${i + 1}`, [...s.removePartIds, ...s.focusPartIds]));
  meta.study.quiz.forEach((q, i) => {
    missing(`quiz question ${i + 1}`, q.partIds);
    if (q.answer >= q.options.length) err(`quiz question ${i + 1} answer index ${q.answer} is out of range`);
  });

  const [sx, sy, sz] = meta.device.sizeMm;
  if (!(sx > 0 && sy > 0 && sz > 0)) err("device.sizeMm must be three positive numbers");
  return issues;
}

/** Light structural check on a model-written SVG; the browser sanitises it again before showing it. */
export function checkSvg(svg: string): string | null {
  const s = svg.trim();
  if (!/^<svg[\s>]/i.test(s)) return "diagram must start with <svg";
  if (!/<\/svg>\s*$/i.test(s)) return "diagram must end with </svg>";
  if (!/viewBox\s*=/.test(s)) return "diagram needs a viewBox";
  if (s.length > 400_000) return "diagram is larger than 400 KB";
  return null;
}
