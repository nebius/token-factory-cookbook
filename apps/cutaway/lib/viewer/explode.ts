import type { Part } from "@/lib/schema/teardown";

/** How far along its own path a part is at explode amount t (0-1). Outer parts (low order) move first. */
export function explodeProgress(order: number, maxOrder: number, t: number): number {
  const spread = 0.55;
  const p = Math.min(1, Math.max(0, t * (1 + spread) - spread * (order / Math.max(1, maxOrder))));
  return p * p * (3 - 2 * p);
}

/** Own explode vector of a part: its direction scaled to its distance. */
export function ownVector(part: Part): [number, number, number] {
  const [x, y, z] = part.explode.direction;
  const len = Math.hypot(x, y, z);
  if (!len) return [0, 0, 0];
  const k = part.explode.distance / len;
  return [x * k, y * k, z * k];
}

/** World offset of every part at explode amount t; children move with their parents. */
export function explodeOffsets(parts: Part[], t: number): Map<string, [number, number, number]> {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const maxOrder = Math.max(1, ...parts.map((p) => p.explode.order));
  const out = new Map<string, [number, number, number]>();
  for (const p of parts) {
    const o: [number, number, number] = [0, 0, 0];
    let cur: Part | undefined = p;
    for (let guard = 0; cur && guard < 8; guard++) {
      const v = ownVector(cur);
      const k = explodeProgress(cur.explode.order, maxOrder, t);
      o[0] += v[0] * k;
      o[1] += v[1] * k;
      o[2] += v[2] * k;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(p.id, o);
  }
  return out;
}
