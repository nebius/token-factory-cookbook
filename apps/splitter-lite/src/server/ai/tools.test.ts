import { describe, expect, it } from "vitest";
import type { ExtractedReceipt } from "./receipt";
import { createTools, toolDefinitions } from "./tools";

const receipt = (o: Partial<ExtractedReceipt>): ExtractedReceipt => ({
  kind: "receipt",
  merchant: "Trattoria da Luca",
  category: "food",
  date: "2026-10-10",
  currency: "INR",
  items: [],
  subtotal: null,
  tax: null,
  tip: null,
  suggestedTips: [],
  serviceCharge: null,
  discount: null,
  total: null,
  paidByHint: null,
  ...o,
});

const items = [
  { name: "Prawn curry", quantity: 2, totalPrice: 1400 },
  { name: "Kingfisher", quantity: 4, totalPrice: 1200 },
  { name: "Grilled sea bass", quantity: 1, totalPrice: 640 },
];
const tools = createTools({
  currency: "INR",
  memberRefs: ["m1", "m2", "m3"],
  bills: [
    { no: 1, receipt: receipt({ items, subtotal: 3240, tax: 162, total: 3402 }) },
    { no: 2, receipt: receipt({ items, subtotal: 3240, tax: 162, total: 3500 }) }, // planted wrong total
  ],
});

describe("planner tools", () => {
  it("exposes an OpenAI tool schema for each tool", () => {
    expect(toolDefinitions.map((t) => t.type === "function" && t.function.name)).toEqual(["check_receipt", "allocate_tax_tip", "calculate_split", "validate_total"]);
  });

  it("check_receipt passes a consistent bill and flags a wrong total", () => {
    expect(tools.run("check_receipt", '{"bill":1}')).toMatchObject({ ok: true, result: { ok: true, issues: [] } });
    const bad = tools.run("check_receipt", { bill: 2 });
    expect(bad.ok).toBe(false);
    expect((bad.result as { issues: string[] }).issues.join()).toMatch(/3402\.00.*3500\.00/);
  });

  it("allocate_tax_tip splits by line and spreads tax proportionally, summing exactly", () => {
    const call = tools.run("allocate_tax_tip", {
      bill: 1,
      lines: [
        { line: 1, members: ["m1", "m2"] },
        { line: 2, members: ["m1", "m2", "m3"] },
        { line: 3, members: ["m3"] },
      ],
    });
    const { shares, total } = call.result as { shares: Record<string, number>; total: number };
    expect(total).toBe(3402);
    expect(shares).toEqual({ m1: 1155, m2: 1155, m3: 1092 });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(3402);
  });

  it("gives a left-over cent by group order, whatever order the model lists people in", () => {
    const t = createTools({ currency: "USD", memberRefs: ["m1", "m2"], bills: [{ no: 1, receipt: receipt({ currency: "USD", items: [{ name: "Juice", quantity: 1, totalPrice: 10.01 }] }) }] });
    const a = t.run("allocate_tax_tip", { bill: 1, lines: [{ line: 1, members: ["m2", "m1"] }] }).result as { shares: Record<string, number> };
    const b = t.run("allocate_tax_tip", { bill: 1, lines: [{ line: 1, members: ["m1", "m2"] }] }).result as { shares: Record<string, number> };
    expect(a.shares).toEqual(b.shares);
    expect(a.shares).toEqual({ m1: 5.01, m2: 5 });
  });

  it("calculate_split rounds equal and share splits to the paisa, and reports exact gaps", () => {
    const eq = tools.run("calculate_split", { amount: 100, mode: "equal", participants: [{ member: "m1" }, { member: "m2" }, { member: "m3" }] });
    expect((eq.result as { shares: Record<string, number> }).shares).toEqual({ m1: 33.34, m2: 33.33, m3: 33.33 });
    const sh = tools.run("calculate_split", { amount: 400, mode: "shares", participants: [{ member: "m1", shares: 2 }, { member: "m2", shares: 1 }, { member: "m3", shares: 1 }] });
    expect((sh.result as { shares: Record<string, number> }).shares).toEqual({ m1: 200, m2: 100, m3: 100 });
    const ex = tools.run("calculate_split", { amount: 50, mode: "exact", participants: [{ member: "m1", amount: 25 }, { member: "m2", amount: 18 }] });
    expect(ex.ok).toBe(false);
    expect(ex.result).toMatchObject({ unassigned: 7 });
  });

  it("validate_total catches a one-paisa mismatch", () => {
    expect(tools.run("validate_total", { total: 100, shares: [{ member: "m1", amount: 50 }, { member: "m2", amount: 50 }] }).ok).toBe(true);
    const off = tools.run("validate_total", { total: 100, shares: [{ member: "m1", amount: 50 }, { member: "m2", amount: 49.99 }] });
    expect(off.ok).toBe(false);
    expect(off.result).toMatchObject({ diff: -0.01 });
  });

  it("turns bad input into an error result the model can correct", () => {
    expect(tools.run("calculate_split", { amount: 10, mode: "equal", participants: [{ member: "ghost" }] }).result).toEqual({ error: "Unknown member refs: ghost" });
    expect(tools.run("check_receipt", { bill: 9 }).result).toEqual({ error: "There is no bill #9" });
    expect(tools.run("allocate_tax_tip", { bill: 1, lines: [{ line: 1, members: ["m1"] }] }).result).toEqual({ error: "Lines 2, 3 have nobody assigned" });
    expect(tools.run("nope", {}).ok).toBe(false);
    expect(tools.run("validate_total", "{not json").result).toMatchObject({ error: expect.any(String) });
  });
});
