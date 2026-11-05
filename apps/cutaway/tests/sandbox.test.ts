import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { evaluatePart } from "@/lib/sandbox/evaluate";
import { kit } from "@/lib/sandbox/kit";
import { runParts, type WorkerLike } from "@/lib/sandbox/run";
import type { WorkerMessage, WorkerRequest } from "@/lib/sandbox/types";
import { deskFan } from "./fixture";

const SIZE: [number, number, number] = [340, 480, 300];

describe("kit helpers", () => {
  const geoms: [string, THREE.BufferGeometry][] = [
    ["box", kit.box(1, 2, 3)],
    ["cyl", kit.cyl(2, 1, 5)],
    ["tube", kit.tube(5, 3, 2)],
    ["lathe", kit.lathe([[0, 0], [4, 1], [2, 5]])],
    ["extrude", kit.extrude(kit.circle(5), 2, { holes: [kit.circle(2).reverse()] })],
    ["gear", kit.gear({ teeth: 20, radius: 10, thickness: 3, bore: 2 })],
    ["helix", kit.helix({ radius: 5, pitch: 2, turns: 4, wire: 1 })],
    ["sweep", kit.sweep([[0, 0, 0], [5, 5, 0], [10, 0, 3]], 1)],
    ["blade", kit.blade({ span: 100, rootChord: 40 })],
  ];
  it.each(geoms)("%s builds finite, non-empty geometry", (_, g) => {
    const pos = g.attributes.position.array;
    expect(pos.length).toBeGreaterThan(9);
    expect(Array.from(pos).every(Number.isFinite)).toBe(true);
  });

  it("radial, linear and pcb make the right number of copies", () => {
    expect(kit.radial(7, () => kit.mesh(kit.box(1, 1, 1))).children).toHaveLength(7);
    expect(kit.linear(3, [1, 0, 0], () => kit.mesh(kit.box(1, 1, 1))).children).toHaveLength(3);
    expect(kit.pcb({ w: 50, d: 30, chips: [{ x: 0, z: 0, w: 5, d: 5 }] }).children).toHaveLength(2);
  });

  it("rand is deterministic", () => {
    const a = kit.rand(42), b = kit.rand(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("evaluatePart", () => {
  it("builds every desk fan part with no errors", () => {
    const { parts } = deskFan();
    for (const p of parts) {
      const r = evaluatePart(p.id, p.code, SIZE);
      expect(r.issues.filter((i) => i.severity === "error"), p.id).toEqual([]);
      expect(r.ok, p.id).toBe(true);
      expect(r.triangles).toBeGreaterThan(0);
    }
  });

  it("rejects builders that throw, return nothing, make NaN or leave the device", () => {
    expect(evaluatePart("a", "throw new Error('boom')", SIZE).issues[0].message).toMatch(/threw: boom/);
    expect(evaluatePart("b", "const x = 1;", SIZE).issues[0].message).toMatch(/must `return`/);
    expect(evaluatePart("c", "return kit.mesh(kit.box(NaN, 1, 1));", SIZE).issues[0].message).toMatch(/NaN/);
    expect(evaluatePart("d", "return kit.at(kit.mesh(kit.box(1,1,1)), [5000, 0, 0]);", SIZE).issues[0].message).toMatch(/outside the device/);
    expect(evaluatePart("e", "return kit.group();", SIZE).issues[0].message).toMatch(/no meshes/);
  });

  it("gives builders no network, timers or globals", () => {
    for (const name of ["fetch", "XMLHttpRequest", "setTimeout", "globalThis", "self", "postMessage"]) {
      const r = evaluatePart("n", `${name}("x"); return kit.mesh(kit.box(1,1,1));`, SIZE);
      expect(r.ok, name).toBe(false);
      expect(r.issues[0].message).toMatch(/not a function|undefined/);
    }
  });

  it("warns, but keeps, a part that sticks out a little", () => {
    const r = evaluatePart("w", "return kit.at(kit.mesh(kit.box(10,10,10)), [0, 0, 250]);", SIZE);
    expect(r.ok).toBe(true);
    expect(r.issues[0]).toMatchObject({ severity: "warning" });
  });
});

/** A fake worker that evaluates in-process, and never answers for code containing "LOOP". */
function fakeWorkerFactory(log: string[]) {
  return (): WorkerLike => {
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: () => log.push("terminate"),
      postMessage(req: WorkerRequest) {
        log.push(`start ${req.parts.map((p) => p.id).join(",")}`);
        setTimeout(() => {
          for (const p of req.parts) {
            w.onmessage?.({ data: { type: "start", id: p.id } satisfies WorkerMessage });
            if (p.code.includes("LOOP")) return;
            w.onmessage?.({ data: { type: "part", part: evaluatePart(p.id, p.code, req.sizeMm) } });
          }
          w.onmessage?.({ data: { type: "done" } });
        }, 0);
      },
    };
    return w;
  };
}

describe("runParts", () => {
  it("kills a runaway builder, marks it failed and builds the rest in a fresh worker", async () => {
    const log: string[] = [];
    const seen: string[] = [];
    const ok = "return kit.mesh(kit.box(10,10,10));";
    const res = await runParts(
      [{ id: "a", code: ok }, { id: "spin", code: "LOOP" }, { id: "c", code: ok }],
      SIZE,
      (p) => seen.push(p.id),
      { createWorker: fakeWorkerFactory(log), timeoutMs: 50 },
    );
    expect(res.map((r) => [r.id, r.ok])).toEqual([["a", true], ["spin", false], ["c", true]]);
    expect(res[1].issues[0].message).toMatch(/longer than/);
    expect(seen).toEqual(["a", "spin", "c"]);
    expect(log).toEqual(["start a,spin,c", "terminate", "start c", "terminate"]);
  });
});
