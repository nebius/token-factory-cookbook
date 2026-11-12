"use client";

// A pull request in the trail: what it is (GitHub's facts), what touring it costs, the tour building live, and
// once it's done, a reviewer's notes, each pointing at a checked line in the PR's code.
import { ArrowUpRight, Check, ChevronDown, CircleHelp, FlaskConical, GitPullRequest, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Rich } from "@/components/rich";
import { formatTokens, formatUsd } from "@/lib/format";
import type { PullFacts, PullView, ReviewNote } from "@/lib/schemas";

export type PullLive = { thinkingChars: number; title: string | null; steps: string[] };

const KIND: Record<ReviewNote["kind"], { label: string; icon: React.ReactNode; tone: string }> = {
  risk: { label: "Risk", icon: <TriangleAlert className="size-3" />, tone: "text-warn border-warn/40" },
  test: { label: "Test", icon: <FlaskConical className="size-3" />, tone: "text-fg-2 border-line" },
  question: { label: "Question", icon: <CircleHelp className="size-3" />, tone: "text-fg-2 border-line" },
  nit: { label: "Nit", icon: <Sparkles className="size-3" />, tone: "text-fg-3 border-line" },
};

/** The PR's facts. `compact` drops the title (a PR tour's own title sits right below it). */
export function PullHeader({ facts, compact }: { facts: PullFacts; compact?: boolean }) {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-fg-3">
        <GitPullRequest className="size-3.5 text-trail" aria-hidden />
        <span className="text-fg-2">PR #{facts.number}</span>
        <span className={`rounded-md border px-1.5 py-px text-[10.5px] tracking-[0.08em] uppercase ${facts.state === "open" ? "border-ok/40 text-ok" : "border-line text-fg-3"}`}>
          {facts.draft ? "draft" : facts.state}
        </span>
        <a href={facts.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">
          GitHub <ArrowUpRight className="size-3" />
        </a>
      </p>
      {!compact && <h2 className="mt-1.5 font-display text-[21px] leading-[1.12] font-medium tracking-[-0.025em] [font-stretch:85%]">{facts.title}</h2>}
      <p className={`font-mono text-[11.5px] text-fg-3 ${compact ? "mt-1" : "mt-1.5"}`}>
        by {facts.author} · <span className="text-ok">+{facts.additions.toLocaleString()}</span> <span className="text-danger">−{facts.deletions.toLocaleString()}</span> · {facts.changedFiles}{" "}
        {facts.changedFiles === 1 ? "file" : "files"} · into {facts.baseRef}
      </p>
    </div>
  );
}

type StartProps = { view: PullView; readSha: string; busy: boolean; live: PullLive | null; onTour: () => void };

/** Before the tour exists: what would be sent and what it costs, then the live build. */
export function PullStart({ view, readSha, busy, live, onTour }: StartProps) {
  const { estimate, sent } = view;
  return (
    <div className="flex flex-col gap-3">
      <PullHeader facts={view.facts} />
      {busy ? (
        <div className="rounded-card border border-trail/40 bg-trail-soft px-4 py-3" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-fg">
            <Loader2 className="size-4 animate-spin text-trail" />
            {live?.steps.length ? `Writing the tour · ${live.steps.length} ${live.steps.length === 1 ? "step" : "steps"}` : live?.thinkingChars ? "Reading the change" : "Sending the change"}
          </p>
          {live?.title && <p className="mt-1.5 text-[13.5px] text-fg-2">{live.title}</p>}
          {live && live.steps.length > 0 && (
            <ol className="mt-2 space-y-0.5 font-mono text-[11.5px] text-fg-2">
              {live.steps.map((s, i) => (
                <li key={i}>
                  {String(i + 1).padStart(2, "0")} {s}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <>
          <p className="text-[13.5px] leading-relaxed text-fg-2">
            Codetrail already has this repo (read at {readSha.slice(0, 7)}). The tour adds only the change: {sent.patches} {sent.patches === 1 ? "patch" : "patches"}
            {sent.head ? ` and the PR's version of ${sent.head} changed ${sent.head === 1 ? "file" : "files"}` : ""}, about {formatTokens(view.tokens)} tokens.
            {sent.left.length > 0 && ` ${sent.left.length} large ${sent.left.length === 1 ? "patch is" : "patches are"} left out to fit.`}
          </p>
          <button onClick={onTour} className="inline-flex items-center justify-between gap-3 self-start rounded-[12px] bg-trail px-4 py-2.5 text-left text-[#16171a] hover:bg-trail-strong">
            <span>
              <span className="block text-[14px] font-semibold">Tour this PR</span>
              {estimate.cached !== null && (
                <span className="block font-mono text-[10.5px]">
                  ≈ {formatUsd(estimate.cached)} with the repo cached · up to {formatUsd(estimate.cold)}
                </span>
              )}
            </span>
            <GitPullRequest className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}

/** A reviewer's notes under a PR tour. Notes whose quoted line was found open the code there. */
export function ReviewNotes({ notes, onOpen }: { notes: ReviewNote[]; onOpen: (file: string, line: number) => void }) {
  if (!notes.length) return <p className="font-mono text-[11px] text-fg-3">No review notes: nothing in the change stood out.</p>;
  return (
    <details className="group rounded-card border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-mono text-[10.5px] tracking-[0.14em] text-fg-3 uppercase hover:text-fg">
        <span>
          For the reviewer · {(["risk", "test", "question", "nit"] as const)
            .map((k) => [k, notes.filter((n) => n.kind === k).length] as const)
            .filter(([, c]) => c > 0)
            .map(([k, c]) => `${c} ${c === 1 ? k : `${k}s`}`)
            .join(" · ")}
        </span>
        <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="max-h-[26vh] space-y-2.5 overflow-y-auto border-t border-line px-3 py-2.5">
        {notes.map((n, i) => {
          const k = KIND[n.kind];
          return (
            <li key={i} className="text-[13px] leading-snug text-fg-2">
              <span className={`mr-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-px align-[1px] font-mono text-[10px] tracking-[0.06em] uppercase ${k.tone}`}>
                {k.icon}
                {k.label}
              </span>
              <Rich text={n.text} />
              {n.file && (
                <span className="mt-1 block font-mono text-[11px]">
                  {n.checked && n.line ? (
                    <button onClick={() => onOpen(n.file!, n.line!)} className="inline-flex items-center gap-1 text-fg-3 hover:text-trail">
                      <Check className="size-3 text-ok" aria-label="line checked" />
                      {n.file}:{n.line}
                    </button>
                  ) : (
                    <span className="text-fg-3" title="The line this note quotes wasn't found in the PR's code.">
                      {n.file} · couldn&apos;t verify the line
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
