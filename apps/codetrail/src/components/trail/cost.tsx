"use client";

import { X } from "lucide-react";
import { useRef } from "react";
import { priceOf, savedBy } from "@/lib/cache";
import { cachedShare, formatTokens, formatUsd, perMillion, seconds } from "@/lib/format";
import { modelLabel, modelsOf } from "@/lib/models";
import type { CallRecord, RepoSummary } from "@/lib/schemas";
import { useModal } from "./dialog";
import { Receipt } from "./receipt";

const totalCost = (ledger: CallRecord[]) => ledger.reduce((a, c) => a + (c.cost ?? 0), 0);
/** Each call at its own model's prices, so a repo read with one model and asked with another adds up right. */
const totalSaved = (ledger: CallRecord[], summary: RepoSummary) =>
  ledger.reduce((a, c) => a + Math.max(0, c.saved ?? savedBy(c.usage, priceOf(c, summary)) ?? 0), 0);

export function CostPill({ ledger, summary, onOpen }: { ledger: CallRecord[]; summary: RepoSummary; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-1.5 text-[12.5px] text-fg-2 transition hover:border-outline hover:text-fg">
      <span className="font-mono text-fg">{formatUsd(totalCost(ledger))}</span>
      <span className="hidden sm:inline">
        · {ledger.length} {ledger.length === 1 ? "call" : "calls"} · saved <span className="font-mono text-verified">{formatUsd(totalSaved(ledger, summary))}</span>
      </span>
    </button>
  );
}

/** The cached share as a small bar: amber is the part served from the prompt cache. */
function CacheBar({ usage }: { usage: CallRecord["usage"] }) {
  const share = cachedShare(usage);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${usage.cached.toLocaleString()} of ${usage.input.toLocaleString()} input tokens from cache`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-trail" style={{ width: `${share}%` }} />
      </span>
      <span className="font-mono">{share}%</span>
    </span>
  );
}

export function CallLine({ call }: { call: CallRecord }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-3">
      <span className="text-fg-2">{formatUsd(call.cost)}</span>
      <span>
        {formatTokens(call.usage.input)} in · <CacheBar usage={call.usage} /> cached
      </span>
      <span>{formatTokens(call.usage.output)} out</span>
      <span>{seconds(call.ms)}</span>
    </span>
  );
}

export function CostDrawer({ open, onClose, ledger, summary }: { open: boolean; onClose: () => void; ledger: CallRecord[]; summary: RepoSummary }) {
  const panel = useRef<HTMLElement>(null);
  useModal(panel, onClose, open);
  if (!open) return null;
  const input = ledger.reduce((a, c) => a + c.usage.input, 0);
  const cached = ledger.reduce((a, c) => a + c.usage.cached, 0);
  const p = summary.price;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="What this repo cost" tabIndex={-1} className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-line bg-night outline-none">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[20px] font-medium tracking-tight [font-stretch:85%]">What this repo cost</h2>
            <p className="text-xs text-fg-3">Every call to {ledger.length ? modelsOf(ledger).join(" and ") : summary.modelLabel}, priced live from Nebius Token Factory.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-fg-3 hover:bg-raised hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          <div className="grid grid-cols-3 border-y border-line">
            {[
              { label: "Spent on your key", value: formatUsd(totalCost(ledger)), cls: "text-trail" },
              { label: "Saved by cached input", value: formatUsd(totalSaved(ledger, summary)), cls: "text-verified" },
              { label: "Input cached", value: `${input ? Math.round((cached / input) * 100) : 0}%`, cls: "text-fg" },
            ].map((s) => (
              <div key={s.label} className="py-3 pr-2">
                <p className="font-mono text-[10px] tracking-[0.15em] text-fg-3 uppercase">{s.label}</p>
                <p className={`mt-1 font-display text-[22px] font-medium [font-stretch:80%] ${s.cls}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {p && (
            <p className="text-[12px] leading-relaxed text-fg-3">
              Per 1M tokens: {perMillion(p.input)} input · <span className="text-trail">{perMillion(p.cached)} cached input</span> · {perMillion(p.output)} output. The first read sends
              the whole repo (~{formatTokens(summary.tokens)} tokens). Later questions send the same repo first, so it can be billed as cached input, {Math.round(p.input / p.cached)}×
              cheaper. The cache is per server, so the first few calls on a repo can still miss.
            </p>
          )}
          {ledger.length === 0 ? (
            <p className="text-sm text-fg-3">No model calls yet. Everything so far came from GitHub and the import graph, for free.</p>
          ) : (
            <div className="space-y-5">
              {[...ledger].reverse().map((c) => (
                <Receipt key={c.id} call={c} price={priceOf(c, summary)} model={modelLabel(c.model)} title={c.kind === "atlas" ? "Read the repo: map + main tour" : c.label} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
