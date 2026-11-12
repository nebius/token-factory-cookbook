import type { ExtractedReceipt, ReceiptIssue } from "@/server/ai/receipt";

const sum = (values: (number | null)[]) => (values.every((v) => v == null) ? null : Math.round(values.reduce<number>((a, v) => a + (v ?? 0), 0) * 100) / 100);

/**
 * Combines separately read bills for the same occasion (dinner + taxi home) into one expense:
 * lines are labelled with their bill, and tax, tip, fees, discount and totals are added up.
 * Returns an error message instead when the bills can't be combined (different currencies).
 */
export function mergeReceipts(
  bills: { receipt: ExtractedReceipt; issues: ReceiptIssue[] }[],
): { receipt: ExtractedReceipt; issues: ReceiptIssue[] } | { error: string } {
  const currencies = [...new Set(bills.map((b) => b.receipt.currency?.toUpperCase()).filter(Boolean))];
  if (currencies.length > 1) return { error: `These bills are in different currencies (${currencies.join(", ")}). Split them one at a time.` };

  const label = (r: ExtractedReceipt, i: number) => r.merchant?.trim() || `Bill ${i + 1}`;
  const receipts = bills.map((b) => b.receipt);
  const receipt: ExtractedReceipt = {
    kind: "receipt",
    merchant: receipts.map(label).join(" + "),
    category: receipts.find((r) => r.category)?.category ?? null,
    date: receipts.find((r) => r.date)?.date ?? null,
    currency: currencies[0] ?? null,
    items: receipts.flatMap((r, i) => r.items.map((it) => ({ ...it, name: `${label(r, i)} · ${it.name}` }))),
    subtotal: receipts.every((r) => r.subtotal != null) ? sum(receipts.map((r) => r.subtotal)) : null,
    tax: sum(receipts.map((r) => r.tax)),
    tip: sum(receipts.map((r) => r.tip)),
    suggestedTips: [],
    serviceCharge: sum(receipts.map((r) => r.serviceCharge)),
    discount: sum(receipts.map((r) => r.discount)),
    total: receipts.every((r) => r.total != null) ? sum(receipts.map((r) => r.total)) : null,
    paidByHint: receipts.find((r) => r.paidByHint)?.paidByHint ?? null,
  };
  const issues = bills.flatMap((b, i) => b.issues.map((x) => ({ ...x, message: `${label(b.receipt, i)}: ${x.message}` })));
  return { receipt, issues };
}
