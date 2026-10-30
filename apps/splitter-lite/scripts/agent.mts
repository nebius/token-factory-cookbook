// The app's AI pipeline without a browser: read the bill(s), then split with the model's own tool calls.
//
//   npm run agent -- samples/groceries-21.png "Sophie had the Coffee beans 500g, Lukas had the Dish soap, the rest shared" Lukas,Sophie
//   npm run agent -- samples/dinner-01.png samples/taxi-01.png "everything shared" Lukas,Sophie,Marco
//
// Several images are read as separate bills (one AI call each) and combined into one split, like the app does.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { mergeReceipts } from "../src/components/split/merge-receipts.ts";
import { extractReceiptWithNebius, type NebiusConfig } from "../src/server/ai/nebius.ts";
import { addUsage, costOf, emptyUsage, modelInfo, type UsageReport } from "../src/server/ai/pricing.ts";
import { reconcileReceipt } from "../src/server/ai/receipt.ts";
import { runSplitAgent } from "../src/server/ai/split-agent.ts";

const cfg: NebiusConfig = {
  apiKey: process.env.NEBIUS_API_KEY ?? "",
  baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.us-north1.nebius.com/v1/",
  model: process.env.NEBIUS_MODEL || "nvidia/Nemotron-3.5-Super-VL",
};

const args = process.argv.slice(2);
const images = args.filter((a) => /\.(png|jpe?g|webp)$/i.test(a));
const [note, peopleArg = "Lukas,Sophie"] = args.filter((a) => !images.includes(a));
if (!images.length || !note || images.length > 2) {
  console.log('Usage: npm run agent -- <bill.png> [a second bill] "<who had what>" [Name1,Name2,...]');
  process.exit(1);
}
if (!cfg.apiKey) {
  console.log("Set NEBIUS_API_KEY in .env first (cp env.example .env).");
  process.exit(1);
}

const usd = (n: number | null) => (n == null ? "price unknown" : `$${n.toFixed(5)}`);
const line = (label: string, u: UsageReport) =>
  `  ${label.padEnd(34)} ${String(u.input).padStart(6)} in  ${String(u.output).padStart(5)} out (${u.reasoning} reasoning)  ${(u.ms / 1000).toFixed(1).padStart(5)}s  ${usd(u.costUsd)}`;

const info = await modelInfo(cfg);
console.log(`\nModel     ${cfg.model}`);
console.log(`Endpoint  ${cfg.baseURL}`);
console.log(`Reasoning on (Token Factory default; no reasoning or sampling fields are sent)`);
console.log(
  info
    ? `Price     $${info.inputPerM.toFixed(2)} / 1M input · $${info.outputPerM.toFixed(2)} / 1M output  (${info.source}, ${info.fetchedAt.slice(0, 10)})`
    : "Price     not available from the catalog",
);

// 1 · READ: one AI call per bill, in parallel, like the app.
const reads = await Promise.all(
  images.map(async (file) => {
    const usage = emptyUsage();
    const started = performance.now();
    const image = `data:image/${file.toLowerCase().endsWith(".png") ? "png" : file.toLowerCase().endsWith(".webp") ? "webp" : "jpeg"};base64,${(await readFile(file)).toString("base64")}`;
    const receipt = await extractReceiptWithNebius({ ...cfg, onUsage: (u) => addUsage(usage, u) }, [image]);
    return { file, receipt, usage: { ...usage, ms: Math.round(performance.now() - started), costUsd: costOf(usage, info) } };
  }),
);
console.log(`\n1 · READ`);
for (const r of reads) {
  const issues = reconcileReceipt(r.receipt);
  console.log(`  ${r.file}: ${r.receipt.merchant} · ${r.receipt.items.length} lines · printed total ${r.receipt.total} ${r.receipt.currency}${issues.length ? `  ⚠ ${issues.map((i) => i.message).join(" ")}` : ""}`);
  for (const it of r.receipt.items) console.log(`      ${it.name} ×${it.quantity} = ${it.totalPrice}`);
}

// Several bills stay separate for the split, so each bill's tax, tip and fees are spread over its own lines.
if (reads.length > 1) {
  const merged = mergeReceipts(reads.map((r) => ({ receipt: r.receipt, issues: [] })));
  if ("error" in merged) {
    console.log(`\n✗ ${merged.error}`);
    process.exit(1);
  }
  console.log(`  Split together: ${merged.receipt.items.length} lines across ${reads.length} bills, total ${merged.receipt.total} ${merged.receipt.currency}`);
}

// 2 · SPLIT: the model assigns lines from the note and calls the calculator tools.
const people = peopleArg.split(",").map((name, i) => ({ id: `p${i + 1}`, name: name.trim() }));
const run = await runSplitAgent(cfg, { receipts: reads.map((r) => r.receipt), people, note }, info);
console.log(`\n2 · SPLIT (${(run.usage.ms / 1000).toFixed(1)}s, ${run.usage.calls} model turns)`);
for (const c of run.trace) console.log(`  ${c.ok ? "✓" : "✗"} ${c.by.toUpperCase().padEnd(5)} ${c.tool}(${JSON.stringify(c.args)})\n          → ${JSON.stringify(c.result)}`);
if (run.receiptIssues.length) console.log(`\n⚠ Bill issues the model reported: ${run.receiptIssues.join(" ")}`);

const nameOf = new Map(people.map((p) => [p.id, p.name]));
console.log(`\nThe model's split (${reads[0].receipt.currency}):`);
for (const [id, amount] of Object.entries(run.shares ?? {})) console.log(`  ${nameOf.get(id)?.padEnd(10)} ${amount.toFixed(2)}`);
if (!run.shares) console.log("  none");
console.log(`Validation ${run.validation.ok ? "✓" : "✗"} ${run.validation.reason}`);
console.log(`Why: ${run.explanation}`);

console.log(`\nAI usage`);
for (const r of reads) console.log(line(`read ${r.file.split("/").pop()}`, r.usage));
console.log(line("split with tools", run.usage));
const all = [...reads.map((r) => r.usage), run.usage];
const total = all.reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output, reasoning: a.reasoning + u.reasoning, calls: a.calls + u.calls, ms: a.ms + u.ms, costUsd: (a.costUsd ?? 0) + (u.costUsd ?? 0) }), { ...emptyUsage(), ms: 0, costUsd: 0 } as UsageReport);
console.log(line("total", { ...total, costUsd: all.every((u) => u.costUsd != null) ? total.costUsd : null }));
