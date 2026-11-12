"use client";

import { Check, Plus, X } from "lucide-react";
import { nanoid } from "nanoid";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Avatar, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { Draft } from "./draft";

/** People sharing the cost, with optional add/remove (quick split). The payer is picked with <PayerPicker>. */
export function PeopleEditor({
  draft,
  update,
  editable,
  totals,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  editable: boolean;
  totals?: Map<string, number>;
}) {
  const [name, setName] = React.useState("");
  const people = draft.people;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = nanoid(8);
    update((d) => ({
      ...d,
      people: [...d.people, { id, name: trimmed }],
      shares: { ...d.shares, [id]: 1 },
      paidBy: d.paidBy ?? id,
      // Lines start shared by everyone: a new person joins every line that nobody has been taken off yet.
      assignments: Object.fromEntries(
        d.items.map((i) => {
          const cur = d.assignments[i.id] ?? [];
          const everyone = cur.length === 0 || d.people.every((p) => cur.includes(p.id));
          return [i.id, everyone ? [...cur, id] : cur];
        }),
      ),
    }));
    setName("");
  };

  const remove = (id: string) =>
    update((d) => {
      const { [id]: _s, ...shares } = d.shares;
      const { [id]: _e, ...exact } = d.exact;
      return {
        ...d,
        people: d.people.filter((p) => p.id !== id),
        shares,
        exact,
        paidBy: d.paidBy === id ? (d.people.find((p) => p.id !== id)?.id ?? null) : d.paidBy,
        assignments: Object.fromEntries(Object.entries(d.assignments).map(([k, v]) => [k, v.filter((x) => x !== id)])),
      };
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {people.map((p) => (
          <span key={p.id} className="inline-flex h-11 items-center gap-2 rounded-full border border-hairline bg-card pl-1.5 pr-2 text-sm">
            <Avatar name={p.name} size="sm" />
            {p.name}
            {totals && <span className="tabular text-muted-foreground">{formatMoney(totals.get(p.id) ?? 0, draft.currency)}</span>}
            {editable && (
              <button onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} className="-mr-1 flex size-8 items-center max-md:size-11 justify-center rounded-full hover:bg-muted">
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {people.length === 0 && <p className="text-sm text-muted-foreground">Add everyone who&apos;s sharing this cost.</p>}
      </div>
      {editable && (
        <form onSubmit={add} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name, e.g. Sam" maxLength={60} aria-label="Person's name" />
          <Button type="submit" variant="outline" disabled={!name.trim()} className="h-12 md:h-11">
            <Plus /> Add
          </Button>
        </form>
      )}
    </div>
  );
}

/** "Who paid?" as a row of people to tap, shown first so it can't be missed. */
export function PayerPicker({
  draft,
  update,
  meId,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  meId?: string;
}) {
  if (draft.people.length === 0) return null;
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-xl sm:text-2xl">Who paid?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {meId ? "Add the bills you paid. If someone else paid this one, pick them." : "The person who paid the bill gets paid back."}
        </p>
      </div>
      <div role="radiogroup" aria-label="Who paid" className="flex flex-wrap gap-2">
        {draft.people.map((p) => {
          const on = draft.paidBy === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => update((d) => ({ ...d, paidBy: p.id }))}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full border pl-1.5 pr-4 text-sm transition-colors",
                on ? "border-foreground bg-foreground text-background" : "border-hairline bg-card hover:border-foreground/40",
              )}
            >
              <Avatar name={p.name} size="sm" />
              {p.id === meId ? "You" : p.name}
              {on && <Check className="size-4" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Sticky footer for each step. Sits above the iPhone home indicator. */
export function StepBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 mt-2 flex items-center gap-4 rounded-md border border-hairline bg-card/95 p-3 pl-4 backdrop-blur sm:p-4 sm:pl-5">
      {children}
    </div>
  );
}
