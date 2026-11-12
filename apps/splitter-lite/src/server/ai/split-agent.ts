// Bills → checked split with the model's own tool calls (from Splitter's benchmark agent, receipt-agent.mts).
//   REASON     with a note ("Sophie had the coffee, rest shared") the model decides who had each line;
//              with lines already tapped in the UI, it uses those as given.
//   CALCULATE  it calls the calculator tools for every number: check_receipt and allocate_tax_tip for each bill,
//              then validate_total. Its own allocate_tax_tip results are the split. Each bill's tax, tip and fees
//              are spread over that bill's lines only, so the taxi's fare isn't charged a share of the dinner tip.
//   VALIDATE   the app then checks one rule: the shares add up to what the bills' lines and charges come to.
// The app never computes the split for the model. A missing tool call is reported as a failure.
import { z } from "zod";
import { fromMinor, toMinor } from "@/lib/money";
import { chatWithTools, type NebiusConfig } from "./nebius";
import { addUsage, costOf, emptyUsage, reasoningLog, type ModelInfo, type UsageReport } from "./pricing";
import type { ExtractedReceipt } from "./receipt";
import { createTools, toolDefinitions, type ToolCall } from "./tools";

export type SplitPerson = { id: string; name: string };
export type LineAssignment = { bill: number; line: number; members: string[] };

export type SplitRequest = {
  /** One or two bills, split together. */
  receipts: ExtractedReceipt[];
  people: SplitPerson[];
  /** Plain English: who had what. The model decides the assignment. */
  note?: string;
  /** Who had each line, by person id, already decided in the UI. The model only calculates. */
  lines?: LineAssignment[];
};

export type SplitResult = {
  mode: "note" | "lines";
  /** Who had each line (person ids), as the model passed it to allocate_tax_tip. */
  lines: LineAssignment[] | null;
  /** Each person's share by id, in major units: the sum of the model's allocate_tax_tip results. */
  shares: Record<string, number> | null;
  total: number | null;
  validation: { ok: boolean; reason: string };
  receiptIssues: string[];
  explanation: string;
  /** Every tool call (model and app), with member refs shown as names. */
  trace: ToolCall[];
  usage: UsageReport;
};

const decisionSchema = z.object({
  lines: z
    .array(z.object({ bill: z.number().int(), line: z.number().int(), members: z.array(z.string()) }))
    .describe("Who had each line of each bill"),
  receiptIssues: z.array(z.string()).describe("Problems check_receipt found, in plain words; [] if none"),
  explanation: z.string(),
});

const REPLY = `Do every sum with the tools, never in your head. Reply with ONLY this JSON: {"lines":[{"bill":1,"line":1,"members":["m1"]}],"receiptIssues":[],"explanation":"..."}`;

export const NOTE_SYSTEM = `You split bills between friends. You get one or more bills (lines already read from the photos), the people (as refs m1, m2…) and a note saying who had what.
Steps:
1. Call check_receipt for every bill. If it reports problems, list them in receiptIssues.
2. Decide who had each line from the note. "Everyone" means all people. Lines the note doesn't mention are shared by everyone. Every line needs at least one person.
3. Call allocate_tax_tip once for every bill, with your line assignment for that bill. Its shares are the answer: each bill's tax, tip, fees and discount are spread by the tool over that bill's lines.
4. Add the bills up with validate_total: pass each person's combined share and the combined total of the allocate_tax_tip results, to confirm they add up.
${REPLY}`;

export const LINES_SYSTEM = `You split bills between friends. You get one or more bills (lines already read from the photos), the people (as refs m1, m2…) and who had each line, already decided.
Steps:
1. Call check_receipt for every bill. If it reports problems, list them in receiptIssues.
2. Call allocate_tax_tip once for every bill, with exactly the given assignment for that bill. Do not change it. Its shares are the answer: each bill's tax, tip, fees and discount are spread by the tool over that bill's lines.
3. Call validate_total with each person's combined share and the combined total of the allocate_tax_tip results, to confirm they add up.
${REPLY}`;

/** Replaces member refs (m1, m2…) with names in tool arguments and results, for display. */
function renameRefs(value: unknown, names: Map<string, string>): unknown {
  if (typeof value === "string") return names.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, names));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [names.get(k) ?? k, renameRefs(v, names)]));
  return value;
}

const assignmentOf = (lines: LineAssignment[]) =>
  JSON.stringify(
    lines
      .map((l) => [l.bill, l.line, [...new Set(l.members)].sort()] as const)
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]),
  );

