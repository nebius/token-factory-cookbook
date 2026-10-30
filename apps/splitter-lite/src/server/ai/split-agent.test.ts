import { describe, expect, it, vi } from "vitest";
import type { ExtractedReceipt } from "./receipt";

// A scripted model: chatWithTools runs the tool calls listed in `script` through the real tools, then answers.
let script: { name: string; args: unknown }[] = [];
vi.mock("./nebius", () => ({
  chatWithTools: async (cfg: { onUsage?: (u: unknown) => void }, opts: { runTool: (n: string, a: string) => unknown }) => {
    for (const c of script) opts.runTool(c.name, JSON.stringify(c.args));
    cfg.onUsage?.({ prompt_tokens: 1200, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 250 } });
    return { lines: [], receiptIssues: [], explanation: "m1 had the coffee; m2 shared the rest" };
  },
}));

const { runSplitAgent } = await import("./split-agent");

const receipt: ExtractedReceipt = {
  kind: "receipt",
  merchant: "Cafe",
  category: null,
  date: null,
  currency: "EUR",
  items: [
    { name: "Coffee", quantity: 1, totalPrice: 4 },
    { name: "Cake", quantity: 1, totalPrice: 6 },
  ],
  subtotal: 10,
  tax: 1,
  tip: null,
  suggestedTips: [],
  serviceCharge: null,
  discount: null,
  total: 11,
  paidByHint: null,
};
const people = [
  { id: "a", name: "Lukas" },
  { id: "p", name: "Sophie" },
];
const cfg = { apiKey: "k", baseURL: "http://x", model: "m" };
const info = { id: "m", inputPerM: 0.3, outputPerM: 0.9, features: [], modality: null, contextLength: null, source: "", fetchedAt: "" };
const lines = [
  { line: 1, members: ["m1"] },
  { line: 2, members: ["m1", "m2"] },
];

describe("runSplitAgent", () => {
  it("returns the model's own allocation by person id, validated by the app, with names in the trace", async () => {
    script = [
      { name: "check_receipt", args: { bill: 1 } },
      { name: "allocate_tax_tip", args: { bill: 1, lines } },
    ];
    const r = await runSplitAgent(cfg, { receipts: [receipt], people, note: "Lukas had the coffee, cake shared" }, info);
    expect(r.mode).toBe("note");
    expect(r.shares).toEqual({ a: 7.7, p: 3.3 });
    expect(r.lines).toEqual([
      { bill: 1, line: 1, members: ["a"] },
      { bill: 1, line: 2, members: ["a", "p"] },
    ]);
    expect(r.validation.ok).toBe(true);
    expect(r.trace.map((c) => `${c.by}:${c.tool}`)).toEqual(["model:check_receipt", "model:allocate_tax_tip", "app:validate_total"]);
    expect((r.trace[1].result as { shares: Record<string, number> }).shares).toEqual({ Lukas: 7.7, Sophie: 3.3 });
    expect(r.explanation).toBe("Lukas had the coffee; Sophie shared the rest");
    expect(r.usage).toMatchObject({ input: 1200, output: 300, reasoning: 250, calls: 1 });
    expect(r.usage.costUsd).toBeCloseTo((1200 * 0.3 + 300 * 0.9) / 1e6, 12);
  });

  it("fails when the model never allocates, instead of computing the split for it", async () => {
    script = [{ name: "check_receipt", args: { bill: 1 } }];
    const r = await runSplitAgent(cfg, { receipts: [receipt], people, note: "shared" }, info);
    expect(r.shares).toBeNull();
    expect(r.validation.ok).toBe(false);
  });

  it("in lines mode, fails if the model changes the assignment it was given", async () => {
    script = [{ name: "allocate_tax_tip", args: { bill: 1, lines: [{ line: 1, members: ["m1", "m2"] }, { line: 2, members: ["m1", "m2"] }] } }];
    const r = await runSplitAgent(cfg, { receipts: [receipt], people, lines: [{ bill: 1, line: 1, members: ["a"] }, { bill: 1, line: 2, members: ["a", "p"] }] }, info);
    expect(r.mode).toBe("lines");
    expect(r.validation).toMatchObject({ ok: false, reason: expect.stringMatching(/changed who had which line/) });

    script = [{ name: "allocate_tax_tip", args: { bill: 1, lines } }];
    const ok = await runSplitAgent(cfg, { receipts: [receipt], people, lines: [{ bill: 1, line: 2, members: ["p", "a"] }, { bill: 1, line: 1, members: ["a"] }] }, info);
    expect(ok.validation.ok).toBe(true);
  });

  it("keeps each bill's charges with its own lines and adds the bills up", async () => {
    const taxi: ExtractedReceipt = { ...receipt, merchant: "Taxi", items: [{ name: "Fare", quantity: 1, totalPrice: 20 }], subtotal: 20, tax: 0, total: 20 };
    script = [
      { name: "allocate_tax_tip", args: { bill: 1, lines } },
      { name: "allocate_tax_tip", args: { bill: 2, lines: [{ line: 1, members: ["m1"] }] } },
    ];
    const r = await runSplitAgent(cfg, { receipts: [receipt, taxi], people, note: "Lukas took the taxi alone" }, info);
    // The cafe's 1.00 tax stays on the cafe lines (Lukas 0.70, Sophie 0.30); the taxi adds 20.00 to Lukas only.
    expect(r.shares).toEqual({ a: 27.7, p: 3.3 });
    expect(r.total).toBe(31);
    expect(r.validation.ok).toBe(true);

    script = [{ name: "allocate_tax_tip", args: { bill: 1, lines } }];
    const missing = await runSplitAgent(cfg, { receipts: [receipt, taxi], people, note: "x" }, info);
    expect(missing.validation).toMatchObject({ ok: false, reason: expect.stringMatching(/bill 2/) });
  });
});
