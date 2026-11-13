import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Run } from "@/lib/runs";

// Its own temporary data folder and database, set before the storage modules load.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "footnote-db-test-"));
process.env.FOOTNOTE_DATA_DIR = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(id: string, extra: Partial<Run> = {}): Run {
  return {
    id,
    createdAt: "2026-11-13T10:00:00.000Z",
    status: "done",
    progress: { stage: "Done", step: 3, chars: 0 },
    doc: { name: "The Employment Situation, November 1975", pages: 18, sizes: [], hash: "h", scanned: [10] },
    options: { python: true, focus: "Model the labour market" },
    model: "thinkingmachines/Inkling-2-Small",
    steps: [],
    cells: [],
    claims: [],
    calls: [
      { step: 0, stage: "transcribe", page: 10, doc: "A", provider: "nebius", model: "m", startedAt: "2026-11-13T10:00:01.000Z", ms: 9000, usage: { input: 2000, cachedInput: 0, output: 9000, reasoning: 6000 }, cost: 0.0096, finishReason: "tool_calls" },
      { step: 1, stage: "agent", provider: "nebius", model: "m", startedAt: "2026-11-13T10:00:10.000Z", ms: 4000, usage: { input: 30000, cachedInput: 20000, output: 1000, reasoning: 200 }, cost: 0.0052, finishReason: "tool_calls" },
    ],
    result: {
      cells: [
        { sheet: "Payrolls", ref: "D2", label: "Total nonfarm payrolls, Nov 1975 (thousands)", value: 77549, source: { page: 10, quote: "TOTAL 79,151 77,614" }, step: 2, checks: [{ status: "scan", message: "Matches “77,549” in the model's transcription of scanned page 10" }], at: { doc: "A", page: 10 } },
        { sheet: "Payrolls", ref: "B5", label: "Unemployment rate", value: 0.083, format: "percent", source: { page: 1 }, step: 2, checks: [{ status: "ok", message: "Matches" }], at: { doc: "A", page: 1 }, edited: true },
        { sheet: "Payrolls", ref: "E2", label: "Change 100%_safe", formula: "=D2-C2", result: 41, step: 2, checks: [{ status: "ok", message: "Recomputed: 41" }] },
      ],
      claims: [{ id: "c1", claim: "Unemployment declined in November", page: 1, verdict: "supported", evidence: "8.6 to 8.3", step: 3, quoted: true, at: { doc: "A", page: 1, lines: [[0, 0, 1, 0.02]] } }],
      summary: { inputs: 2, sourced: 2, matched: 1, matchedScan: 1, formulas: 1, recomputed: 1, failures: 0, warnings: 0, edited: 1 },
    },
    edits: [{ at: "2026-11-13T11:00:00.000Z", sheet: "Payrolls", ref: "B5", kind: "edit", before: null, after: null }],
    ...extra,
  } as Run;
}

// A run saved before the database existed, as a folder with run.json.
const legacy = run("2026-11-12-legacy01", { createdAt: "2026-11-12T09:00:00.000Z", model: "thinkingmachines/Inkling-2-Small" });
fs.mkdirSync(path.join(dir, "runs", legacy.id), { recursive: true });
fs.writeFileSync(path.join(dir, "runs", legacy.id, "run.json"), JSON.stringify(legacy));
fs.mkdirSync(path.join(dir, "runs", "not-a-run"), { recursive: true });

