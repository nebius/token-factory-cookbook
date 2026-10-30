"use client";

import { AlertTriangle, ImageOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money";
import { CategoryChip, Eyebrow, Field, Input, Select } from "@/components/ui/primitives";
import { CATEGORY_KEYS } from "@/config/categories";
import { COMMON_CURRENCIES, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { changeCurrency, draftTotal, newItem, usableItems, type Draft, type DraftItem } from "./draft";
import { StepBar } from "./people";

export function ReviewStep({
  draft,
  update,
  image,
  lockCurrency,
  onNext,
  scanEnabled,
  onReplace,
  onRemoveImage,
}: {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
  /** Photos of the bill, one per page (empty when typed in). */
  image: string[];
  lockCurrency: boolean;
  onNext: () => void;
  scanEnabled: boolean;
  onReplace: () => void;
  onRemoveImage: () => void;
}) {
  const c = draft.currency;
  const items = usableItems(draft);
  const subtotal = items.reduce((a, i) => a + i.amount, 0);
  const total = draftTotal(draft);
  const mismatch = draft.printedTotal != null && Math.abs(draft.printedTotal - total) > 1;
  const canContinue = items.length > 0 && items.every((i) => i.name.trim()) && total >= 0;

  const setItem = (id: string, patch: Partial<DraftItem>) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const removeItem = (id: string) =>
    update((d) => {
      const rest = d.items.filter((i) => i.id !== id);
      return { ...d, items: rest.length ? rest : [newItem()] };
    });
  const addItem = () => update((d) => ({ ...d, items: [...d.items, newItem()] }));

  const currencies = COMMON_CURRENCIES.includes(c as (typeof COMMON_CURRENCIES)[number]) ? COMMON_CURRENCIES : [c, ...COMMON_CURRENCIES];

  return (
    <div className={cn("grid gap-8", image.length > 0 && "lg:grid-cols-[minmax(0,360px)_1fr]")}>
      {image.length > 0 && (
        <div className="lg:sticky lg:top-24 lg:self-start">
          <details className="group rounded-md border border-border lg:border-0" open>
            <summary className="flex h-12 cursor-pointer list-none items-center px-4 text-sm lg:hidden">
              <span className="group-open:hidden">Show {draft.bills?.length === image.length ? `the ${image.length} bills` : image.length > 1 ? `receipt (${image.length} pages)` : "receipt photo"}</span>
              <span className="hidden group-open:inline">Hide receipt</span>
            </summary>
            <div className="grid max-h-[60dvh] gap-3 overflow-y-auto lg:max-h-[75dvh]">
              {image.map((src, i) => (
                <figure key={src} className="grid gap-1">
                  {image.length > 1 && (
                    <figcaption className="eyebrow px-1 text-muted-foreground">
                      {draft.bills?.length === image.length ? `Bill ${i + 1} of ${image.length} · ${draft.bills[i].label}` : `Page ${i + 1} of ${image.length}`}
                    </figcaption>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Receipt page ${i + 1}`} className="w-full rounded-md object-contain lg:rounded-lg" />
                </figure>
              ))}
            </div>
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onReplace}>
              <RefreshCw /> Wrong bill? Replace it
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemoveImage}>
              <ImageOff /> Remove photo
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-8">
        <div>
          <h1 className="text-4xl leading-none sm:text-5xl">Check the details</h1>
          <p className="mt-3 text-muted-foreground">Fix anything that looks off. Totals update as you type.</p>
          {image.length === 0 && scanEnabled && (
            <Button variant="link" size="sm" className="mt-2" onClick={onReplace}>
              <RefreshCw /> Scan a bill instead
            </Button>
          )}
        </div>

        {draft.issues.length > 0 && (
          <div className="grid gap-1.5 rounded-sm bg-warning-soft p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="size-4" /> Worth a double-check
            </p>
            <ul className="ml-6 list-disc text-foreground/80">
              {draft.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-[1fr_170px_120px]">
          <Field label="Where / what">
            <Input value={draft.merchant} placeholder="e.g. Hotel Lux, Trattoria Lucia" onChange={(e) => update({ merchant: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={draft.date} onChange={(e) => update({ date: e.target.value })} />
          </Field>
          <Field label="Currency">
            <Select value={c} disabled={lockCurrency} onChange={(e) => update((d) => changeCurrency(d, e.target.value))}>
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
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

        <section>
          <div className="flex items-baseline justify-between border-b border-hairline pb-3">
            <h2 className="text-2xl">Items</h2>
            <span className="eyebrow text-muted-foreground">{items.length} lines</span>
          </div>
          <ul className="divide-y divide-border">
            {draft.items.map((item, index) => (
              <li key={item.id} className="grid grid-cols-[1fr_7.5rem_auto] items-center gap-2 py-2.5 sm:grid-cols-[1fr_72px_140px_auto]">
                <Input
                  aria-label={`Item ${index + 1} name`}
                  value={item.name}
                  placeholder="Item"
                  className="col-span-3 border-transparent bg-transparent px-2 hover:border-input sm:col-span-1"
                  onChange={(e) => setItem(item.id, { name: e.target.value })}
                />
                <div className="flex items-center gap-1 sm:contents">
                  <span className="pl-2 text-xs text-muted-foreground sm:hidden">Qty</span>
                  <Input
                    aria-label={`Item ${index + 1} quantity`}
                    type="number"
                    min={1}
                    step="any"
                    value={item.quantity}
                    className="w-16 text-center sm:w-full"
                    onChange={(e) => setItem(item.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>
                <MoneyInput
                  aria-label={`Item ${index + 1} price`}
                  currency={c}
                  value={item.amount}
                  onChange={(amount) => setItem(item.id, { amount })}
                  className="max-sm:col-start-2"
                />
                <Button variant="ghost" size="icon" aria-label={`Remove item ${index + 1}`} onClick={() => removeItem(item.id)}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="mt-3 w-full" onClick={addItem}>
            <Plus /> Add item
          </Button>
        </section>

        <section className="grid gap-4 rounded-md bg-stone p-5">
          <h2 className="text-2xl">Tax, tip & fees</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Tax">
              <MoneyInput currency={c} value={draft.tax} onChange={(tax) => update({ tax })} />
            </Field>
            <Field label="Tip">
              <MoneyInput currency={c} value={draft.tip} onChange={(tip) => update({ tip })} />
            </Field>
            <Field label="Fees">
              <MoneyInput currency={c} value={draft.serviceCharge} onChange={(serviceCharge) => update({ serviceCharge })} />
            </Field>
            <Field label="Discount">
              <MoneyInput currency={c} value={draft.discount} onChange={(discount) => update({ discount })} />
            </Field>
          </div>
          {draft.suggestedTips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Suggested on receipt:</span>
              {draft.suggestedTips.map((t) => (
                <button
                  key={t}
                  onClick={() => update({ tip: t })}
                  className={cn(
                    "h-10 rounded-full border border-hairline bg-card px-4 transition hover:border-foreground/40",
                    draft.tip === t && "border-foreground",
                  )}
                >
                  {formatMoney(t, c)}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Tax, tip and fees are shared in proportion to what each person had.</p>
        </section>

        <StepBar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">
              Subtotal {formatMoney(subtotal, c)}
              {mismatch && <span className="text-warning"> · receipt says {formatMoney(draft.printedTotal!, c)}</span>}
            </p>
            <p className="tabular font-display text-2xl">{formatMoney(total, c)}</p>
          </div>
          <Button size="lg" disabled={!canContinue} onClick={onNext}>
            Next: who had what
          </Button>
        </StepBar>
      </div>
    </div>
  );
}
