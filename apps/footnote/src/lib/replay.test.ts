import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// End to end on the recorded live run of the bundled EIA excerpt: the stored model replies are
// replayed, while the tools, checks and .xlsx run for real. No network, no key.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "footnote-test-"));
process.env.FOOTNOTE_DATA_DIR = dir;
process.env.INKLING_PROVIDER = "replay";

const replays = fs.existsSync("fixtures/replays") ? fs.readdirSync("fixtures/replays") : [];
const hasReplay = replays.some((f) => f.startsWith("agent-"));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe.runIf(hasReplay)("replayed run", () => {
  // The bundled example has a recorded run; it must replay end to end.
  it.each(["eia-steo-nov-2026"])("rebuilds %s, checks it and writes the workbook", { timeout: 120_000 }, async (example) => {
    const { startRun } = await import("@/lib/pipeline");
    const { loadRun, readRunFile } = await import("@/lib/runs");
    const { exampleFile, listExamples } = await import("@/lib/examples");
    const ex = (await listExamples()).find((e) => e.id === example)!;
    const id = await startRun(await exampleFile(ex.file), { name: ex.name }, { python: true, focus: ex.focus }, ex.b ? { pdf: await exampleFile(ex.b.file), source: { name: ex.b.name } } : undefined);
    let run = await loadRun(id);
    for (let i = 0; i < 600 && run?.status !== "done" && run?.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      run = await loadRun(id);
    }
    expect(run?.error).toBeUndefined();
    expect(run?.status).toBe("done");
    const s = run!.result!.summary;
    expect(s.inputs).toBeGreaterThan(10);
    expect(s.sourced).toBe(s.inputs);
    expect(s.recomputed).toBe(s.formulas);
    expect(run!.result!.claims.length).toBeGreaterThan(0);
    // Scanned pages are read from stored transcriptions; their matches never count as PDF text.
    if (ex.kind === "scanned") {
      expect(run!.doc.scanned?.length).toBe(18);
      expect(s.matched).toBe(0);
      expect(s.matchedScan).toBeGreaterThan(0);
    }
    if (ex.b) expect(run!.result!.cells.some((c) => c.source?.doc === "B")).toBe(true);
    const xlsx = await readRunFile(id, "model.xlsx");
    expect(xlsx.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
