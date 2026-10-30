"use client";

import { Check, Minus, Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money";
import { Avatar, CategoryChip, Eyebrow, Field, Input, Select } from "@/components/ui/primitives";
import { CATEGORY_KEYS } from "@/config/categories";
import { COMMON_CURRENCIES, computeSplit, formatMoney, SplitError } from "@/lib/money";
import { cn } from "@/lib/utils";
import { amountProblem, changeCurrency, exactTotal, toSplitInput, type Draft, type SplitMode } from "./draft";
import { PayerPicker, PeopleEditor, StepBar } from "./people";

const MODES: { id: SplitMode; label: string; hint: string }[] = [
  { id: "equal", label: "Equally", hint: "Everyone included pays the same." },
  { id: "shares", label: "By shares", hint: "Give a couple 2 shares and everyone else 1, for example." },
  { id: "exact", label: "Exact amounts", hint: "Type what each person owes. It must add up to the total." },
];

export function AmountStep({
  draft,
  update,
  editablePeople,
  meId,
  lockCurrency,
  onNext,
}: {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
  editablePeople: boolean;
  meId?: string;
  lockCurrency: boolean;
  onNext: () => void;
}) {
  const c = draft.currency;
  const problem = amountProblem(draft);
  const currencies = COMMON_CURRENCIES.includes(c as (typeof COMMON_CURRENCIES)[number]) ? COMMON_CURRENCIES : [c, ...COMMON_CURRENCIES];

  return (
    <div className="mx-auto grid max-w-2xl gap-8">
      <h1 className="text-4xl leading-none sm:text-5xl">How much, and for what?</h1>

      <section className="grid gap-4">
        <Field label="Description">
          <Input
            value={draft.merchant}
            placeholder="e.g. Airbnb in Lisbon, festival tickets, fuel"
            onChange={(e) => update({ merchant: e.target.value })}
            maxLength={120}
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Total">
            <MoneyInput
              currency={c}
              value={draft.amount}
              onChange={(amount) => update({ amount })}
              className="h-16 text-left font-display text-3xl md:h-16 md:text-3xl"
              aria-label="Total amount"
            />
          </Field>
          <Field label="Currency">
            <Select value={c} disabled={lockCurrency} onChange={(e) => update((d) => changeCurrency(d, e.target.value))} className="h-16 w-28 md:h-16">
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Date" className="sm:max-w-[220px]">
          <Input type="date" value={draft.date} onChange={(e) => update({ date: e.target.value })} />
        </Field>
      </section>

      <section className="grid gap-3">
        <Eyebrow>Category</Eyebrow>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {CATEGORY_KEYS.map((key) => (
            <CategoryChip key={key} category={key} active={draft.category === key} onClick={() => update({ category: key })} />
          ))}
        </div>
      </section>

      <section className="grid gap-4">
        <Eyebrow>People</Eyebrow>
        <PeopleEditor draft={draft} update={update} editable={editablePeople} />
      </section>

      <PayerPicker draft={draft} update={update} meId={meId} />

      <SplitFields draft={draft} update={update} />

      <StepBar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{problem ?? "Ready"}</p>
          <p className="tabular font-display text-2xl">{formatMoney(draft.amount, c)}</p>
        </div>
        <Button size="lg" disabled={problem !== null} onClick={onNext}>
          See the split
        </Button>
      </StepBar>
    </div>
  );
}

/** Split method (equal / shares / exact) and the per-person controls for a single-amount expense. */
export function SplitFields({
  draft,
  update,
}: {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
}) {
  const c = draft.currency;
  const remaining = draft.amount - exactTotal(draft);
  const preview = React.useMemo(() => {
    try {
      return new Map(computeSplit(toSplitInput(draft)).shares.map((s) => [s.memberId, s.total]));
    } catch (e) {
      if (e instanceof SplitError) return new Map<string, number>();
      throw e;
    }
  }, [draft]);
  const setShare = (id: string, value: number) =>
    update((d) => ({ ...d, shares: { ...d.shares, [id]: Math.max(0, Math.min(20, value)) } }));

  return (
    <>
    {draft.people.length > 0 && (
      <section className="grid gap-4">
        <Eyebrow>Split</Eyebrow>
        <div role="radiogroup" aria-label="Split method" className="grid grid-cols-3 gap-1 rounded-full bg-stone p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={draft.splitMode === m.id}
              onClick={() =>
                update((d) => ({
                  ...d,
                  splitMode: m.id,
                  // Start shares with everyone included once.
                  shares: m.id === "exact" ? d.shares : Object.fromEntries(d.people.map((p) => [p.id, d.shares[p.id] ?? 1])),
                }))
              }
              className={cn(
                "h-11 rounded-full px-2 text-sm transition",
                draft.splitMode === m.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{MODES.find((m) => m.id === draft.splitMode)!.hint}</p>

        <ul className="divide-y divide-border rounded-md border border-border">
          {draft.people.map((p) => {
            const included = (draft.shares[p.id] ?? 0) > 0;
            return (
              <li key={p.id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>

                {draft.splitMode === "equal" && (
                  <>
                    <span className={cn("tabular text-sm", !included && "text-subtle")}>{formatMoney(preview.get(p.id) ?? 0, c)}</span>
                    <button
                      role="checkbox"
                      aria-checked={included}
                      aria-label={`Include ${p.name}`}
                      onClick={() => setShare(p.id, included ? 0 : 1)}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-full border transition",
                        included ? "border-foreground bg-foreground text-background" : "border-hairline",
                      )}
                    >
                      {included && <Check className="size-4" />}
                    </button>
                  </>
                )}

                {draft.splitMode === "shares" && (
                  <>
                    <span className={cn("tabular hidden text-sm sm:inline", !included && "text-subtle")}>
                      {formatMoney(preview.get(p.id) ?? 0, c)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" aria-label={`Fewer shares for ${p.name}`} onClick={() => setShare(p.id, (draft.shares[p.id] ?? 0) - 1)}>
                        <Minus />
                      </Button>
                      <span className="tabular w-8 text-center text-lg" aria-label={`${p.name} shares`}>
                        {draft.shares[p.id] ?? 0}
                      </span>
                      <Button variant="outline" size="icon" aria-label={`More shares for ${p.name}`} onClick={() => setShare(p.id, (draft.shares[p.id] ?? 0) + 1)}>
                        <Plus />
                      </Button>
                    </div>
                  </>
                )}

                {draft.splitMode === "exact" && (
                  <MoneyInput
                    currency={c}
                    value={draft.exact[p.id] ?? 0}
                    onChange={(v) => update((d) => ({ ...d, exact: { ...d.exact, [p.id]: v } }))}
                    className="w-32"
                    aria-label={`${p.name}'s amount`}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {draft.splitMode === "shares" && (
          <p className="text-sm text-muted-foreground sm:hidden">
            {draft.people
              .filter((p) => (draft.shares[p.id] ?? 0) > 0)
              .map((p) => `${p.name} ${formatMoney(preview.get(p.id) ?? 0, c)}`)
              .join(" · ")}
          </p>
        )}
        {draft.splitMode === "exact" && draft.amount > 0 && (
          <p className={cn("text-sm", remaining === 0 ? "text-positive" : "text-warning")} aria-live="polite">
            {remaining === 0
              ? "Adds up exactly."
              : remaining > 0
                ? `${formatMoney(remaining, c)} left to assign`
                : `${formatMoney(-remaining, c)} over the total`}
          </p>
        )}
      </section>
    )}
    </>
  );
}
