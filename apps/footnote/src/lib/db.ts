import { pairTitle } from "@/lib/doc-names";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { CheckedCell, CheckedClaim, Status } from "@/lib/book";
import type { Run } from "@/lib/runs";

// Footnote's store: one SQLite file, data/footnote.db (or $FOOTNOTE_DATA_DIR/footnote.db), through
// Node's built-in node:sqlite, so there is nothing to install. The runs table holds every run as a JSON
// document (the source of truth, nothing is lost) next to the columns worth querying; cells, claims,
// calls and edits are normalised copies rewritten in the same transaction on every save. Binary output
// (the PDFs, page images, model.xlsx) stays in data/runs/<id>/.

type SqliteModule = typeof import("node:sqlite");

// node:sqlite prints an ExperimentalWarning on first use in Node 22. Footnote relies only on its stable
// core (open, exec, prepare, transactions), so that one warning is filtered; every other warning passes.
function loadSqlite(): SqliteModule {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning?.message;
    if (text?.includes("SQLite is an experimental feature")) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    // getBuiltinModule, not import: bundlers leave it alone, and it needs no flag on Node 22.13+.
    const mod = process.getBuiltinModule("node:sqlite") as SqliteModule | undefined;
    if (!mod) throw new Error("node:sqlite is not available. Footnote needs Node.js 22.13 or later.");
    return mod;
  } finally {
    process.emitWarning = emit;
  }
}

export function dataDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.FOOTNOTE_DATA_DIR || path.join(process.cwd(), "data"));
}

// Forward migrations, applied in order; schema_version records how far a database has come.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    kind TEXT NOT NULL,              -- single, scanned or compare
    doc_name TEXT NOT NULL,
    doc_pages INTEGER,
    doc_b_name TEXT,
    doc_b_pages INTEGER,
    scanned_pages INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    provider TEXT,
    python INTEGER NOT NULL,
    focus TEXT,
    error TEXT,
    inputs INTEGER, matched INTEGER, matched_scan INTEGER, formulas INTEGER, recomputed INTEGER,
    failures INTEGER, warnings INTEGER, edited INTEGER, claims INTEGER, steps INTEGER,
    calls INTEGER, input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
    model_ms INTEGER, cost REAL,
    data TEXT NOT NULL               -- the whole run document as JSON
  );
  CREATE INDEX runs_created ON runs (created_at DESC);

  CREATE TABLE cells (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    sheet TEXT NOT NULL,
    ref TEXT NOT NULL,
    label TEXT,
    value_num REAL,
    value_text TEXT,
    formula TEXT,
    result REAL,                     -- recomputed formula value
    format TEXT,
    doc TEXT,                        -- A or B
    page INTEGER,
    quote TEXT,
    status TEXT,                     -- worst check: ok, scan, info, warn, fail
    text_source TEXT,                -- pdf, transcription or chart
    edited INTEGER NOT NULL DEFAULT 0,
    step INTEGER,
    checks TEXT,                     -- JSON list of the check messages
    PRIMARY KEY (run_id, sheet, ref)
  );
  CREATE INDEX cells_label ON cells (label COLLATE NOCASE);
  CREATE INDEX cells_value ON cells (value_num);

  CREATE TABLE claims (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    claim TEXT NOT NULL,
    doc TEXT,
    page INTEGER,
    verdict TEXT NOT NULL,
    evidence TEXT,
    gap TEXT,
    located INTEGER NOT NULL DEFAULT 0,
    step INTEGER,
    PRIMARY KEY (run_id, id)
  );

  CREATE TABLE calls (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    stage TEXT NOT NULL,             -- agent or transcribe
    step INTEGER,
    doc TEXT,
    page INTEGER,
    started_at TEXT,
    ms INTEGER,
    input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
    cost REAL,
    finish_reason TEXT,
    error TEXT,
    PRIMARY KEY (run_id, seq)
  );

  CREATE TABLE edits (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    at TEXT NOT NULL,
    sheet TEXT NOT NULL,
    ref TEXT NOT NULL,
    kind TEXT NOT NULL,              -- edit or reset
    before TEXT,
    after TEXT,
    PRIMARY KEY (run_id, seq)
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

type Store = { db: DatabaseSync; file: string; imported: number };

// One connection per process and database file, shared across route bundles in dev.
const holder = globalThis as unknown as { __footnoteDb?: Map<string, Store> };
holder.__footnoteDb ??= new Map();

export function openDb(): Store {
  const dir = dataDir();
  const file = path.join(dir, "footnote.db");
  const cached = holder.__footnoteDb!.get(file);
  if (cached) return cached;
  fs.mkdirSync(dir, { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  const store: Store = { db, file, imported: importFolders(db, path.join(dir, "runs")) };
  holder.__footnoteDb!.set(file, store);
  return store;
}

function migrate(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null } | undefined;
  let v = row?.v ?? 0;
  while (v < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v + 1);
    });
    v++;
  }
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Runs saved before the database existed live as data/runs/<id>/run.json. Import each one whose id the
// database does not have yet; the files stay where they are. Safe to run on every open.
export function importFolders(db: DatabaseSync, runsDir: string): number {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(runsDir).filter((i) => /^[a-z0-9-]+$/.test(i));
  } catch {
    return 0;
  }
  const has = db.prepare("SELECT 1 FROM runs WHERE id = ?");
  let n = 0;
  for (const id of ids) {
    if (has.get(id)) continue;
    let run: Run;
    try {
      run = JSON.parse(fs.readFileSync(path.join(runsDir, id, "run.json"), "utf8")) as Run;
    } catch {
      continue;
    }
    if (run?.id !== id) continue;
    writeRun(db, run);
    n++;
  }
  return n;
}

