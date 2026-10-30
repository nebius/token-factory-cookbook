// Client helpers for the two AI calls a split makes: reading the bills (/api/extract) and the model's
// tool-call split (/api/split). The bills sent to /api/split are rebuilt from the draft, so edits made on
// the review step are what the model splits. Combined bills are sent separately, each with its own charges.
import { fromMinor } from "@/lib/money";
import type { SplitResult } from "@/server/ai/split-agent";
import { billGroups, type Draft } from "./draft";

export function receiptsFromDraft(d: Draft) {
  const major = (n: number) => fromMinor(n, d.currency);
  return billGroups(d).map((b) => ({
    merchant: b.label || null,
    currency: d.currency,
    items: b.items.map((i) => ({ name: i.name || "Item", quantity: i.quantity, totalPrice: major(i.amount) })),
    subtotal: null,
    tax: major(b.tax),
    tip: major(b.tip),
    serviceCharge: major(b.serviceCharge),
    discount: major(b.discount),
    total: b.printedTotal == null ? null : major(b.printedTotal),
  }));
}

/** Who had each line (bill and 1-based line, in the order sent to the model), by person id. */
export const linesFromDraft = (d: Draft) =>
  billGroups(d).flatMap((b, bi) =>
    b.items.map((item, i) => ({ bill: bi + 1, line: i + 1, members: (d.assignments[item.id] ?? []).filter((id) => d.people.some((p) => p.id === id)) })),
  );

/** Changes when the bills, the people or who had what changes, so a stored AI split is only reused when it still fits. */
export const assignmentKey = (d: Draft) => JSON.stringify([receiptsFromDraft(d), d.people.map((p) => [p.id, p.name]), linesFromDraft(d)]);

/** Puts the model's line assignment into the tap grid, so people can review it. */
export function applyAiLines(d: Draft, lines: { bill: number; line: number; members: string[] }[]): Draft {
  const groups = billGroups(d);
  const assignments = { ...d.assignments };
  for (const l of lines) {
    const item = groups[l.bill - 1]?.items[l.line - 1];
    if (item) assignments[item.id] = l.members.filter((id) => d.people.some((p) => p.id === id));
  }
  return { ...d, assignments };
}

export async function requestSplit(d: Draft, body: { note: string } | { lines: true }, signal?: AbortSignal): Promise<SplitResult> {
  const res = await fetch("/api/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      receipts: receiptsFromDraft(d),
      people: d.people.map((p) => ({ id: p.id, name: p.name })),
      ...("note" in body ? { note: body.note } : { lines: linesFromDraft(d) }),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as SplitResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `The AI split failed (error ${res.status})`);
  return json;
}

export const formatUsd = (n: number | null | undefined) =>
  n == null ? "price unknown" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
