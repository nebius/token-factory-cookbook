import crypto from "node:crypto";
import { dataDir, openDb, readRun, readRuns, writeRun } from "@/lib/db";
import fs from "node:fs/promises";
import path from "node:path";
import type { CallLog } from "@/lib/model/client";
import type { Cell, CheckedCell, CheckedClaim, Claim, Summary } from "@/lib/book";
import type { PageText } from "@/lib/pdf";

// A run's structured data (status, cells, claims, calls, edits) lives in the SQLite database
// (lib/db.ts). Its files live in data/runs/<id>/: the PDFs, their text layers (pages.json), page
// images, the crops the model looked at and model.xlsx.
const DATA_DIR = dataDir();
const RUNS = path.join(DATA_DIR, "runs");

export type Status = "reading" | "transcribing" | "working" | "checking" | "done" | "failed";

// A run reads one document (A), or two when comparing (A, the earlier or first, and B).
export type DocKey = "A" | "B";

export type DocInfo = {
  name: string;
  pages: number;
  sizes: [number, number][];
  hash: string;
  source?: Source;
  // Pages with no usable PDF text (a scan, or a scan under a hidden OCR layer) that the model read from the image.
  scanned?: number[];
  unread?: number[]; // scanned pages the model could not transcribe
};

export type TraceCall = {
  id: string;
  name: string;
  args: unknown;
  ok: boolean;
  summary: string; // one line for the trace
  output?: string; // what the tool returned to the model (trimmed)
  images?: { file: string; page: number; crop?: number[]; doc?: DocKey }[];
  python?: { code: string; stdout: string; stderr: string; ms: number };
};

export type Step = { n: number; at: string; text: string; reasoning: string; calls: TraceCall[]; cutOff?: boolean };

export type Source = { name: string; url?: string; licence?: string; author?: string; note?: string };

export type Run = {
  id: string;
  createdAt: string;
  status: Status;
  progress: { stage: string; step: number; chars: number };
  doc: DocInfo;
  docB?: DocInfo;
  options: { python: boolean; focus: string };
  model: string;
  limits?: { steps: number; maxTokens: number };
  steps: Step[];
  cells: Cell[];
  claims: Claim[];
  note?: string;
  result?: { cells: CheckedCell[]; claims: CheckedClaim[]; summary: Summary };
  calls: CallLog[];
  error?: string;
  // Changes made by hand on the run page, oldest first, and the model's own version of each edited cell.
  edits?: Edit[];
  original?: Record<string, Cell | null>;
};

export type Edit = { at: string; sheet: string; ref: string; kind: "edit" | "reset"; before: Cell | null; after: Cell | null };

// Document B's files sit next to A's with a "-b" suffix: document-b.pdf, pages-b.json, page-b-3.png.
export function docFile(key: DocKey | undefined, name: string) {
  if (key !== "B") return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const m = base.match(/^page-(\d+)$/);
  return m ? `page-b-${m[1]}${ext}` : `${base}-b${ext}`;
}

export function runDir(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad run id");
  return path.join(RUNS, id);
}

export function newId() {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
}

// Saves the run and its normalised rows in one transaction, and makes sure its file folder exists.
export async function saveRun(run: Run) {
  runDir(run.id);
  await fs.mkdir(runDir(run.id), { recursive: true });
  writeRun(openDb().db, run);
}

export async function loadRun(id: string): Promise<Run | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  return readRun(openDb().db, id);
}

export async function listRuns(): Promise<Run[]> {
  return readRuns(openDb().db);
}

export async function writeRunFile(id: string, name: string, data: Buffer | string) {
  await fs.writeFile(path.join(runDir(id), safe(name)), data);
}

export async function readRunFile(id: string, name: string): Promise<Buffer> {
  return fs.readFile(path.join(runDir(id), safe(name)));
}

export async function hasRunFile(id: string, name: string) {
  try {
    await fs.access(path.join(runDir(id), safe(name)));
    return true;
  } catch {
    return false;
  }
}

function safe(name: string) {
  if (!/^[a-z0-9._-]+$/i.test(name) || name.startsWith(".")) throw new Error("bad file name");
  return name;
}

export async function loadPages(id: string, key: DocKey = "A"): Promise<PageText[]> {
  return JSON.parse((await readRunFile(id, docFile(key, "pages.json"))).toString("utf8")) as PageText[];
}
