"use client";

import { AlertTriangle, Check, ChevronDown, ShieldCheck } from "lucide-react";
import type { ToolCall } from "@/server/ai/tools";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = {
  check_receipt: "Checked a bill's arithmetic",
  allocate_tax_tip: "Split a bill by line, with tax and tip",
  calculate_split: "Calculated a split",
  validate_total: "Checked shares add up to the total",
  computed_by_model: "Checked the AI calculated this split",
};

// Tool results carry plain major-unit numbers; show them with two decimals for reading only.
const fmt = (n: unknown) =>
  typeof n === "number" ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(n ?? "");

/** What a call found, laid out for scanning: issues as a callout, shares as chips, totals as one line. */
function Result({ c }: { c: ToolCall }) {
  const r = (c.result ?? {}) as Record<string, unknown>;
  if (typeof r.error === "string") return <Callout>{r.error}</Callout>;

  if (c.tool === "check_receipt") {
    const issues = (r.issues as string[] | undefined) ?? [];
    return issues.length ? (
      <Callout>
        <span className="font-medium">Bill #{String(r.bill)}:</span> {issues.join(" ")}
      </Callout>
    ) : (
      <p className="text-sm text-muted-foreground">
        Bill #{String(r.bill)} adds up to {fmt(r.printedTotal ?? r.linesTotal)}.
      </p>
    );
  }

  if (c.tool === "validate_total") {
    return r.ok ? (
      <p className="text-sm text-muted-foreground">
        Shares {fmt(r.sharesSum)} = total {fmt(r.total)}
      </p>
    ) : (
      <Callout>
        Off by {fmt(r.diff)}: shares {fmt(r.sharesSum)}, total {fmt(r.total)}
      </Callout>
    );
  }

  const shares = Object.entries((r.shares as Record<string, number> | undefined) ?? {});
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {c.tool === "allocate_tax_tip" ? `Bill #${String(r.bill)}` : `Total ${fmt(r.amount)}`}
        {shares.length ? ` · ${shares.length} people` : ""}
        {r.unassigned ? ` · ${fmt(r.unassigned)} unassigned` : ""}
      </p>
      {shares.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {shares.map(([name, v]) => (
            <li key={name} className="inline-flex items-center gap-2 rounded-pill border border-border bg-muted/60 py-1 pl-2.5 pr-3 text-xs">
              <span className="max-w-[10rem] truncate text-muted-foreground">{name}</span>
              <span className="tabular font-medium text-foreground">{fmt(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** "How this was checked": every calculator tool call behind the plan, as a timeline. */
export function CheckTrace({ trace, toolMode, note }: { trace: ToolCall[]; toolMode: "native" | "app"; note?: string }) {
  if (!trace.length) return null;
  const failed = trace.filter((c) => !c.ok).length;
  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-card">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <ShieldCheck className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold tracking-[-0.01em]">How this was checked</span>
          <span className="block text-xs text-muted-foreground">
            {trace.length} {trace.length === 1 ? "step" : "steps"} · the AI does every sum with calculator tools, the app checks them
          </span>
        </span>
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium sm:inline-flex",
            failed ? "border-warning/30 bg-warning-soft text-warning" : "border-positive/30 bg-positive-soft text-positive",
          )}
        >
          {failed ? <AlertTriangle className="size-3" /> : <Check className="size-3" strokeWidth={3} />}
          {failed ? `${failed} flagged` : "All checks passed"}
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border transition-transform duration-200 group-open:rotate-180">
          <ChevronDown className="size-4" />
        </span>
      </summary>

      <div className="border-t border-border px-4 pb-4 pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {note ??
            (toolMode === "native"
              ? "The AI read the bills, decided who shares what and called these calculator tools for every number. Steps marked “app” are the app's checks on the AI's results."
              : "The AI couldn't finish this plan with its tool calls, so the app ran these checks itself and gave the results to the AI. Check the flagged splits before publishing.")}
        </p>
        <ol className="mt-4">
          {trace.map((c, i) => (
            <li key={i} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0">
              {/* Timeline rail */}
              {i < trace.length - 1 && <span aria-hidden className="absolute bottom-0 left-[0.8125rem] top-7 w-px bg-border" />}
              <span
                className={cn(
                  "relative z-10 flex size-7 items-center justify-center rounded-full border",
                  c.ok ? "border-positive/30 bg-positive-soft text-positive" : "border-warning/30 bg-warning-soft text-warning",
                )}
              >
                {c.ok ? <Check className="size-3.5" strokeWidth={3} /> : <AlertTriangle className="size-3.5" />}
              </span>
              <div className="grid min-w-0 gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-medium">{LABEL[c.tool] ?? c.tool}</p>
                  <span className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{c.tool}</span>
                  <span
                    className={cn(
                      "rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                      c.by === "app" ? "bg-[#4f6bff]/15 text-[#8da2ff]" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {c.by}
                  </span>
                  <span className="font-mono text-[10px] text-subtle">{c.ms}ms</span>
                </div>
                <Result c={c} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
