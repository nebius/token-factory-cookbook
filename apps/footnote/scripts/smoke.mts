// One run from the command line, exactly as the app does it.
// Usage: pnpm smoke <example-id | file.pdf> [--no-python] [--focus "..."]
// Reads .env.local. Set INKLING_RECORD=1 to save the replies as replay fixtures.
import fs from "node:fs";
import path from "node:path";

for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { settings } = await import("../src/lib/model/client.ts");
const { startRun } = await import("../src/lib/pipeline.ts");
const { loadRun } = await import("../src/lib/runs.ts");
const { listExamples, exampleFile, exampleSource } = await import("../src/lib/examples.ts");

const target = process.argv[2];
if (!target) {
  console.error('Usage: pnpm smoke <example-id | file.pdf> [--no-python] [--focus "..."]');
  process.exit(1);
}
const python = !process.argv.includes("--no-python");
const fi = process.argv.indexOf("--focus");
const s = settings();
console.log(`Model: ${s.model} via ${s.provider}${s.record ? " (recording replays)" : ""}, Python ${python ? "on" : "off"}`);

const ex = (await listExamples()).find((e) => e.id === target);
const id = ex
  ? await startRun(await exampleFile(ex.file), exampleSource(ex), { python, focus: fi > 0 ? process.argv[fi + 1] : ex.focus }, ex.b ? { pdf: await exampleFile(ex.b.file), source: exampleSource(ex.b) } : undefined)
  : await startRun(fs.readFileSync(target), { name: path.basename(target, ".pdf") }, { python, focus: fi > 0 ? process.argv[fi + 1] : undefined });
console.log(`Run ${id}`);
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const run = await loadRun(id);
  if (!run) continue;
  const line = `${run.status}: ${run.progress.stage}`;
  if (line !== last) console.log(`${new Date().toISOString().slice(11, 19)} ${line}`), (last = line);
  if (run.status === "done" || run.status === "failed") {
    const t = run.calls.reduce((a, c) => ({ input: a.input + c.usage.input, cached: a.cached + c.usage.cachedInput, output: a.output + c.usage.output, reasoning: a.reasoning + c.usage.reasoning, ms: a.ms + c.ms, cost: a.cost + (c.cost ?? 0) }), { input: 0, cached: 0, output: 0, reasoning: 0, ms: 0, cost: 0 });
    console.log(JSON.stringify({ status: run.status, error: run.error, summary: run.result?.summary, scanned: run.doc.scanned, unread: run.doc.unread, docB: run.docB?.name, claims: run.result?.claims.map((c) => `${c.verdict}: ${c.claim.slice(0, 90)}`), note: run.note, steps: run.steps.length, tools: run.steps.flatMap((x) => x.calls.map((c) => `${x.n}:${c.name}${c.ok ? "" : "(error)"}`)).join(" "), totals: t }, null, 2));
    console.log(`Open http://localhost:3218/run/${id}`);
    process.exit(run.status === "done" ? 0 : 1);
  }
}