const RANK: Record<Status, number> = { fail: 4, warn: 3, scan: 2, info: 1, ok: 0 };

function worst(c: CheckedCell): Status | null {
  if (!c.checks?.length) return null;
  return c.checks.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a)).status;
}

function runKind(run: Run): "single" | "scanned" | "compare" {
  if (run.docB) return "compare";
  if (run.doc.scanned?.length) return "scanned";
  return "single";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The run and its normalised rows, replaced as one transaction.
export function writeRun(db: DatabaseSync, run: Run) {
  const calls = run.calls ?? [];
  const sum = (f: (c: Run["calls"][number]) => number) => calls.reduce((n, c) => n + f(c), 0);
  const costKnown = calls.length > 0 && calls.every((c) => c.cost !== null && c.cost !== undefined);
  const s = run.result?.summary;
  const scannedPages = (run.doc.scanned?.length ?? 0) + (run.docB?.scanned?.length ?? 0);
  const row: Record<string, SQLInputValue> = {
    id: run.id,
    created_at: run.createdAt,
    updated_at: new Date().toISOString(),
    status: run.status,
    kind: runKind(run),
    doc_name: run.doc.name,
    doc_pages: run.doc.pages ?? null,
    doc_b_name: run.docB?.name ?? null,
    doc_b_pages: run.docB?.pages ?? null,
    scanned_pages: scannedPages,
    model: run.model,
    provider: calls[0]?.provider ?? null,
    python: run.options?.python ? 1 : 0,
    focus: run.options?.focus ?? null,
    error: run.error ?? null,
    inputs: s?.inputs ?? null,
    matched: s?.matched ?? null,
    matched_scan: s?.matchedScan ?? null,
    formulas: s?.formulas ?? null,
    recomputed: s?.recomputed ?? null,
    failures: s?.failures ?? null,
    warnings: s?.warnings ?? null,
    edited: s?.edited ?? null,
    claims: (run.result?.claims ?? run.claims ?? []).length,
    steps: run.steps?.length ?? 0,
    calls: calls.length,
    input_tokens: sum((c) => c.usage.input),
    cached_tokens: sum((c) => c.usage.cachedInput),
    output_tokens: sum((c) => c.usage.output),
    reasoning_tokens: sum((c) => c.usage.reasoning),
    model_ms: sum((c) => c.ms),
    cost: costKnown ? sum((c) => c.cost ?? 0) : null,
    data: JSON.stringify(run),
  };
  tx(db, () => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO runs (${cols.join(", ")}) VALUES (${cols.map((c) => `:${c}`).join(", ")}) ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}`).run(row);
    for (const t of ["cells", "claims", "calls", "edits"]) db.prepare(`DELETE FROM ${t} WHERE run_id = ?`).run(run.id);

    // Checked cells when the checks have run, the cells as written while the model is still working.
    const cells: CheckedCell[] = run.result?.cells ?? (run.cells ?? []).map((c) => ({ ...c, checks: [] }));
    const scanned = { A: new Set(run.doc.scanned ?? []), B: new Set(run.docB?.scanned ?? []) };
    const insCell = db.prepare(
      "INSERT OR REPLACE INTO cells (run_id, sheet, ref, label, value_num, value_text, formula, result, format, doc, page, quote, status, text_source, edited, step, checks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const c of cells) {
      const doc = c.source ? (c.source.doc === "B" ? "B" : "A") : null;
      const source = !c.source ? null : c.source.box && !c.source.quote ? "chart" : scanned[doc === "B" ? "B" : "A"].has(c.source.page) ? "transcription" : "pdf";
      insCell.run(
        run.id,
        c.sheet,
        c.ref,
        c.label ?? null,
        num(c.value),
        typeof c.value === "string" ? c.value : null,
        c.formula ?? null,
        num(c.result),
        c.format ?? null,
        doc,
        c.source?.page ?? null,
        c.source?.quote ?? null,
        worst(c),
        source,
        c.edited ? 1 : 0,
        c.step ?? null,
        c.checks?.length ? JSON.stringify(c.checks) : null,
      );
    }

    const claims: CheckedClaim[] = run.result?.claims ?? (run.claims ?? []).map((c) => ({ ...c, quoted: false, at: { doc: c.doc ?? "A", page: c.page } }));
    const insClaim = db.prepare("INSERT OR REPLACE INTO claims (run_id, id, claim, doc, page, verdict, evidence, gap, located, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const c of claims) insClaim.run(run.id, c.id, c.claim, c.at?.doc ?? c.doc ?? "A", c.at?.page ?? c.page, c.verdict, c.evidence ?? null, c.gap ?? null, c.at?.lines?.length ? 1 : 0, c.step ?? null);

    const insCall = db.prepare(
      "INSERT INTO calls (run_id, seq, stage, step, doc, page, started_at, ms, input_tokens, cached_tokens, output_tokens, reasoning_tokens, cost, finish_reason, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    calls.forEach((c, i) => insCall.run(run.id, i, c.stage ?? "agent", c.step, c.doc ?? null, c.page ?? null, c.startedAt, c.ms, c.usage.input, c.usage.cachedInput, c.usage.output, c.usage.reasoning, c.cost ?? null, c.finishReason ?? null, c.error ?? null));

    const insEdit = db.prepare("INSERT INTO edits (run_id, seq, at, sheet, ref, kind, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    (run.edits ?? []).forEach((e, i) => insEdit.run(run.id, i, e.at, e.sheet, e.ref, e.kind, e.before ? JSON.stringify(e.before) : null, e.after ? JSON.stringify(e.after) : null));
  });
}

export function readRun(db: DatabaseSync, id: string): Run | null {
  const row = db.prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Run) : null;
}

export function readRuns(db: DatabaseSync): Run[] {
  return (db.prepare("SELECT data FROM runs ORDER BY created_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Run);
}

export type Totals = { runs: number; cost: number; costUnknown: number };

// What the runs on this machine have cost: the start page's total-spend line.
export function totals(db: DatabaseSync): Totals {
  const r = db
    .prepare(
      "SELECT COUNT(*) AS runs, COALESCE(SUM(cost), 0) AS cost, SUM(CASE WHEN cost IS NULL AND calls > 0 THEN 1 ELSE 0 END) AS costUnknown FROM runs",
    )
    .get() as Totals;
  return { runs: r.runs ?? 0, cost: r.cost ?? 0, costUnknown: r.costUnknown ?? 0 };
}

export type Hit = {
  runId: string;
  runName: string;
  createdAt: string;
  sheet: string;
  ref: string;
  label: string | null;
  value: number | null;
  valueText: string | null;
  formula: string | null;
  result: number | null;
  format: string | null;
  doc: string | null;
  docName: string | null;
  page: number | null;
  status: string | null;
  textSource: string | null;
  edited: boolean;
};

// Cells across every run by label or value. A query that reads as a number ("77,549", "3.6", "2.4%")
// also matches that value, including a percentage stored as a fraction.
export function searchCells(db: DatabaseSync, q: string, limit = 30): Hit[] {
  const text = q.trim().slice(0, 100);
  if (text.length < 2) return [];
  const n = Number(text.replace(/[,$\s]/g, "").replace(/%$/, ""));
  const isNum = /^[-+$]?[\d,]*\.?\d+%?$/.test(text.replace(/\s/g, "")) && Number.isFinite(n);
  const like = `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = db
    .prepare(
      `SELECT c.run_id, r.doc_name, r.doc_b_name, r.created_at, c.sheet, c.ref, c.label, c.value_num, c.value_text, c.formula, c.result, c.format, c.doc, c.page, c.status, c.text_source, c.edited
       FROM cells c JOIN runs r ON r.id = c.run_id
       WHERE (c.value_num IS NOT NULL OR c.formula IS NOT NULL)
         AND (c.label LIKE :like ESCAPE '\\' COLLATE NOCASE
              OR c.quote LIKE :like ESCAPE '\\' COLLATE NOCASE
              OR (:isNum = 1 AND (ABS(c.value_num - :n) < 1e-9 OR ABS(c.result - :n) < 1e-9 OR (c.format = 'percent' AND (ABS(c.value_num * 100 - :n) < 1e-9 OR ABS(c.result * 100 - :n) < 1e-6)))))
       ORDER BY (CASE WHEN :isNum = 1 AND (ABS(c.value_num - :n) < 1e-9 OR ABS(c.result - :n) < 1e-9) THEN 0 ELSE 1 END), r.created_at DESC, c.sheet, c.ref
       LIMIT :limit`,
    )
    .all({ like, isNum: isNum ? 1 : 0, n: isNum ? n : 0, limit }) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    runId: String(r.run_id),
    runName: r.doc_b_name ? pairTitle(String(r.doc_name), String(r.doc_b_name)) : String(r.doc_name),
    createdAt: String(r.created_at),
    sheet: String(r.sheet),
    ref: String(r.ref),
    label: (r.label as string) ?? null,
    value: (r.value_num as number) ?? null,
    valueText: (r.value_text as string) ?? null,
    formula: (r.formula as string) ?? null,
    result: (r.result as number) ?? null,
    format: (r.format as string) ?? null,
    doc: (r.doc as string) ?? null,
    docName: r.doc === "B" ? ((r.doc_b_name as string) ?? null) : r.doc ? String(r.doc_name) : null,
    page: (r.page as number) ?? null,
    status: (r.status as string) ?? null,
    textSource: (r.text_source as string) ?? null,
    edited: r.edited === 1,
  }));
}
