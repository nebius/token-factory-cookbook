import { beforeAll, describe, expect, it } from "vitest";
import { openDb, useDb } from "@/lib/db/index";
import { createTeardown, getDiagrams, getParts, getTeardown, getThumbnail } from "@/lib/db/teardowns";
import { listRuns } from "@/lib/db/runs";
import { jobView, startJob, type JobView } from "@/lib/jobs/runner";

// Stored answers stand in for Kimi: no network, no cost.
beforeAll(() => {
  process.env.KIMI_PROVIDER = "replay";
  useDb(openDb(":memory:"));
});

async function until(id: number, done: (v: JobView) => boolean, ms = 60_000): Promise<JobView> {
  const t0 = Date.now();
  for (;;) {
    const v = jobView(id)!;
    if (done(v)) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${JSON.stringify(v.stages)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("server job runner", () => {
  it("runs the whole pipeline with nobody watching and saves a ready machine", async () => {
    const id = createTeardown({ slug: "draft-x", inputKind: "text", inputHash: "text:fan", text: "desk fan", name: "desk fan", nameKey: "desk-fan" });
    startJob(id);
    startJob(id); // a second start while running is a no-op
    const v = await until(id, (j) => !j.running);
    expect(v.error).toBeNull();
    expect(v.done?.slug).toBe("oscillating-desk-fan");
    expect(v.stages.every((s) => s.state === "done")).toBe(true);
    const t = getTeardown(id)!;
    expect(t.status).toBe("ready");
    expect(getParts(id).filter((p) => p.ok === 1)).toHaveLength(30);
    expect(getDiagrams(id)).toHaveLength(3);
    expect(getThumbnail(id)?.mime).toBe("image/jpeg");
    expect(listRuns(200, "replay").map((r) => r.kind).sort()).toEqual(["design", "diagrams", "review"]);
  }, 90_000);

  it("pauses for the open-existing choice, then drops the draft when told to open the saved one", async () => {
    // Identify needs a photo; the replay answer names a desk fan, which now exists.
    const id = createTeardown({ slug: "draft-y", inputKind: "image", inputHash: "img:1", image: Buffer.from("x"), mime: "image/png" });
    startJob(id);
    const w = await until(id, (j) => !!j.waiting);
    expect(w.waiting).toMatchObject({ kind: "existing", slug: "oscillating-desk-fan" });
    const { respondJob } = await import("@/lib/jobs/runner");
    expect(respondJob(id, true)).toBe(true);
    const v = await until(id, (j) => !j.running);
    expect(v.done).toMatchObject({ slug: "oscillating-desk-fan", existing: true });
    expect(getTeardown(id)).toBeNull();
  }, 60_000);
});
