"use client";

// The Ask box, in the sidebar and under an answer as "Ask a follow-up". Before anything is spent it shows what's
// already stored that answers the question (free), picks Answer or Tour from the wording (switchable, plus
// Thorough), and says what this kind of question costs.
import { CornerDownLeft } from "lucide-react";
import { useId, useState } from "react";
import { formatUsd } from "@/lib/format";
import { matchStored, pickMode, type AskMode, type Stored } from "@/lib/match";
import type { RepoSummary } from "@/lib/schemas";

const MODES: { id: AskMode; label: string; hint: string }[] = [
  { id: "answer", label: "Answer", hint: "A short structured answer: tables, file lists, call sequences, checked code references" },
  { id: "tour", label: "Tour", hint: "A step-by-step walk through the code, in the order it runs" },
  { id: "thorough", label: "Thorough", hint: "Slower and more thorough: traces the answer across every file involved" },
  { id: "research", label: "Research", hint: "For questions one pass can't settle: plans what to find out, looks in up to three rounds, then answers. A few calls on the cached repo" },
];

const KIND_LABEL: Record<Stored["kind"], string> = { tour: "tour", answer: "answer", docs: "docs page", thread: "conversation" };

/** What one question costs: the repo as cached input (or not), the question (and a follow-up's recap), the reply. */
export function costOf(summary: RepoSummary, mode: AskMode, followUp: boolean) {
  const p = summary.price;
  if (!p) return null;
  const fresh = followUp ? 3_000 : 500;
  // Research: a plan, up to three rounds and the answer, five calls on the repo, each sending the findings so far.
  // The first calls on a repo can miss the cache, so the high end counts four at the full price.
  if (mode === "research") {
    const sent = 19_000;
    const written = 15_500;
    return { cached: 5 * summary.tokens * p.cached + sent * p.input + written * p.output, cold: summary.tokens * (4 * p.input + p.cached) + sent * p.input + written * p.output };
  }
  const out = mode === "thorough" ? 14_000 : 5_000;
  return { cached: summary.tokens * p.cached + fresh * p.input + out * p.output, cold: (summary.tokens + fresh) * p.input + out * p.output };
}

type Props = {
  summary: RepoSummary;
  label: string;
  placeholder: string;
  busy: boolean;
  /** Resolves false when the question failed, so the box gives the text back. */
  onAsk: (question: string, mode: AskMode) => Promise<boolean> | void;
  /** Stored work to offer before asking (the sidebar); follow-ups have none. */
  stored?: Stored[];
  onOpenStored?: (item: Stored) => void;
  followUp?: boolean;
  footer?: React.ReactNode;
  /** Focus the box when it appears (a follow-up box the user just opened). */
  autoFocus?: boolean;
};

export function AskBox({ summary, label, placeholder, busy, onAsk, stored, onOpenStored, followUp = false, footer, autoFocus }: Props) {
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<AskMode | null>(null);
  const id = useId();
  const q = question.trim();
  // Research answers new questions; a follow-up keeps to Answer, Tour or Thorough.
  const modes = followUp ? MODES.filter((m) => m.id !== "research") : MODES;
  const mode = picked ?? pickMode(q);
  const matches = stored && q.length >= 8 ? matchStored(q, stored) : [];
  const cost = costOf(summary, mode, followUp);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.length < 3 || busy) return;
    const asked = question;
    setQuestion("");
    setPicked(null);
    Promise.resolve(onAsk(q, mode)).then((ok) => ok === false && setQuestion((now) => now || asked));
  }

  return (
    <form onSubmit={submit} className="rounded-[14px] border border-line bg-panel p-3">
      <label htmlFor={`${id}-q`} className="font-display text-[15px] font-medium [font-stretch:85%]">
        {label}
      </label>
      <textarea
        id={`${id}-q`}
        autoFocus={autoFocus}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
        rows={2}
        maxLength={300}
        placeholder={placeholder}
        aria-describedby={`${id}-cost`}
        className="mt-2 w-full resize-none rounded-[10px] border border-line bg-ink px-2.5 py-2 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-trail/70"
      />
      {matches.length > 0 && (
        <div className="mb-2 rounded-[10px] border border-ok/30 bg-ok/5 px-2.5 py-2" aria-live="polite">
          <p className="font-mono text-[10px] tracking-[0.14em] text-ok uppercase">Already answered · free</p>
          <ul className="mt-1 space-y-0.5">
            {matches.map((m) => (
              <li key={`${m.kind}:${m.id}`}>
                <button type="button" onClick={() => onOpenStored?.(m)} className="w-full truncate text-left text-[12.5px] text-fg-2 hover:text-fg">
                  {m.title} <span className="font-mono text-[10.5px] text-fg-3">· {KIND_LABEL[m.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Kind of answer" className="flex gap-0.5 rounded-[9px] border border-line p-[2px]">
          {modes.map((m, i) => (
            <button
              key={m.id}
              id={`${id}-mode-${m.id}`}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              tabIndex={mode === m.id ? 0 : -1}
              title={m.hint}
              onClick={() => setPicked(m.id)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = modes[(i + step + modes.length) % modes.length].id;
                setPicked(next);
                document.getElementById(`${id}-mode-${next}`)?.focus();
              }}
              className={`rounded-[7px] border-b-2 px-1.5 py-0.5 font-mono text-[10.5px] ${mode === m.id ? "border-trail bg-fg text-ink" : "border-transparent text-fg-3 hover:text-fg"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="submit" disabled={q.length < 3 || busy} title={q.length < 3 ? "Type a question first" : undefined} className="inline-flex items-center gap-1 rounded-[8px] bg-trail px-2.5 py-1 text-xs font-semibold text-[#16171a] disabled:opacity-40">
          Ask <CornerDownLeft className="size-3" />
        </button>
      </div>
      {question.length > 240 && <p className="mt-1 font-mono text-[10.5px] text-fg-3">{300 - question.length} characters left</p>}
      <p id={`${id}-cost`} className="mt-1.5 font-mono text-[10.5px] text-fg-3">
        {cost ? `≈ ${formatUsd(cost.cached)} if the repo is cached · up to ${formatUsd(cost.cold)}` : "Priced after the call"}
      </p>
      {footer}
    </form>
  );
}
