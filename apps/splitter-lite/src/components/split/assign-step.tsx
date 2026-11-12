"use client";

import { AlertTriangle, Check, Sparkles, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Textarea } from "@/components/ui/primitives";
import { formatMoney, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { applyAiLines, assignmentKey, formatUsd, requestSplit } from "./ai";
import { usableItems, type Draft } from "./draft";
import { PayerPicker, PeopleEditor, StepBar } from "./people";

export function AssignStep({
  draft,
  update,
  onNext,
}: {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
  onNext: () => void;
}) {
  const c = draft.currency;
  const items = usableItems(draft);
  const people = draft.people;
  const unassigned = items.filter((i) => !draft.assignments[i.id]?.length);

  // Per-person totals appear only once the model has split this exact assignment (the AI does the maths).
  const totals = React.useMemo(() => {
    if (!draft.aiSplit?.shares || !draft.aiSplit.validation.ok || draft.aiSplit.key !== assignmentKey(draft)) return undefined;
    return new Map(Object.entries(draft.aiSplit.shares).map(([id, v]) => [id, toMinor(v, draft.currency)]));
  }, [draft]);

  const splitAllEqually = () =>
    update((d) => ({ ...d, assignments: Object.fromEntries(usableItems(d).map((i) => [i.id, d.people.map((p) => p.id)])) }));

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <div>
        <h1 className="text-4xl leading-none sm:text-5xl">Who paid, who had what</h1>
        <p className="mt-3 text-muted-foreground">
          Every line starts shared by everyone. Only change the exceptions: tap a name to take them off a line.
        </p>
      </div>

      <section className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Who&apos;s sharing</Eyebrow>
          {people.length > 1 && items.length > 0 && unassigned.length > 0 && (
            <Button variant="link" size="sm" onClick={splitAllEqually}>
              <Users /> Share the rest with everyone
            </Button>
          )}
        </div>
        <PeopleEditor draft={draft} update={update} editable totals={totals} />
      </section>

      <PayerPicker draft={draft} update={update} />

      {people.length > 0 && items.length > 0 && <AiAssign draft={draft} update={update} />}

      <ItemAssigner draft={draft} update={update} />

      <StepBar>
        <div className="min-w-0 flex-1 text-sm">
          {people.length === 0 ? (
            <span className="text-muted-foreground">Add at least one person</span>
          ) : unassigned.length > 0 ? (
            <span className="text-warning">
              {unassigned.length} line{unassigned.length === 1 ? "" : "s"} left to assign
            </span>
          ) : (
            <span className="text-positive">Everything is assigned</span>
          )}
        </div>
        <Button size="lg" disabled={people.length === 0 || unassigned.length > 0 || !draft.paidBy} onClick={onNext}>
          See the split
        </Button>
      </StepBar>
    </div>
  );
}

/** Per-line "who had this" chips for an itemized expense. */
export function ItemAssigner({
  draft,
  update,
}: {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
}) {
  const c = draft.currency;
  const items = usableItems(draft);
  const people = draft.people;
  const toggle = (itemId: string, personId: string) =>
    update((d) => {
      const current = d.assignments[itemId] ?? [];
      const next = current.includes(personId) ? current.filter((x) => x !== personId) : [...current, personId];
      return { ...d, assignments: { ...d.assignments, [itemId]: next } };
    });
  const everyone = (itemId: string) =>
    update((d) => ({
      ...d,
      assignments: {
        ...d.assignments,
        [itemId]: (d.assignments[itemId]?.length ?? 0) === d.people.length ? [] : d.people.map((p) => p.id),
      },
    }));

  return (
    <>
    {people.length > 0 && (
      <ul className="grid gap-3">
        {items.map((item) => {
          const assigned = draft.assignments[item.id] ?? [];
          const all = assigned.length === people.length;
          return (
            <li key={item.id} className={cn("rounded-md border p-4", assigned.length === 0 ? "border-warning/50" : "border-border")}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate">
                    {item.quantity > 1 && <span className="text-muted-foreground">{item.quantity}× </span>}
                    {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {assigned.length === 0
                      ? "Not assigned yet"
                      : assigned.length === 1
                        ? "1 person"
                        : `${assigned.length} people · ${formatMoney(Math.round(item.amount / assigned.length), c)} each`}
                  </p>
                </div>
                <span className="tabular">{formatMoney(item.amount, c)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const on = assigned.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(item.id, p.id)}
                      aria-pressed={on}
                      className={cn(
                        "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm transition active:scale-95",
                        on ? "border-foreground bg-foreground text-background" : "border-hairline text-muted-foreground hover:border-foreground/40",
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                      {p.name}
                    </button>
                  );
                })}
                {people.length > 1 && (
                  <button
                    onClick={() => everyone(item.id)}
                    className={cn(
                      "h-11 rounded-full border border-dashed px-4 text-sm transition",
                      all ? "border-foreground text-foreground" : "border-hairline text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    Everyone
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
    </>
  );
}

/** "Tell the AI who had what": the model reads the note, assigns each line and splits it with tool calls. */
function AiAssign({ draft, update }: { draft: Draft; update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void }) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  const last = draft.aiSplit?.mode === "note" ? draft.aiSplit : undefined;
  const example = draft.people.length > 1 ? `${draft.people[0].name} had the ${usableItems(draft)[0]?.name || "first item"}, everything else shared` : "";

  async function ask() {
    if (!note.trim()) return;
    setBusy(true);
    abort.current = new AbortController();
    try {
      const result = await requestSplit(draft, { note }, abort.current.signal);
      update((d) => {
        const next = result.lines ? applyAiLines(d, result.lines) : d;
        return {
          ...next,
          aiSplit: { ...result, key: assignmentKey(next) },
          aiCalls: [...(d.aiCalls ?? []), { ...result.usage, label: "Assign lines from your note + split with tools" }],
        };
      });
      if (result.validation.ok) toast.success("The AI assigned every line", { description: "Check the lines below, then see the split." });
      else toast.warning("The AI's split didn't pass the check", { description: result.validation.reason });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(e instanceof Error ? e.message : "The AI split failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent-ink" />
        <h2 className="text-lg">Tell the AI who had what</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Say it in your own words. The AI assigns each line, then works out every share with calculator tool calls. You can still tap to change anything.
      </p>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={2000}
        aria-label="Who had what"
        placeholder={example ? `e.g. ${example}` : "e.g. Sophie had the coffee, everything else shared"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={ask} loading={busy} disabled={!note.trim()}>
          <Sparkles /> Assign with AI
        </Button>
        {busy && (
          <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        )}
        {busy && <span className="text-sm text-muted-foreground">Reasoning and calling tools… usually 10–30 seconds.</span>}
        {!busy && last && (
          <span className={cn("inline-flex items-center gap-1.5 text-sm", last.validation.ok ? "text-positive" : "text-warning")}>
            {last.validation.ok ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
            {last.validation.ok ? "Assigned and checked" : "Check failed"} · {last.trace.filter((c) => c.by === "model").length} tool calls ·{" "}
            {formatUsd(last.usage.costUsd)}
          </span>
        )}
      </div>
      {!busy && last?.explanation && <p className="text-sm text-muted-foreground">“{last.explanation}”</p>}
    </section>
  );
}