export async function runSplitAgent(cfg: NebiusConfig, req: SplitRequest, info: ModelInfo | null): Promise<SplitResult> {
  const { receipts, people } = req;
  const currency = receipts[0]?.currency ?? "USD";
  const mode: SplitResult["mode"] = req.lines ? "lines" : "note";
  const usage = emptyUsage();
  const thoughts = reasoningLog();
  const metered: NebiusConfig = { ...cfg, onUsage: (u) => addUsage(usage, u), onReasoning: thoughts.add };

  const refs = people.map((p, i) => ({ ref: `m${i + 1}`, ...p }));
  const refOfId = new Map(refs.map((r) => [r.id, r.ref]));
  const idOfRef = new Map(refs.map((r) => [r.ref, r.id]));
  const nameOfRef = new Map(refs.map((r) => [r.ref, r.name]));
  const given = req.lines?.map((l) => ({ ...l, members: l.members.map((m) => refOfId.get(m) ?? m) }));

  const bills = receipts.map((receipt, i) => ({ no: i + 1, receipt }));
  const tools = createTools({ currency, memberRefs: refs.map((r) => r.ref), bills });
  const trace: ToolCall[] = [];
  const user = [
    `People: ${refs.map((r) => `${r.ref}=${r.name}`).join(", ")}`,
    mode === "note"
      ? `Note: ${req.note?.trim() || "Everyone shared everything."}`
      : `Who had each line (already decided): ${given!.map((l) => `bill ${l.bill} line ${l.line}: ${l.members.join(", ")}`).join("; ")}`,
    ...bills.flatMap(({ no, receipt: r }) => [
      `Bill ${no}: ${r.merchant ?? "?"} · ${r.currency ?? currency}`,
      ...r.items.map((it, i) => `  line ${i + 1}: ${it.name} ×${it.quantity} = ${it.totalPrice}`),
      `  subtotal ${r.subtotal} · tax ${r.tax} · tip ${r.tip} · service ${r.serviceCharge} · discount ${r.discount} · total ${r.total}`,
    ]),
  ].join("\n");

  const started = performance.now();
  const decision = await chatWithTools(metered, {
    system: mode === "note" ? NOTE_SYSTEM : LINES_SYSTEM,
    user,
    schema: decisionSchema,
    tools: toolDefinitions,
    maxCalls: 4 + 2 * bills.length,
    runTool: (name, args) => {
      const call = tools.run(name, args, "model");
      trace.push(call);
      return call.result;
    },
  });
  const ms = Math.round(performance.now() - started);
  const report = { ...usage, ms, costUsd: costOf(usage, info), reasoningText: thoughts.text() };
  const done = (rest: Pick<SplitResult, "lines" | "shares" | "total" | "validation">): SplitResult => ({
    mode,
    ...rest,
    receiptIssues: decision.receiptIssues,
    explanation: decision.explanation.replace(/\bm\d+\b/g, (r) => nameOfRef.get(r) ?? r),
    trace: trace.map((c) => ({ ...c, args: renameRefs(c.args, nameOfRef), result: renameRefs(c.result, nameOfRef) })),
    usage: report,
  });

  // The answer is the model's own last successful allocation for each bill. The app does not compute one for it.
  const allocations = bills.map(({ no }) =>
    [...trace].reverse().find((c) => c.by === "model" && c.tool === "allocate_tax_tip" && c.ok && (c.args as { bill?: number }).bill === no),
  );
  const missing = bills.filter((_, i) => !allocations[i]).map((b) => b.no);
  if (missing.length) {
    return done({
      lines: null,
      shares: null,
      total: null,
      validation: { ok: false, reason: `The model never made a successful allocate_tax_tip call for bill ${missing.join(", ")}, so there is no split to check.` },
    });
  }

  const usedLines: LineAssignment[] = allocations.flatMap((c) => {
    const a = c!.args as { bill: number; lines: { line: number; members: string[] }[] };
    return a.lines.map((l) => ({ bill: a.bill, ...l }));
  });
  // Add each bill's shares up in minor units, so rounding can't drift.
  const sharesMinor = new Map<string, number>();
  let totalMinor = 0;
  for (const c of allocations) {
    const r = c!.result as { total: number; shares: Record<string, number> };
    totalMinor += toMinor(r.total, currency);
    for (const [ref, v] of Object.entries(r.shares)) sharesMinor.set(ref, (sharesMinor.get(ref) ?? 0) + toMinor(v, currency));
  }
  const shares = Object.fromEntries([...sharesMinor].map(([ref, v]) => [ref, fromMinor(v, currency)]));

  // Validation rule: the shares must add up to the bills' own lines + charges (independent of the printed totals).
  const expectedMinor = receipts.reduce(
    (a, r) => a + r.items.reduce((s, i) => s + toMinor(i.totalPrice, currency), 0) + toMinor((r.tax ?? 0) + (r.tip ?? 0) + (r.serviceCharge ?? 0) - (r.discount ?? 0), currency),
    0,
  );
  const expected = fromMinor(expectedMinor, currency);
  let validation: SplitResult["validation"];
  if (given && assignmentOf(given) !== assignmentOf(usedLines)) validation = { ok: false, reason: "The model changed who had which line instead of using your assignment." };
  else {
    const check = tools.run("validate_total", { total: expected, shares: Object.entries(shares).map(([member, amount]) => ({ member, amount })) }, "app");
    trace.push(check);
    validation = check.ok
      ? { ok: true, reason: `Shares add up to ${expected}, what the bill${bills.length > 1 ? "s'" : "'s"} lines and charges come to.` }
      : { ok: false, reason: `Shares don't add up to ${expected}.` };
  }

  return done({
    lines: usedLines.map((l) => ({ ...l, members: l.members.map((m) => idOfRef.get(m) ?? m) })),
    shares: Object.fromEntries(Object.entries(shares).map(([ref, v]) => [idOfRef.get(ref) ?? ref, v])),
    total: fromMinor(totalMinor, currency),
    validation,
  });
}