describe("the run database", () => {
  it("opens in WAL mode at the current schema version and imports old run folders once", async () => {
    const { openDb, importFolders, SCHEMA_VERSION } = await import("@/lib/db");
    const store = openDb();
    expect(store.file).toBe(path.join(dir, "footnote.db"));
    expect(store.imported).toBe(1);
    expect((store.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    expect((store.db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v).toBe(SCHEMA_VERSION);
    // Idempotent: a second pass finds nothing new, and the folder is left in place.
    expect(importFolders(store.db, path.join(dir, "runs"))).toBe(0);
    expect(fs.existsSync(path.join(dir, "runs", legacy.id, "run.json"))).toBe(true);
  });

  it("round-trips runs through saveRun, loadRun and listRuns", async () => {
    const { saveRun, loadRun, listRuns } = await import("@/lib/runs");
    const r = run("2026-11-13-roundtrip");
    await saveRun(r);
    expect(await loadRun(r.id)).toEqual(r);
    expect(fs.existsSync(path.join(dir, "runs", r.id))).toBe(true);
    expect((await listRuns()).map((x) => x.id)).toEqual([r.id, legacy.id]);
    expect(await loadRun("missing")).toBeNull();
    expect(await loadRun("../escape")).toBeNull();
  });

  it("keeps the normalised tables in step with every save", async () => {
    const { openDb } = await import("@/lib/db");
    const { saveRun, loadRun } = await import("@/lib/runs");
    const db = openDb().db;
    const row = db.prepare("SELECT kind, scanned_pages, inputs, matched_scan, calls, input_tokens, output_tokens, round(cost, 4) AS cost, provider FROM runs WHERE id = ?").get("2026-11-13-roundtrip");
    expect({ ...row }).toEqual({ kind: "scanned", scanned_pages: 1, inputs: 2, matched_scan: 1, calls: 2, input_tokens: 32000, output_tokens: 10000, cost: 0.0148, provider: "nebius" });
    const cells = db.prepare("SELECT ref, value_num, formula, result, doc, page, status, text_source, edited FROM cells WHERE run_id = ? ORDER BY ref").all("2026-11-13-roundtrip").map((c) => ({ ...c }));
    expect(cells).toEqual([
      { ref: "B5", value_num: 0.083, formula: null, result: null, doc: "A", page: 1, status: "ok", text_source: "pdf", edited: 1 },
      { ref: "D2", value_num: 77549, formula: null, result: null, doc: "A", page: 10, status: "scan", text_source: "transcription", edited: 0 },
      { ref: "E2", value_num: null, formula: "=D2-C2", result: 41, doc: null, page: null, status: "ok", text_source: null, edited: 0 },
    ]);
    expect(db.prepare("SELECT stage FROM calls WHERE run_id = ? ORDER BY seq").all("2026-11-13-roundtrip").map((c) => (c as { stage: string }).stage)).toEqual(["transcribe", "agent"]);
    expect({ ...db.prepare("SELECT verdict, located FROM claims WHERE run_id = ?").get("2026-11-13-roundtrip") }).toEqual({ verdict: "supported", located: 1 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM edits WHERE run_id = ?").get("2026-11-13-roundtrip") as { n: number }).n).toBe(1);

    // A later save replaces the rows rather than adding to them.
    const r = (await loadRun("2026-11-13-roundtrip"))!;
    r.result!.cells = r.result!.cells.slice(0, 1);
    await saveRun(r);
    expect((db.prepare("SELECT COUNT(*) AS n FROM cells WHERE run_id = ?").get(r.id) as { n: number }).n).toBe(1);
  });

  it("searches cells across runs by label, number and percentage, and totals the spend", async () => {
    const { openDb, searchCells, totals } = await import("@/lib/db");
    const db = openDb().db;
    expect(searchCells(db, "nonfarm payrolls").map((h) => h.runId).sort()).toEqual(["2026-11-12-legacy01", "2026-11-13-roundtrip"]);
    const byNumber = searchCells(db, "77,549");
    expect(byNumber[0]).toMatchObject({ value: 77549, page: 10, status: "scan", textSource: "transcription", docName: "The Employment Situation, November 1975" });
    expect(searchCells(db, "8.3%").map((h) => h.ref)).toContain("B5");
    expect(searchCells(db, "100%_").map((h) => h.ref)).toEqual(["E2"]);
    expect(searchCells(db, "x")).toEqual([]);
    expect(totals(db)).toMatchObject({ runs: 2, costUnknown: 0 });
    expect(totals(db).cost).toBeCloseTo(0.0296, 6);
  });
});
