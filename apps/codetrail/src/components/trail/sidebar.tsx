"use client";

import { ArrowUpRight, BookOpen, ChevronDown, GitPullRequest, Loader2, Lock, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Rich } from "@/components/rich";
import type { DocPage } from "@/lib/docs-schema";
import { formatUsd } from "@/lib/format";
import type { AskMode, Stored } from "@/lib/match";
import { PALETTE } from "@/lib/palette";
import { LOCAL_OWNER, parseRepoInput } from "@/lib/ref";
import type { Atlas, CallRecord, PullIndexEntry, RepoSummary, TourIndexEntry } from "@/lib/schemas";
import { dismissNote, noteDismissed, seenLabel } from "@/lib/progress";
import type { ThreadIndexEntry } from "@/lib/thread";
import { AskBox } from "./ask-box";
import { sameText } from "./player";
import { Ember } from "./warmth";

const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/** Docs write about 12K output tokens (measured: 11.4K for 10 pages); the repo is input, cached or not. */
function docsEstimate(summary: RepoSummary) {
  const p = summary.price;
  if (!p) return "one page per module";
  const out = 12_000 * p.output;
  return `one page per module · ≈ ${formatUsd(summary.tokens * p.cached + out)} cached, up to ${formatUsd(summary.tokens * p.input + out)}`;
}

type Props = {
  summary: RepoSummary;
  atlas: Atlas;
  tours: TourIndexEntry[];
  ledger: CallRecord[];
  activeTourId: string | null;
  tracing: string | null;
  onOpenTour: (id: string) => void;
  onTrace: (question: string) => void;
  answers: { id: string; question: string; title: string }[];
  activeAnswerId: string | null;
  onOpenAnswer: (id: string) => void;
  onAsk: (question: string, mode: AskMode) => Promise<boolean>;
  docsPages: DocPage[] | null;
  docsBusy: boolean;
  onDocs: (node?: string) => void;
  pulls: PullIndexEntry[];
  activePull: number | null;
  threads: ThreadIndexEntry[];
  activeThreadId: string | null;
  onOpenThread: (id: string) => void;
  /** Steps seen per tour, in this browser. */
  seen: Record<string, number[]>;
  /** Tours of the repo's earlier read that could be brought to this commit. */
  carry: { from: string; count: number } | null;
  onCarry: () => void;
  /** Forgets the steps seen, so every tour starts fresh. */
  onResetProgress: () => void;
  /** Opens a CodeTour file from a GitHub or gist link; resolves to an error message, or null when it opened. */
  onTourUrl: (url: string) => Promise<string | null>;
  /** Starts writing a tour by hand. */
  onWrite: () => void;
};

