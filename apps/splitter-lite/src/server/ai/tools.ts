// Deterministic tools the planner calls while it works out a settlement. The model decides WHAT to
// compute; these functions do the arithmetic with the app's money engine, so every number in the
// final plan has been checked by code rather than estimated by the model.
import type OpenAI from "openai";
import { z } from "zod";
import { computeSplit, fromMinor, SplitError, toMinor } from "@/lib/money";
import { reconcileReceipt, type ExtractedReceipt } from "./receipt";

export type ToolContext = {
  currency: string;
  memberRefs: string[];
  bills: { no: number; receipt: ExtractedReceipt }[];
};

/** One recorded tool call, shown to people as "How this was checked". */
export type ToolCall = {
  tool: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  ms: number;
  /** "model" when the model chose to call it; "app" when the app ran it as a check. */
  by: "model" | "app";
};

const participant = z.object({
  member: z.string().describe("Member ref like m1"),
  shares: z.number().nullable().optional().describe("For mode=shares"),
  amount: z.number().nullable().optional().describe("For mode=exact, major units"),
});

const args = {
  check_receipt: z.object({ bill: z.number().int().describe("Bill number") }),
  allocate_tax_tip: z.object({
    bill: z.number().int(),
    lines: z.array(z.object({ line: z.number().int().describe("1-based line number"), members: z.array(z.string()) })),
  }),
  calculate_split: z.object({
    amount: z.number().describe("Expense total, major units"),
    mode: z.enum(["equal", "shares", "exact"]),
    participants: z.array(participant).min(1),
  }),
  validate_total: z.object({
    total: z.number().describe("Expense total, major units"),
    shares: z.array(z.object({ member: z.string(), amount: z.number() })).min(1),
  }),
};
export type ToolName = keyof typeof args;

const DESCRIPTIONS: Record<ToolName, string> = {
  check_receipt:
    "Checks a bill's arithmetic: do the lines add up to the subtotal, and do subtotal + tax + tip + fees - discount equal the printed total? Call it for every bill before using its total.",
  allocate_tax_tip:
    "Splits one bill by who had which line. Tax, tip, fees and discount are spread in proportion to each person's lines. Returns each member's exact share.",
  calculate_split:
    "Splits an amount equally, by shares (ratios) or by exact amounts. Returns each member's exact share, rounded so the parts sum to the amount.",
  validate_total: "Checks that per-person shares add up exactly to an expense total. Returns the difference if they don't.",
};

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = (Object.keys(args) as ToolName[]).map((name) => {
  const { $schema: _s, ...parameters } = z.toJSONSchema(args[name], { target: "draft-7" });
  return { type: "function", function: { name, description: DESCRIPTIONS[name], parameters } };
});

class ToolInputError extends Error {}

export function createTools(ctx: ToolContext) {
  const minor = (n: number) => toMinor(n, ctx.currency);
  const major = (n: number) => fromMinor(n, ctx.currency);
  const known = new Set(ctx.memberRefs);
  const billOf = (no: number) => {
    const b = ctx.bills.find((x) => x.no === no)?.receipt;
    if (!b) throw new ToolInputError(`There is no bill #${no}`);
    return b;
  };
  const checkMembers = (refs: string[]) => {
    const unknown = refs.filter((r) => !known.has(r));
    if (unknown.length) throw new ToolInputError(`Unknown member refs: ${unknown.join(", ")}`);
  };
  const perMember = (refs: string[], totals: number[]) => Object.fromEntries(refs.map((r, i) => [r, major(totals[i])]));

  const impl = {
    check_receipt({ bill }: z.infer<typeof args.check_receipt>) {
      const r = billOf(bill);
      const issues = reconcileReceipt(r).filter((i) => i.field !== "currency");
      const itemsSum = r.items.reduce((a, i) => a + i.totalPrice, 0);
      return { bill, ok: issues.length === 0, issues: issues.map((i) => i.message), linesTotal: Math.round(itemsSum * 100) / 100, printedTotal: r.total };
    },

    allocate_tax_tip({ bill, lines }: z.infer<typeof args.allocate_tax_tip>) {
      const r = billOf(bill);
      // Group order, not argument order, so a left-over cent always goes to the same person.
      const used = new Set(lines.flatMap((l) => l.members));
      const refs = [...ctx.memberRefs.filter((r) => used.has(r)), ...[...used].filter((r) => !known.has(r))];
      checkMembers(refs);
      const byLine = new Map(lines.map((l) => [l.line, l.members]));
      const missing = r.items.map((_, i) => i + 1).filter((n) => !byLine.get(n)?.length);
      if (missing.length) throw new ToolInputError(`Lines ${missing.join(", ")} have nobody assigned`);
      const res = computeSplit({
        memberIds: refs,
        items: r.items.map((it, i) => ({ id: String(i + 1), amount: minor(it.totalPrice), assignees: [...new Set(byLine.get(i + 1)!)].sort((x, y) => refs.indexOf(x) - refs.indexOf(y)).map((m) => ({ memberId: m, weight: 1 })) })),
        tax: minor(r.tax ?? 0),
        tip: minor(r.tip ?? 0),
        serviceCharge: minor(r.serviceCharge ?? 0),
        discount: minor(r.discount ?? 0),
      });
      return { bill, total: major(res.total), shares: perMember(refs, res.shares.map((s) => s.total)) };
    },

    calculate_split({ amount, mode, participants }: z.infer<typeof args.calculate_split>) {
      const refs = participants.map((p) => p.member);
      checkMembers(refs);
      const total = minor(amount);
      if (mode === "exact") {
        const parts = participants.map((p) => minor(p.amount ?? 0));
        const diff = parts.reduce((a, b) => a + b, 0) - total;
        return { amount, shares: perMember(refs, parts), ok: diff === 0, ...(diff ? { unassigned: major(-diff) } : {}) };
      }
      const weights = participants.map((p) => (mode === "shares" ? (p.shares ?? 1) : 1));
      const res = computeSplit({ memberIds: refs, items: [{ id: "x", amount: total, assignees: refs.map((m, i) => ({ memberId: m, weight: weights[i] })) }] });
      return { amount, shares: perMember(refs, res.shares.map((s) => s.total)), ok: true };
    },

    validate_total({ total, shares }: z.infer<typeof args.validate_total>) {
      checkMembers(shares.map((s) => s.member));
      const sum = shares.reduce((a, s) => a + minor(s.amount), 0);
      const diff = sum - minor(total);
      return { ok: diff === 0, total, sharesSum: major(sum), diff: major(diff) };
    },
  };

  /** Runs a tool by name with raw JSON arguments. Bad input becomes an error result the model can correct. */
  function run(name: string, raw: unknown, by: ToolCall["by"] = "model"): ToolCall {
    const started = performance.now();
    let result: unknown;
    let ok = false;
    let input: unknown = raw;
    try {
      if (typeof raw === "string") input = JSON.parse(raw || "{}");
      if (!(name in args)) throw new ToolInputError(`Unknown tool ${name}`);
      const parsed = args[name as ToolName].parse(input);
      result = impl[name as ToolName](parsed as never);
      ok = (result as { ok?: boolean }).ok !== false;
    } catch (e) {
      const message = e instanceof ToolInputError || e instanceof SplitError ? e.message : e instanceof z.ZodError ? `Invalid arguments: ${e.issues[0]?.message}` : "Invalid arguments";
      result = { error: message };
    }
    return { tool: name, args: input, result, ok, ms: Math.round(performance.now() - started), by };
  }

  return { run };
}
