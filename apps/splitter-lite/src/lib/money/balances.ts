import type { Minor } from "./format";

export type LedgerExpense = {
  paidByMemberId: string;
  shares: { memberId: string; amount: Minor }[];
};

export type LedgerSettlement = {
  fromMemberId: string;
  toMemberId: string;
  amount: Minor;
};

export type Transfer = { fromMemberId: string; toMemberId: string; amount: Minor };

/**
 * Net balance per member. Positive = the group owes them; negative = they owe the group.
 * Balances across all members always sum to zero.
 */
export function computeBalances(
  memberIds: string[],
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[],
): Map<string, Minor> {
  const net = new Map<string, Minor>(memberIds.map((id) => [id, 0]));
  const add = (id: string, amount: Minor) => net.set(id, (net.get(id) ?? 0) + amount);

  for (const expense of expenses) {
    for (const share of expense.shares) {
      add(expense.paidByMemberId, share.amount);
      add(share.memberId, -share.amount);
    }
  }
  for (const s of settlements) {
    add(s.fromMemberId, s.amount);
    add(s.toMemberId, -s.amount);
  }
  return net;
}

/** Greedy min-cash-flow: the biggest debtor pays the biggest creditor until everyone is square. */
export function simplifyDebts(net: Map<string, Minor>): Transfer[] {
  const debtors = [...net].filter(([, v]) => v < 0).map(([id, v]) => ({ id, amount: -v }));
  const creditors = [...net].filter(([, v]) => v > 0).map(([id, v]) => ({ id, amount: v }));
  const byAmount = (a: { id: string; amount: number }, b: { id: string; amount: number }) =>
    b.amount - a.amount || a.id.localeCompare(b.id);

  const transfers: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.amount, creditor.amount);
    transfers.push({ fromMemberId: debtor.id, toMemberId: creditor.id, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) debtors.shift();
    if (creditor.amount === 0) creditors.shift();
  }
  return transfers;
}