export function Sidebar(props: Props) {
  const { summary, atlas, tours, ledger, activeTourId, tracing, onOpenTour, onTrace, answers, activeAnswerId, onOpenAnswer, onAsk, docsPages, docsBusy, onDocs, pulls, activePull, threads, activeThreadId, onOpenThread, seen, carry, onCarry, onResetProgress, onTourUrl, onWrite } = props;
  const progress = (t: { id: string; steps: number }) => {
    const label = seenLabel(seen[t.id], t.steps);
    return label ? ` · ${label}` : "";
  };
  const [overview, setOverview] = useState(true);
  const local = summary.owner === LOCAL_OWNER;
  const byQuestion = new Map(tours.map((t) => [norm(t.question), t]));
  const suggested = atlas.tours.map((t) => ({ ...t, traced: byQuestion.get(norm(t.question)) }));
  const suggestedSet = new Set(atlas.tours.map((t) => norm(t.question)));
  const asked = tours.filter((t) => !suggestedSet.has(norm(t.question)) && !t.source).sort((a, b) => b.at - a.at);
  const maintainers = tours.filter((t) => t.source === "codetour");
  const yours = tours.filter((t) => t.source === "custom").sort((a, b) => b.at - a.at);
  const anySeen = Object.values(seen).some((s) => s.length > 0);
  // Once per repo: the maintainers wrote tours, here's where to start.
  const noteId = `${summary.owner}/${summary.repo}:maintainer-tours`;
  const [note, setNote] = useState(false);
  useEffect(() => setNote(maintainers.length > 0 && !noteDismissed(noteId)), [maintainers.length, noteId]);
  const first = maintainers.find((t) => t.primary) ?? maintainers[0];
  const langs = Object.entries(summary.languages).sort((a, b) => b[1] - a[1]);
  const langTotal = langs.reduce((a, [, n]) => a + n, 0) || 1;

  // Everything already stored that a new question might match (free to open).
  const stored: Stored[] = [
    ...tours.map((t) => ({ kind: "tour" as const, id: t.id, title: t.title, text: t.question })),
    ...answers.map((a) => ({ kind: "answer" as const, id: a.id, title: a.title, text: a.question })),
    ...(docsPages ?? []).map((d) => ({ kind: "docs" as const, id: d.node, title: d.title, text: d.sections.map((x) => x.heading).join(" ") })),
    ...threads.map((t) => ({ kind: "thread" as const, id: t.id, title: t.title, text: "" })),
  ];
  const openStored = (it: Stored) => (it.kind === "tour" ? onOpenTour(it.id) : it.kind === "answer" ? onOpenAnswer(it.id) : it.kind === "docs" ? onDocs(it.id) : onOpenThread(it.id));

  return (
    <div className="flex flex-col gap-6 p-5">
      <div>
        {local ? (
          <p className="font-mono text-[14px]">{summary.repo}</p>
        ) : (
          <a href={summary.htmlUrl} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1 font-mono text-[14px] hover:text-trail">
            {summary.owner}/{summary.repo}
            <ArrowUpRight className="size-3.5 text-fg-3 group-hover:text-trail" />
          </a>
        )}
        {summary.private && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-fg-2" title="Its code, tours and docs are stored only in this instance's database.">
            <Lock className="size-3" /> {local ? "local folder · stays on this machine" : "private · stays on this instance"}
          </p>
        )}
        {summary.description && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{summary.description}</p>}
        <p className="mt-2 flex items-center gap-3 font-mono text-[11px] text-fg-3">
          <span className="inline-flex items-center gap-1">
            <Star className="size-3" /> {summary.stars.toLocaleString()}
          </span>
          <span>{/^[0-9a-f]{40}$/i.test(summary.ref) ? summary.sha.slice(0, 7) : `${summary.ref} @ ${summary.sha.slice(0, 7)}`}</span>
        </p>
        {langs.length > 0 && (
          <div className="mt-2.5 flex h-1 gap-px overflow-hidden rounded-full" title={langs.map(([l, n]) => `${l} ${Math.round((n / langTotal) * 100)}%`).join(", ")}>
            {langs.slice(0, 6).map(([l, n], i) => (
              <span key={l} style={{ width: `${(n / langTotal) * 100}%`, background: PALETTE[i] }} />
            ))}
          </div>
        )}
      </div>

      <div>
        <button onClick={() => setOverview((o) => !o)} aria-expanded={overview} className="flex w-full items-center justify-between font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">
          Overview <ChevronDown className={`size-3.5 transition ${overview ? "" : "-rotate-90"}`} />
        </button>
        {overview && (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
              <Rich text={atlas.summary} />
            </p>
            {atlas.stack.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {atlas.stack.slice(0, 8).map((s) => (
                  <span key={s} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-fg-2">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => onDocs()}
        disabled={docsBusy}
        className="flex w-full items-center justify-between gap-2 rounded-[12px] border border-line px-3 py-2.5 text-left hover:border-outline disabled:opacity-60"
      >
        <span>
          <span className="block text-[13.5px] text-fg">{docsPages ? "Read the docs" : "Write the docs"}</span>
          <span className="block font-mono text-[10.5px] text-fg-3">
            {docsBusy ? "writing one page per module…" : docsPages ? `${docsPages.length} pages · free · Markdown export` : docsEstimate(summary)}
          </span>
        </span>
        {docsBusy ? <Loader2 className="size-4 animate-spin text-trail" /> : <BookOpen className="size-4 text-trail" />}
      </button>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Tours</h2>
          <span className="flex items-center gap-3">
            {anySeen && (
              <button onClick={onResetProgress} className="font-mono text-[10.5px] text-fg-3 hover:text-fg hover:underline" title="Forget which steps you've seen, in this browser">
                Reset progress
              </button>
            )}
            <button onClick={onWrite} disabled={tracing !== null} className="font-mono text-[10.5px] text-trail hover:underline disabled:opacity-40" title="Write your own tour: pick lines of code and say what they do. Free.">
              + Write a tour
            </button>
          </span>
        </div>
        <TourLink onOpen={onTourUrl} disabled={tracing !== null} />
        {carry && (
          <button onClick={onCarry} className="mt-2 block w-full rounded-[10px] border border-dashed border-trail/50 px-3 py-2 text-left text-[12.5px] text-fg-2 hover:border-trail">
            Bring {carry.count === 1 ? "the tour" : `${carry.count} tours`} from the read at <span className="font-mono">{carry.from.slice(0, 7)}</span>
            <span className="block font-mono text-[10.5px] text-fg-3">each step checked again against this commit · free</span>
          </button>
        )}
        {note && first && (
          <div role="note" className="mt-2 rounded-[10px] border border-trail/40 bg-trail-soft px-3 py-2 text-[12.5px] text-fg-2">
            This repo comes with {maintainers.length === 1 ? "a tour" : `${maintainers.length} tours`} written by its maintainers. Start with{" "}
            <button onClick={() => onOpenTour(first.id)} className="text-trail hover:underline">
              {first.title}
            </button>
            .
            <button
              onClick={() => {
                dismissNote(noteId);
                setNote(false);
              }}
              className="ml-2 font-mono text-[10.5px] text-fg-3 hover:text-fg"
            >
              Got it
            </button>
          </div>
        )}
        <ul className="mt-2">
          {suggested.map((t) => (
            <TourItem
              key={t.question}
              title={t.title}
              question={t.question}
              active={!!t.traced && t.traced.id === activeTourId}
              tracing={tracing !== null && norm(tracing) === norm(t.question)}
              disabled={tracing !== null && !t.traced}
              meta={t.traced ? `${t.traced.steps} steps${progress(t.traced) || " · free to replay"}` : `walk through it · ≈ ${formatUsd(summary.estimate.followUp)}, up to ${formatUsd(summary.estimate.followUpCold)}`}
              onClick={() => (t.traced ? onOpenTour(t.traced.id) : onTrace(t.question))}
            />
          ))}
        </ul>
        {yours.length > 0 && (
          <>
            <h2 className="mt-5 font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Your tours</h2>
            <ul className="mt-2">
              {yours.map((t) => (
                <TourItem key={t.id} title={t.title} question={t.question} active={t.id === activeTourId} tracing={false} disabled={false} meta={`${t.steps} steps · written here${progress(t)}`} onClick={() => onOpenTour(t.id)} />
              ))}
            </ul>
          </>
        )}
        {maintainers.length > 0 && (
          <>
            <h2 className="mt-5 font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Written by the maintainers</h2>
            <ul className="mt-2">
              {maintainers.map((t) => (
                <TourItem key={t.id} title={t.title} question={t.question} active={t.id === activeTourId} tracing={false} disabled={false} meta={`${t.steps} steps · CodeTour file · checked${progress(t)}`} onClick={() => onOpenTour(t.id)} />
              ))}
            </ul>
          </>
        )}
        {answers.length > 0 && (
          <>
            <h2 className="mt-5 font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Answers</h2>
            <ul className="mt-2">
              {[...answers].reverse().map((a) => (
                <TourItem key={a.id} title={a.title} question={a.question} active={a.id === activeAnswerId} tracing={false} disabled={false} meta="answer · free to replay" onClick={() => onOpenAnswer(a.id)} />
              ))}
            </ul>
          </>
        )}
        {threads.length > 0 && (
          <>
            <h2 className="mt-5 font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Conversations</h2>
            <ul className="mt-2">
              {[...threads]
                .sort((a, b) => b.at - a.at)
                .map((t) => (
                  <TourItem key={t.id} title={t.title} question={t.title} active={t.id === activeThreadId} tracing={false} disabled={false} meta={`${t.turns} turns · free to replay`} onClick={() => onOpenThread(t.id)} />
                ))}
            </ul>
          </>
        )}
        {asked.length > 0 && (
          <>
            <h2 className="mt-5 font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Asked here</h2>
            <ul className="mt-2">
              {asked.map((t) => (
                <TourItem
                  key={t.id}
                  title={t.title}
                  question={t.question}
                  active={t.id === activeTourId}
                  tracing={false}
                  disabled={false}
                  meta={`${t.steps} steps${progress(t) || " · free to replay"}`}
                  onClick={() => onOpenTour(t.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {!local && <PullRequests summary={summary} pulls={pulls} active={activePull} />}

      <AskBox
        summary={summary}
        label="Ask how something works"
        placeholder="e.g. How does a request reach the route handler?"
        busy={tracing !== null}
        onAsk={onAsk}
        stored={stored}
        onOpenStored={openStored}
        footer={
          <div className="mt-2 border-t border-line pt-2">
            <Ember ledger={ledger} summary={summary} />
          </div>
        }
      />
    </div>
  );
}

function TourItem(props: { title: string; question: string; meta: string; active: boolean; tracing: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={props.onClick}
        disabled={props.disabled}
        className={`group w-full border-l-2 py-2.5 pl-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${props.active ? "border-trail" : "border-line hover:border-outline"}`}
      >
        <span className="block text-[13.5px] leading-snug text-fg">
          <Rich text={props.title} />
        </span>
        {!sameText(props.title, props.question) && (
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-fg-3">
            <Rich text={props.question} />
          </span>
        )}
        <span className={`mt-1 flex items-center gap-1.5 font-mono text-[10.5px] ${props.active ? "text-trail" : "text-fg-3"}`}>
          {props.tracing && <Loader2 className="size-3 animate-spin text-trail" />}
          {props.tracing ? "walking through…" : props.meta}
        </span>
      </button>
    </li>
  );
}

/** Stored PR tours for this read, newest first, and a box to open any PR by number or link. */
function PullRequests({ summary, pulls, active }: { summary: RepoSummary; pulls: PullIndexEntry[]; active: number | null }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Newest first; a PR toured again after a new push keeps its earlier tours, listed under the latest.
  const byNumber = new Map<number, PullIndexEntry[]>();
  for (const p of [...pulls].sort((a, b) => b.at - a.at)) byNumber.set(p.number, [...(byNumber.get(p.number) ?? []), p]);
  const go = (n: number, tourId?: string) => window.location.assign(`/${summary.owner}/${summary.repo}/pull/${n}${tourId ? `?tour=${tourId}` : ""}`);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim().replace(/^#/, "");
    const n = /^\d+$/.test(v) ? Number(v) : parseRepoInput(v)?.pull;
    if (!n) return setError("A PR number, or a link to one.");
    go(n);
  }

  return (
    <div>
      <h2 className="font-mono text-[10.5px] tracking-[0.18em] text-fg-3 uppercase">Pull requests</h2>
      {byNumber.size > 0 && (
        <ul className="mt-2">
          {[...byNumber.values()].map(([p, ...older]) => (
            <li key={p.id}>
              <ul>
                <TourItem title={p.title} question={p.title} active={p.number === active} tracing={false} disabled={false} meta={`#${p.number} · ${p.steps} steps · ${p.review} notes · free to replay`} onClick={() => go(p.number)} />
              </ul>
              {older.map((o) => (
                <button key={o.id} onClick={() => go(o.number, o.id)} className="ml-3 block py-1 font-mono text-[10.5px] text-fg-3 hover:text-fg">
                  earlier push · {o.headSha.slice(0, 7)} · {o.steps} steps
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-2 flex items-center gap-1.5 rounded-[10px] border border-line px-2 py-1 focus-within:border-trail/60">
        <GitPullRequest className="size-3.5 shrink-0 text-fg-3" aria-hidden />
        <label htmlFor="pr-input" className="sr-only">
          Tour a pull request: its number or link
        </label>
        <input
          id="pr-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="Tour a PR: #123 or link"
          aria-invalid={!!error}
          aria-describedby={error ? "pr-error" : undefined}
          className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12px] text-fg outline-none placeholder:text-fg-3"
        />
        <button type="submit" disabled={!value.trim()} className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-trail disabled:opacity-40">
          Open
        </button>
      </form>
      {error && (
        <p id="pr-error" className="mt-1 font-mono text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Open a tour from a link": a CodeTour file on GitHub or in a gist, checked against this commit and saved here. */
function TourLink({ onOpen, disabled }: { onOpen: (url: string) => Promise<string | null>; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={disabled} className="mt-1 font-mono text-[10.5px] text-fg-3 hover:text-fg hover:underline disabled:opacity-40">
        Open a tour from a link
      </button>
    );
  }
  return (
    <form
      className="mt-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const problem = await onOpen(url.trim());
        setBusy(false);
        if (problem) setError(problem);
        else {
          setUrl("");
          setOpen(false);
        }
      }}
    >
      <label htmlFor="tour-link" className="font-mono text-[10.5px] text-fg-3">
        Link to a .tour file on GitHub, or a raw gist
      </label>
      <div className="mt-1 flex gap-1.5">
        <input
          id="tour-link"
          autoFocus
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="https://github.com/owner/repo/blob/main/.tours/intro.tour"
          aria-invalid={!!error}
          aria-describedby={error ? "tour-link-error" : undefined}
          className="min-w-0 flex-1 rounded-[9px] border border-line bg-ink px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-fg-3 focus:border-trail/60"
        />
        <button type="submit" disabled={busy || !url.trim()} className="rounded-[9px] bg-trail px-2.5 font-mono text-[11px] font-semibold text-[#16171a] disabled:opacity-50">
          {busy ? "Opening…" : "Open"}
        </button>
      </div>
      {error && (
        <p id="tour-link-error" role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
      <p className="mt-1 text-[11px] text-fg-3">Its steps are checked against this commit. Free.</p>
    </form>
  );
}
