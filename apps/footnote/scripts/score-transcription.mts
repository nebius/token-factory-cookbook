// How well does the model read scanned pages? Takes an image-only PDF and the born-digital original it
// was rasterised from, has the model transcribe every page exactly as a run would, and scores the
// numbers against the original's text layer.
// Usage: pnpm score:transcription <image-only.pdf> <original.pdf> [label]
// Reads .env.local. This makes one live model call per page.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const [scanPath, origPath, label = path.basename(scanPath)] = process.argv.slice(2);
if (!scanPath || !origPath) {
  console.error("Usage: pnpm score:transcription <image-only.pdf> <original.pdf> [label]");
  process.exit(1);
}
// A throwaway data folder, so the scoring run never shows up in the app.
process.env.FOOTNOTE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "footnote-score-"));

const { readText } = await import("../src/lib/pdf.ts");
const { transcribe } = await import("../src/lib/transcribe.ts");
const { tokens } = await import("../src/lib/numbers.ts");
const { runDir, writeRunFile } = await import("../src/lib/runs.ts");
const { settings } = await import("../src/lib/model/client.ts");

const scan = fs.readFileSync(scanPath);
const scanPages = await readText(new Uint8Array(scan));
const origPages = await readText(new Uint8Array(fs.readFileSync(origPath)));
if (scanPages.length !== origPages.length) throw new Error("The two PDFs have different page counts.");

const runId = "score-run";
fs.mkdirSync(runDir(runId), { recursive: true });
await writeRunFile(runId, "document.pdf", scan);
const calls: { ms: number; usage: { input: number; output: number }; cost: number | null; error?: string }[] = [];
const t0 = Date.now();
const r = await transcribe({ runId, doc: "A", docName: label, hash: `score-${path.basename(scanPath)}`, pages: scanPages, onCall: (c) => calls.push(c), onPage: () => {}, concurrency: 4 });

// A number "as printed": its digits and decimal places, so 2.40 and 2.4 count as different readings.
const key = (t: { value: number; decimals: number }) => `${Math.abs(t.value).toFixed(t.decimals)}`;
let total = 0;
let found = 0;
let read = 0;
const misses: string[] = [];
const extras: string[] = [];
const perPage: string[] = [];
for (const p of origPages) {
  const want = new Map<string, number>();
  for (const t of tokens(p.text)) want.set(key(t), (want.get(key(t)) ?? 0) + 1);
  const got = new Map<string, number>();
  for (const t of tokens(r.pages[p.n - 1].text)) got.set(key(t), (got.get(key(t)) ?? 0) + 1);
  let pageFound = 0;
  let pageTotal = 0;
  for (const [k, n] of want) {
    const hit = Math.min(n, got.get(k) ?? 0);
    pageFound += hit;
    pageTotal += n;
    if (hit < n) misses.push(`p${p.n} ${k}${n - hit > 1 ? ` ×${n - hit}` : ""}`);
  }
  let pageRead = 0;
  for (const [k, n] of got) {
    pageRead += n;
    const extra = n - Math.min(n, want.get(k) ?? 0);
    if (extra > 0) extras.push(`p${p.n} ${k}${extra > 1 ? ` ×${extra}` : ""}`);
  }
  total += pageTotal;
  found += pageFound;
  read += pageRead;
  perPage.push(`p${p.n}: ${pageFound}/${pageTotal}`);
}
const cost = calls.reduce((n, c) => n + (c.cost ?? 0), 0);
console.log(
  JSON.stringify(
    {
      document: label,
      model: settings().model,
      pages: origPages.length,
      transcribed: r.read.length,
      failed: r.failed,
      numbersInOriginal: total,
      recovered: found,
      recall: +(found / total).toFixed(4),
      numbersInTranscription: read,
      notInOriginal: read - found,
      precision: +(found / read).toFixed(4),
      perPage,
      misses: misses.slice(0, 40),
      notInOriginalExamples: extras.slice(0, 40),
      calls: calls.length,
      callErrors: calls.filter((c) => c.error).length,
      wallSeconds: (Date.now() - t0) / 1000,
      modelSeconds: calls.reduce((n, c) => n + c.ms, 0) / 1000,
      tokens: { input: calls.reduce((n, c) => n + c.usage.input, 0), output: calls.reduce((n, c) => n + c.usage.output, 0) },
      cost: +cost.toFixed(4),
    },
    null,
    2,
  ),
);
fs.rmSync(process.env.FOOTNOTE_DATA_DIR!, { recursive: true, force: true });
