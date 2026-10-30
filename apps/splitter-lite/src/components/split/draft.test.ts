import { describe, expect, it } from "vitest";
import { computeSplit } from "@/lib/money";
import { amountProblem, applyReceipt, billGroups, computeDraftSplit, emptyDraft, expenseLines, toSplitInput, withBills, type Draft } from "./draft";
import { mergeReceipts } from "./merge-receipts";

const people = [
  { id: "a", name: "Ana" },
  { id: "b", name: "Ben" },
  { id: "c", name: "Cy" },
];
const base = (over: Partial<Draft>): Draft => ({
  ...emptyDraft("EUR", { people, paidBy: "a" }),
  kind: "amount",
  merchant: "Hotel",
  amount: 60000,
  ...over,
});
const totals = (d: Draft) => computeSplit(toSplitInput(d)).shares.map((s) => s.total);

describe("single-amount drafts", () => {
  it("splits equally among included people", () => {
    expect(totals(base({ splitMode: "equal", shares: { a: 1, b: 1, c: 0 } }))).toEqual([30000, 30000, 0]);
  });

  it("splits by shares", () => {
    expect(totals(base({ splitMode: "shares", shares: { a: 2, b: 1, c: 1 } }))).toEqual([30000, 15000, 15000]);
  });

  it("splits by exact amounts and requires them to add up", () => {
    const d = base({ splitMode: "exact", amount: 10000, exact: { a: 5000, b: 3000, c: 1000 } });
    expect(amountProblem(d)).toMatch(/unassigned/);
    const ok = { ...d, exact: { a: 5000, b: 3000, c: 2000 } };
    expect(amountProblem(ok)).toBeNull();
    expect(expenseLines(ok)).toHaveLength(3);
    expect(totals(ok)).toEqual([5000, 3000, 2000]);
    expect(amountProblem({ ...d, exact: { a: 9000, b: 3000 } })).toMatch(/more than/);
  });

  it("flags missing basics", () => {
    expect(amountProblem(base({ merchant: "" }))).toMatch(/description/);
    expect(amountProblem(base({ amount: 0 }))).toMatch(/amount/);
    expect(amountProblem(base({ shares: { a: 0, b: 0, c: 0 } }))).toMatch(/Include/);
  });

  it("ignores tax/tip fields for single amounts", () => {
    const d = base({ splitMode: "equal", shares: { a: 1, b: 1, c: 1 }, tax: 999, tip: 999 });
    expect(computeSplit(toSplitInput(d)).total).toBe(60000);
  });
});

describe("combined bills", () => {
  const receipt = (merchant: string, items: [string, number][], charges: { tax?: number; tip?: number; serviceCharge?: number }) => ({
    kind: "receipt" as const,
    merchant,
    category: null,
    date: null,
    currency: "USD",
    items: items.map(([name, totalPrice]) => ({ name, quantity: 1, totalPrice })),
    subtotal: null,
    tax: charges.tax ?? null,
    tip: charges.tip ?? null,
    suggestedTips: [],
    serviceCharge: charges.serviceCharge ?? null,
    discount: null,
    total: null,
    paidByHint: null,
  });
  const dinner = receipt("Dinner", [["Pizza", 30]], { tip: 6 });
  const taxi = receipt("Taxi", [["Fare", 20]], { tax: 2 });

  it("spreads each bill's charges over its own lines only", () => {
    const merged = mergeReceipts([{ receipt: dinner, issues: [] }, { receipt: taxi, issues: [] }]);
    if ("error" in merged) throw new Error(merged.error);
    let d = withBills(applyReceipt(emptyDraft("USD"), merged.receipt, [], { lockCurrency: false }), [dinner, taxi]);
    d = { ...d, people: [{ id: "a", name: "A" }, { id: "r", name: "R" }] };
    const [pizza, fare] = d.items;
    d = { ...d, assignments: { [pizza.id]: ["a", "r"], [fare.id]: ["a"] } };
    expect(billGroups(d).map((b) => b.label)).toEqual(["Dinner", "Taxi"]);
    const shares = Object.fromEntries(computeDraftSplit(d).shares.map((s) => [s.memberId, s.total]));
    // R had half the pizza: half of 30 + half the dinner tip (3), and none of the taxi or its tax.
    expect(shares).toEqual({ a: 1500 + 300 + 2000 + 200, r: 1500 + 300 });

    // Editing the combined charges by hand no longer lines up with the bills: fall back to one pooled bill.
    expect(billGroups({ ...d, tip: d.tip + 100 })).toHaveLength(1);
  });
});
