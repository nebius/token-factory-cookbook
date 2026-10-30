"use client";

import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Copy, Cpu, Loader2, MessageCircle, RotateCcw, Share2 } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, Eyebrow } from "@/components/ui/primitives";
import { categoryOf } from "@/config/categories";
import { site } from "@/config/site";
import { allocate, formatMoney, SplitError, toMinor, type MemberShare } from "@/lib/money";
import { cn, formatDate } from "@/lib/utils";
import type { SplitResult } from "@/server/ai/split-agent";
import { assignmentKey, formatUsd, requestSplit } from "./ai";
import { CheckTrace } from "./check-trace";
import { computeDraftSplit, expenseLines, type AiCall, type Draft } from "./draft";
import { useModel } from "./model-card";

type AiState = { status: "loading" } | { status: "done"; result: SplitResult } | { status: "error"; message: string };

export function SummaryStep({
  draft,
  update,
  onEdit,
  onReset,
}: {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
  onEdit: () => void;
  onReset: () => void;
}) {
  const c = draft.currency;
  const key = assignmentKey(draft);
  const reusable = draft.aiSplit?.key === key ? draft.aiSplit : undefined;
  const [ai, setAi] = React.useState<AiState>(
    reusable
      ? { status: "done", result: reusable }
      : draft.kind === "itemized"
        ? { status: "loading" }
        : { status: "error", message: "the AI only splits itemized bills" },
  );
  const started = React.useRef<string | null>(null);

  // The app's own calculation: used for the per-line breakdown, and as a labelled fallback if the AI step fails.
  const result = React.useMemo(() => {
    try {
      return { split: computeDraftSplit(draft) };
    } catch (e) {
      if (e instanceof SplitError) return { error: e.message };
      throw e;
    }
  }, [draft]);

  // The model splits the bill with its own tool calls. Reuse the note-mode run if the lines haven't changed since.
  React.useEffect(() => {
    if (draft.kind !== "itemized" || reusable || started.current === key || "error" in result) return;
    started.current = key;
    const abort = new AbortController();
    setAi({ status: "loading" });
    requestSplit(draft, { lines: true }, abort.signal)
      .then((res) => {
        setAi({ status: "done", result: res });
        update((d) => ({
          ...d,
          aiSplit: { ...res, key },
          aiCalls: [...(d.aiCalls ?? []), { ...res.usage, label: "Split with tools (your assignment)" }],
        }));
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setAi({ status: "error", message: e instanceof Error ? e.message : "The AI split failed" });
      });
    return () => {
      // Cancelled (unmounted, or the assignment changed): let the next run start a fresh request.
      started.current = null;
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Per-person line breakdown, using the same weighted allocation as the totals.
  const breakdown = React.useMemo(() => {
    const map = new Map<string, { name: string; amount: number }[]>();
    for (const line of expenseLines(draft)) {
      if (!line.assignees.length) continue;
      const parts = allocate(
        line.amount,
        line.assignees.map((a) => a.weight),
      );
      line.assignees.forEach((a, i) => {
        const list = map.get(a.memberId) ?? [];
        list.push({ name: line.assignees.length === 1 ? line.name : `${line.name} (1/${line.assignees.length})`, amount: parts[i] });
        map.set(a.memberId, list);
      });
    }
    return map;
  }, [draft]);

  if ("error" in result) {
    return (
      <div className="mx-auto max-w-md rounded-md bg-stone p-6 text-center">
        <p>{result.error}</p>
        <Button className="mt-4" onClick={onEdit}>
          Fix it
        </Button>
      </div>
    );
  }

  const { split } = result;
  const aiResult = ai.status === "done" ? ai.result : null;
  const aiOk = Boolean(aiResult?.validation.ok && aiResult.shares);
  // The numbers shown: the model's own allocate_tax_tip shares when its split passed the check, else the app's.
  const shareOf = (s: MemberShare) => (aiOk && aiResult!.shares![s.memberId] != null ? toMinor(aiResult!.shares![s.memberId], c) : s.total);
  const total = aiOk && aiResult!.total != null ? toMinor(aiResult!.total, c) : split.total;
  const agrees = aiOk && split.shares.every((s) => shareOf(s) === s.total);

  const nameOf = (id: string) => draft.people.find((p) => p.id === id)?.name ?? "Someone";
  const payer = draft.paidBy ? nameOf(draft.paidBy) : null;
  const shares = [...split.shares].filter((s) => s.total !== 0).sort((a, b) => b.total - a.total);
  const title = draft.merchant.trim() || "Shared expense";
  const category = categoryOf(draft.category);

  const shareText = [
    `${title} · ${formatMoney(total, c)}${payer ? ` (paid by ${payer})` : ""}`,
    ...shares.map((s) => `• ${nameOf(s.memberId)}: ${formatMoney(shareOf(s), c)}${s.memberId === draft.paidBy ? " (paid)" : ""}`),
    "",
    `Split with ${site.name} · ${site.model}`,
  ].join("\n");

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} split`, text: shareText });
        return;
      } catch {
        // cancelled: fall through to copy
      }
    }
    await copy();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  const trace = [...(draft.checks ?? []), ...(aiResult?.trace ?? [])];

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-band px-6 py-8 text-center text-band-foreground sm:py-10"
      >
        <p className="eyebrow inline-flex items-center gap-2 opacity-75">
          <category.icon className="size-3.5" /> {category.label} · {formatDate(draft.date)}
        </p>
        <h1 className="mt-3 text-3xl sm:text-4xl">{title}</h1>
        {ai.status === "loading" ? (
          <p className="mt-5 flex items-center justify-center gap-2 text-lg opacity-80">
            <Loader2 className="size-5 animate-spin" /> Splitting…
          </p>
        ) : (
          <p className="tabular mt-4 font-display text-5xl sm:text-6xl">{formatMoney(total, c)}</p>
        )}
        {payer && <p className="mt-3 text-sm opacity-75">Paid by {payer}</p>}
      </motion.div>

      <AiStatus ai={ai} agrees={agrees} />

      {ai.status !== "loading" && (
      <>
      <div>
        <Eyebrow className="mb-2">Who owes what</Eyebrow>
        <ul className="divide-y divide-border border-y border-border">
          {shares.map((s, i) => (
            <motion.li key={s.memberId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 * i }}>
              <PersonRow
                share={s}
                amount={shareOf(s)}
                name={nameOf(s.memberId)}
                currency={c}
                isPayer={s.memberId === draft.paidBy}
                payer={payer}
                lines={breakdown.get(s.memberId) ?? []}
              />
            </motion.li>
          ))}
        </ul>
      </div>

      {trace.length > 0 && (
        <CheckTrace
          trace={trace}
          toolMode="native"
          note="MODEL steps are tool calls Nemotron chose to make: it passes who had what, and the calculator tools return the numbers. APP steps are the app's own checks: the bill's arithmetic after reading, and that the model's shares add up."
        />
      )}

      <UsagePanel calls={draft.aiCalls ?? []} />

      <div className="grid gap-2 sm:grid-cols-3">
        <Button size="lg" onClick={share}>
          <Share2 /> Share
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
            <MessageCircle /> WhatsApp
          </a>
        </Button>
        <Button size="lg" variant="outline" onClick={copy}>
          <Copy /> Copy
        </Button>
      </div>
      </>
      )}
      <div className="flex flex-col gap-4 rounded-md bg-stone p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-lg">Splitting a whole trip?</p>
          <p className="text-sm text-muted-foreground">
            The full {site.originalName} app adds groups, running balances, invites and Settle with AI across every bill.
          </p>
        </div>
        <Button variant="outline" asChild className="bg-card">
          <a href={site.deployedUrl} target="_blank" rel="noreferrer">
            Open the full app <ArrowUpRight />
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onEdit}>
          Change who had what
        </Button>
        <Button variant="link" onClick={onReset}>
          <RotateCcw /> Start a new split
        </Button>
      </div>
    </div>
  );
}

function AiStatus({ ai, agrees }: { ai: AiState; agrees: boolean }) {
  if (ai.status === "loading")
    return (
      <div className="grid gap-3 rounded-lg border border-border bg-card p-5 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Loader2 className="size-4 animate-spin" /> {site.model} is working out each share with calculator tool calls
        </p>
        <ol className="grid gap-1.5 text-muted-foreground">
          <li>1 · check_receipt: checks each bill&apos;s arithmetic</li>
          <li>2 · allocate_tax_tip: splits each bill by who had what, with its tax and tip</li>
          <li>3 · validate_total: confirms the shares add up, then the app checks them again</li>
        </ol>
        <p className="text-xs text-muted-foreground">Reasoning is on, so this usually takes 5–20 seconds. The shares appear when the model is done.</p>
      </div>
    );
  if (ai.status === "error")
    return (
      <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          The AI split failed ({ai.message}). The amounts below were calculated by the app with the same money engine, not by the model.
        </span>
      </p>
    );
  const r = ai.result;
  const calls = r.trace.filter((t) => t.by === "model").length;
  if (!r.validation.ok)
    return (
      <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          The model&apos;s split didn&apos;t pass the app&apos;s check: {r.validation.reason} The amounts below were calculated by the app instead.
        </span>
      </p>
    );
  return (
    <p className="flex gap-2 rounded-md border border-positive/30 bg-positive-soft px-4 py-3 text-sm text-positive">
      <Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} />
      <span>
        Split by the model with {calls} tool call{calls === 1 ? "" : "s"}; the app checked that the shares add up
        {agrees ? " (and they match its own calculation)." : "."}
      </span>
    </p>
  );
}

/** Every AI call behind this split: tokens (with reasoning), time and cost at Token Factory's catalog price. */
function UsagePanel({ calls }: { calls: AiCall[] }) {
  const model = useModel();
  if (!calls.length) return null;
  const sum = calls.reduce(
    (a, x) => ({ input: a.input + x.input, output: a.output + x.output, reasoning: a.reasoning + x.reasoning, ms: a.ms + x.ms, cost: a.cost + (x.costUsd ?? 0) }),
    { input: 0, output: 0, reasoning: 0, ms: 0, cost: 0 },
  );
  const known = calls.every((x) => x.costUsd != null);
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-card">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <Cpu className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold tracking-[-0.01em]">AI usage and cost</span>
          <span className="block text-xs text-muted-foreground">
            {calls.length} AI {calls.length === 1 ? "call" : "calls"} · {n(sum.input + sum.output)} tokens · {(sum.ms / 1000).toFixed(1)}s
          </span>
        </span>
        <span className="tabular rounded-pill border border-border px-2.5 py-1 text-xs font-medium">{known ? formatUsd(sum.cost) : "price unknown"}</span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border transition-transform duration-200 group-open:rotate-180">
          <ChevronDown className="size-4" />
        </span>
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3 text-sm">
        <ul className="grid gap-3 sm:hidden">
          {[...calls, { label: "Total", input: sum.input, output: sum.output, reasoning: sum.reasoning, ms: sum.ms, costUsd: known ? sum.cost : null, calls: 0 }].map((x, i) => (
            <li key={i} className={cn("grid gap-0.5 border-t border-border pt-3 first:border-0 first:pt-0", i === calls.length && "font-medium")}>
              <span className="flex justify-between gap-3">
                <span>{x.label}</span>
                <span className="tabular">{formatUsd(x.costUsd)}</span>
              </span>
              <span className="tabular text-xs text-muted-foreground">
                {n(x.input)} in · {n(x.output)} out ({n(x.reasoning)} reasoning) · {(x.ms / 1000).toFixed(1)}s
              </span>
            </li>
          ))}
        </ul>
        <div className="overflow-x-auto max-sm:hidden">
          <table className="w-full min-w-[34rem] text-left [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-normal">Call</th>
                <th className="py-1.5 text-right font-normal">Input</th>
                <th className="py-1.5 text-right font-normal">Output (reasoning)</th>
                <th className="py-1.5 text-right font-normal">Time</th>
                <th className="py-1.5 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {calls.map((x, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 pr-3">
                    {x.label}
                    {x.calls > 1 && <span className="text-muted-foreground"> · {x.calls} model turns</span>}
                  </td>
                  <td className="py-2 text-right">{n(x.input)}</td>
                  <td className="py-2 text-right">
                    {n(x.output)} <span className="text-muted-foreground">({n(x.reasoning)})</span>
                  </td>
                  <td className="py-2 text-right">{(x.ms / 1000).toFixed(1)}s</td>
                  <td className="py-2 text-right">{formatUsd(x.costUsd)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="py-2">Total</td>
                <td className="py-2 text-right">{n(sum.input)}</td>
                <td className="py-2 text-right">
                  {n(sum.output)} <span className="font-normal text-muted-foreground">({n(sum.reasoning)})</span>
                </td>
                <td className="py-2 text-right">{(sum.ms / 1000).toFixed(1)}s</td>
                <td className="py-2 text-right">{known ? formatUsd(sum.cost) : "–"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {calls.some((x) => x.reasoningText) && (
          <div className="mt-4 grid gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">What the model reasoned</p>
            {calls.map((x, i) =>
              x.reasoningText ? (
                <details key={i} className="rounded-md border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-sm">
                    {x.label} <span className="text-muted-foreground">· {n(x.reasoning)} reasoning tokens</span>
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                    {x.reasoningText}
                  </pre>
                </details>
              ) : null,
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {model?.info
            ? `Priced at $${model.info.inputPerM.toFixed(2)} / 1M input and $${model.info.outputPerM.toFixed(2)} / 1M output tokens, from Nebius Token Factory's /v1/models?verbose=true for ${model.info.id}. Reasoning tokens are billed as output.`
            : "Prices come from Nebius Token Factory's /v1/models?verbose=true."}
        </p>
      </div>
    </details>
  );
}

function PersonRow({
  share,
  amount,
  name,
  currency,
  isPayer,
  payer,
  lines,
}: {
  share: MemberShare;
  /** The amount shown: the model's share when its split passed the check. */
  amount: number;
  name: string;
  currency: string;
  isPayer: boolean;
  payer: string | null;
  lines: { name: string; amount: number }[];
}) {
  const extras = [
    ["Tax", share.tax],
    ["Tip", share.tip],
    ["Fees", share.serviceCharge],
    ["Discount", -share.discount],
  ].filter(([, v]) => v !== 0) as [string, number][];

  return (
    <details className="group">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 py-3">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate">{name}</p>
          <p className="text-sm text-muted-foreground">{isPayer ? "Paid" : payer ? `Owes ${payer}` : ""}</p>
        </div>
        <span className="tabular font-display text-xl">{formatMoney(amount, currency)}</span>
        <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>
      <div className="mb-3 grid gap-1 rounded-sm bg-muted px-4 py-3 text-sm">
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span className="truncate text-muted-foreground">{l.name}</span>
            <span className="tabular">{formatMoney(l.amount, currency)}</span>
          </div>
        ))}
        {extras.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular">{formatMoney(value, currency)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
