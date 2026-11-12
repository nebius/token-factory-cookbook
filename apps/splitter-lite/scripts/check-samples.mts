// Reproducible check on the synthetic sample bills: read each bill, split it with the model's tool calls,
// and compare both with the answer keys in samples/answers.json, to the cent.
//
//   npm run check-samples
//
// The expected split is computed from the answer key with the app's money engine, one bill at a time
// (each bill's tax, tip and fees over its own lines). Costs about $0.02 at Token Factory's catalog price.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { computeSplit } from "../src/lib/money/allocate.ts";
import { toMinor } from "../src/lib/money/format.ts";
import { extractReceiptWithNebius, type NebiusConfig } from "../src/server/ai/nebius.ts";
import { addUsage, costOf, emptyUsage, modelInfo } from "../src/server/ai/pricing.ts";
import type { ExtractedReceipt } from "../src/server/ai/receipt.ts";
import { runSplitAgent } from "../src/server/ai/split-agent.ts";

type Answer = {
  id: string;
  file: string;
  people: string[];
  note: string;
  currency: string;
  items: { name: string; quantity: number; totalPrice: number }[];
  tax: number | null;
  tip: number | null;
  serviceCharge: number | null;
  discount: number | null;
  total: number;
  /** Who had each line, by name. */
  assignment: string[][];
};

const cfg: NebiusConfig = {
  apiKey: process.env.NEBIUS_API_KEY ?? "",
  baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.us-north1.nebius.com/v1/",
  model: process.env.NEBIUS_MODEL || "nvidia/Nemotron-3.5-Super-VL",
};
if (!cfg.apiKey) {
  console.log("Set NEBIUS_API_KEY in .env first (cp env.example .env).");
  process.exit(1);
}

const answers: Answer[] = JSON.parse(await readFile(new URL("../samples/answers.json", import.meta.url), "utf8"));
const byId = new Map(answers.map((a) => [a.id, a]));

// Each sample with its own note, plus the two-bill night out from the README.
const cases: { name: string; bills: { id: string; assignment: string[][] }[]; people: string[]; note: string }[] = [
  ...answers.map((a) => ({ name: a.id, bills: [{ id: a.id, assignment: a.assignment }], people: a.people, note: a.note })),
  {
    name: "dinner-01 + taxi-01",
    bills: [
      { id: "dinner-01", assignment: byId.get("dinner-01")!.assignment },
      { id: "taxi-01", assignment: byId.get("taxi-01")!.items.map(() => ["Lukas", "Sophie"]) },
    ],
    people: ["Lukas", "Sophie", "Marco"],
    note: "Marco had the Grilled sea bass and skipped the taxi; Lukas and Sophie shared the House red; everything else is shared by everyone",
  },
];

/** The answer key's split: each bill on its own with the money engine, added up per person, in minor units. */
function expected(c: (typeof cases)[number]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(c.people.map((p) => [p, 0]));
  for (const b of c.bills) {
    const a = byId.get(b.id)!;
    const m = (n: number | null) => toMinor(n ?? 0, a.currency);
    const split = computeSplit({
      memberIds: c.people,
      items: a.items.map((it, i) => ({ id: String(i), amount: m(it.totalPrice), assignees: b.assignment[i].map((memberId) => ({ memberId, weight: 1 })) })),
      tax: m(a.tax),
      tip: m(a.tip),
      serviceCharge: m(a.serviceCharge),
      discount: m(a.discount),
    });
    for (const s of split.shares) out[s.memberId] += s.total;
  }
  return out;
}

/** The read is right when every line amount and every charge matches the answer key. */
function readMatches(r: ExtractedReceipt, a: Answer) {
  const m = (n: number | null | undefined) => toMinor(n ?? 0, a.currency);
  const amounts = (xs: { totalPrice: number }[]) => xs.map((x) => m(x.totalPrice)).sort((p, q) => p - q).join(",");
  return amounts(r.items) === amounts(a.items) && (["tax", "tip", "serviceCharge", "discount"] as const).every((k) => m(r[k]) === m(a[k])) && m(r.total) === m(a.total);
}

const info = await modelInfo(cfg);
const reads = new Map<string, ExtractedReceipt>();
let cost = 0;
let passed = 0;
console.log(`Model ${cfg.model} · reasoning on (Token Factory default) · ${info ? `$${info.inputPerM}/$${info.outputPerM} per 1M tokens` : "price unknown"}\n`);

for (const c of cases) {
  // Read each bill once and reuse it across cases, like a person would.
  for (const b of c.bills) {
    if (reads.has(b.id)) continue;
    const a = byId.get(b.id)!;
    const usage = emptyUsage();
    const image = `data:image/png;base64,${(await readFile(new URL(`../samples/${a.file}`, import.meta.url))).toString("base64")}`;
    reads.set(b.id, await extractReceiptWithNebius({ ...cfg, onUsage: (u) => addUsage(usage, u) }, [image]));
    cost += costOf(usage, info) ?? 0;
  }
  const people = c.people.map((name, i) => ({ id: `p${i}`, name }));
  const run = await runSplitAgent(cfg, { receipts: c.bills.map((b) => reads.get(b.id)!), people, note: c.note }, info);
  cost += run.usage.costUsd ?? 0;

  const want = expected(c);
  const got = Object.fromEntries(people.map((p) => [p.name, run.shares?.[p.id] == null ? null : toMinor(run.shares[p.id], byId.get(c.bills[0].id)!.currency)]));
  const readOk = c.bills.every((b) => readMatches(reads.get(b.id)!, byId.get(b.id)!));
  const splitOk = run.validation.ok && c.people.every((p) => got[p] === want[p]);
  if (splitOk) passed++;
  const fmt = (v: Record<string, number | null>) => c.people.map((p) => `${p} ${v[p] == null ? "–" : (v[p]! / 100).toFixed(2)}`).join(", ");
  console.log(`${splitOk ? "✓" : "✗"} ${c.name.padEnd(20)} read ${readOk ? "✓" : "✗"} · tool calls ${run.trace.filter((t) => t.by === "model").length} · app check ${run.validation.ok ? "✓" : "✗"}`);
  console.log(`    model:  ${fmt(got)}`);
  console.log(`    answer: ${fmt(want)}`);
}

console.log(`\n${passed}/${cases.length} splits match the answer keys to the cent · total cost $${cost.toFixed(4)}`);
process.exitCode = passed === cases.length ? 0 : 1;
