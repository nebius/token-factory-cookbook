"use client";

// Under an answer or tour: the conversation so far (one pill per turn), the follow-ups DeepSeek suggested, and a box
// to ask your own. Each follow-up goes after the cached repo with a recap of the conversation.
import { CornerDownRight, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { AskBox, costOf } from "@/components/trail/ask-box";
import { formatUsd } from "@/lib/format";
import { pickMode, type AskMode } from "@/lib/match";
import type { RepoSummary } from "@/lib/schemas";
import type { Thread, ThreadTurn } from "@/lib/thread";

type Props = {
  summary: RepoSummary;
  thread: Thread | null;
  /** The answer or tour on screen. */
  activeRef: string | null;
  followUps: string[];
  busy: boolean;
  /** Start with the box open (answers); tours keep it folded so the code stays in view. */
  open?: boolean;
  onTurn: (turn: ThreadTurn) => void;
  onAsk: (question: string, mode: AskMode) => Promise<boolean> | void;
};

export function ThreadView({ summary, thread, activeRef, followUps, busy, open = false, onTurn, onAsk }: Props) {
  const [expanded, setExpanded] = useState(open);
  return (
    <div className="flex flex-col gap-2">
      {thread && thread.turns.length > 1 && (
        <nav aria-label="Conversation" className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.14em] text-fg-3 uppercase">
            <MessagesSquare className="size-3" aria-hidden /> Conversation
          </span>
          {thread.turns.map((t, i) => (
            <button
              key={t.refId}
              onClick={() => onTurn(t)}
              aria-current={t.refId === activeRef ? "step" : undefined}
              title={`${t.kind === "tour" ? "Tour" : "Answer"}: ${t.question}`}
              className={`max-w-[220px] truncate rounded-md border px-1.5 py-0.5 text-left font-mono text-[10.5px] ${t.refId === activeRef ? "border-trail text-trail" : "border-line text-fg-3 hover:text-fg"}`}
            >
              {i + 1}. {t.question}
            </button>
          ))}
        </nav>
      )}
      {followUps.length > 0 && (
        <ul aria-label="Suggested follow-ups" className="flex flex-wrap gap-1.5">
          {followUps.map((q) => (
            <li key={q}>
              <button
                onClick={() => onAsk(q, pickMode(q))}
                disabled={busy}
                title={(() => {
                  const c = costOf(summary, pickMode(q), true);
                  return c ? `Asks this now: ≈ ${formatUsd(c.cached)} if the repo is cached, up to ${formatUsd(c.cold)}` : "Asks this now";
                })()}
                className="inline-flex items-start gap-1 rounded-[9px] border border-line px-2 py-1 text-left text-[12px] leading-snug text-fg-2 hover:border-trail/60 hover:text-fg disabled:opacity-40"
              >
                <CornerDownRight className="mt-0.5 size-3 shrink-0 text-trail" aria-hidden />
                <span>
                  {q}
                  {(() => {
                    const c = costOf(summary, pickMode(q), true);
                    return c ? <span className="ml-1.5 font-mono text-[10px] text-fg-3">≈ {formatUsd(c.cached)}</span> : null;
                  })()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {expanded ? (
        <AskBox summary={summary} label="Ask a follow-up" placeholder="e.g. Why is it done this way?" busy={busy} onAsk={onAsk} followUp autoFocus={!open} />
      ) : (
        <button onClick={() => setExpanded(true)} className="self-start font-mono text-[11px] tracking-[0.06em] text-fg-3 hover:text-fg">
          Ask a follow-up…
        </button>
      )}
    </div>
  );
}
