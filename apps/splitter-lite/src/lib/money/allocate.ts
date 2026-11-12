import type { Minor } from "./format";

export class SplitError extends Error {
  constructor(
    readonly code:
      | "NO_MEMBERS"
      | "UNASSIGNED_ITEMS"
      | "UNKNOWN_MEMBER"
      | "INVALID_AMOUNT"
      | "INVALID_WEIGHT",
    message: string,
    readonly itemIds: string[] = [],
  ) {
    super(message);
    this.name = "SplitError";
  }
}

/**
 * Splits an integer amount by weights using the largest-remainder method.
 * The parts always sum exactly to `total`; ties go to the earliest index so results are deterministic.
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  if (!Number.isSafeInteger(total)) throw new SplitError("INVALID_AMOUNT", "Amount must be an integer");
  if (weights.length === 0) throw new SplitError("INVALID_WEIGHT", "Nothing to split between");
  if (weights.some((w) => !Number.isFinite(w) || w < 0))
    throw new SplitError("INVALID_WEIGHT", "Weights must be non-negative");

  const sum = weights.reduce((a, b) => a + b, 0);
  // All-zero weights: split equally.
  const effective = sum === 0 ? weights.map(() => 1) : weights;
  const effectiveSum = sum === 0 ? weights.length : sum;

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = effective.map((w) => (abs * w) / effectiveSum);
  const parts = exact.map(Math.floor);
  let remainder = abs - parts.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value), weight: effective[index] }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % order.length, remainder--) {
    parts[order[i].index] += 1;
  }
  return parts.map((p) => p * sign);
}

export type SplitItemInput = {
  id: string;
  amount: Minor;
  /** memberId -> weight (1 = one share). */
  assignees: { memberId: string; weight: number }[];
};

export type SplitInput = {
  memberIds: string[];
  items: SplitItemInput[];
  tax?: Minor;
  tip?: Minor;
  serviceCharge?: Minor;
  /** Positive number that is subtracted from the total. */
  discount?: Minor;
};

export type MemberShare = {
  memberId: string;
  items: Minor;
  tax: Minor;
  tip: Minor;
  serviceCharge: Minor;
  discount: Minor;
  total: Minor;
};

export type SplitResult = {
  subtotal: Minor;
  total: Minor;
  shares: MemberShare[];
};

/**
 * Computes who owes what. Items are split by assignee weight; tax, tip, service charge and discount
 * are spread proportionally to each person's item subtotal. Shares always sum exactly to the total.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const { memberIds, items } = input;
  if (memberIds.length === 0) throw new SplitError("NO_MEMBERS", "Add at least one person");

  const charges = {
    tax: input.tax ?? 0,
    tip: input.tip ?? 0,
    serviceCharge: input.serviceCharge ?? 0,
    discount: input.discount ?? 0,
  };
  for (const value of [...Object.values(charges), ...items.map((i) => i.amount)]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new SplitError("INVALID_AMOUNT", "Amounts must be zero or positive");
  }

  const known = new Set(memberIds);
  const unassigned = items.filter((item) => item.assignees.filter((a) => a.weight > 0).length === 0);
  if (unassigned.length > 0) {
    throw new SplitError(
      "UNASSIGNED_ITEMS",
      `${unassigned.length} item${unassigned.length === 1 ? " is" : "s are"} not assigned to anyone`,
      unassigned.map((i) => i.id),
    );
  }

  const index = new Map(memberIds.map((id, i) => [id, i]));
  const itemTotals = memberIds.map(() => 0);

  for (const item of items) {
    const assignees = item.assignees.filter((a) => a.weight > 0);
    for (const a of assignees) {
      if (!known.has(a.memberId))
        throw new SplitError("UNKNOWN_MEMBER", "Item assigned to someone outside this split", [item.id]);
    }
    const parts = allocate(
      item.amount,
      assignees.map((a) => a.weight),
    );
    assignees.forEach((a, i) => {
      itemTotals[index.get(a.memberId)!] += parts[i];
    });
  }

  const subtotal = itemTotals.reduce((a, b) => a + b, 0);
  const spread = (amount: Minor) => (amount === 0 ? memberIds.map(() => 0) : allocate(amount, itemTotals));
  const tax = spread(charges.tax);
  const tip = spread(charges.tip);
  const serviceCharge = spread(charges.serviceCharge);
  const discount = spread(charges.discount);

  const shares = memberIds.map((memberId, i) => ({
    memberId,
    items: itemTotals[i],
    tax: tax[i],
    tip: tip[i],
    serviceCharge: serviceCharge[i],
    discount: discount[i],
    total: itemTotals[i] + tax[i] + tip[i] + serviceCharge[i] - discount[i],
  }));

  const total = subtotal + charges.tax + charges.tip + charges.serviceCharge - charges.discount;
  const check = shares.reduce((a, s) => a + s.total, 0);
  if (check !== total) throw new Error(`Split does not balance (${check} vs ${total})`);

  return { subtotal, total, shares };
}
