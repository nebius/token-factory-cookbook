"use client";

import { AlertTriangle, ArrowLeft, Link2, BarChart3, BookOpen, FileSearch, Keyboard, Loader2, Lock, Maximize2, Minimize2, MessageSquareText, MousePointerClick, PanelLeft, RotateCcw, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { Rich, RichContext, type RichLinks } from "@/components/rich";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInModal, UserMenu } from "@/components/user-menu";
import { formatUsd } from "@/lib/format";
import { groupsOf } from "@/lib/architecture";
import { plainLabel } from "@/lib/architecture";
import { architectureSpec, type LinkInfo } from "@/lib/diagram";
import type { TourMark } from "@/server/trail/service";
import { tourToCodeTour } from "@/lib/export-map";
import { promptFor, type PromptFocus } from "@/lib/prompt";
import { charKeysOn, shortcutAllowed } from "@/lib/keys";
import { announce, copyText } from "@/lib/announce";
import { markSeen, readSeen, resetSeen } from "@/lib/progress";
import { parseScope, scopeLabel } from "@/lib/scope";
import { SUPPORT } from "@/lib/palette";
import type { Atlas, CallRecord, PullIndexEntry, PullView, RepoSummary, Tour, TourIndexEntry } from "@/lib/schemas";
import { CodePanel } from "./code-panel";
import { CostDrawer, CostPill } from "./cost";
import { FileBrowser } from "./file-browser";
import { Narration, PlayerBar } from "./player";
import { PullHeader, PullStart, ReviewNotes, type PullLive } from "./pull-panel";
import { FilesDrawer, ReadCard, Reading, type LiveRead } from "./read-card";
import { Sidebar } from "./sidebar";
import { TrailGraph } from "./trail-graph";
import { Ember } from "./warmth";
import { Dialog, ShortcutsDialog, useModal } from "./dialog";
import { TranscriptDialog } from "./transcript";
import { TourEditor, type Draft, type DraftStep } from "./tour-editor";
import { AnswerView } from "@/components/answer/answer-view";
import { ThreadView } from "@/components/answer/thread-view";
import type { AskMode } from "@/lib/match";
import { LOCAL_OWNER } from "@/lib/ref";
import { answerFollowUps, answerTitle, type Thread, type ThreadIndexEntry, type ThreadTurn } from "@/lib/thread";
import { DocsView } from "@/components/docs/docs-view";
import type { Docs } from "@/lib/docs-schema";
import type { StoredAnswer } from "@/lib/answer-schema";
import type { ResearchStage } from "@/server/trail/research";

type Phase = "preparing" | "ready" | "reading" | "map" | "error";
const SPEEDS = [1, 1.5, 2];
const EMPTY_LIVE: LiveRead = { thinkingChars: 0, chars: 0, summary: null, nodes: [], edges: [], tours: [], steps: [] };

class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, body === undefined ? { signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status}).`, data.code);
  return data;
}

/** The repo, commit and folders a request is about. */
const at = (s: RepoSummary) => ({ owner: s.owner, repo: s.repo, sha: s.sha, ...(s.scope ? { scope: s.scope } : {}) });
const qs = (s: RepoSummary) => new URLSearchParams(at(s)).toString();

const needsSignIn = (e: unknown) => (e as { code?: string })?.code === "auth_required";
/** Stop was pressed: the fetch was aborted, or the server confirmed the run stopped. */
const wasStopped = (e: unknown) => (e as Error)?.name === "AbortError" || (e as { code?: string })?.code === "cancelled";

/** One paid action the visitor can stop: a random id the server knows it by, and the fetch's abort switch. */
type Run = { id: string; stop: AbortController };
const newRun = (): Run => ({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, stop: new AbortController() });

/** Something went wrong (or was stopped), with a way to try again. */
type Problem = { text: string; retry?: () => void; stopped?: boolean };

/** How long a step stays on screen while playing: longer narration, longer step. */
const dwell = (text: string, speed: number) => Math.min(9_000, Math.max(4_000, 2_000 + text.length * 28)) / speed;

/** Downloads a tour as a VS Code CodeTour file. */
function downloadCodeTour(tour: Tour, summary: RepoSummary, next?: string) {
  const blob = new Blob([JSON.stringify(tourToCodeTour(tour, summary, next), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${tour.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "tour"}.tour`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Reads an SSE response, handing each event to `on`; resolves with the "done" event. Error events throw ApiError. */
async function readEvents<T>(res: Response, on: (ev: { type: string } & Record<string, unknown>) => void): Promise<T> {
  if (!res.ok || !res.body) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Request failed.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, cut).split("\n").find((l) => l.startsWith("data: "));
      buffer = buffer.slice(cut + 2);
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "done") return ev as T;
      if (ev.type === "error") throw new ApiError(ev.error, ev.code);
      on(ev);
    }
  }
  throw new Error("The connection closed before the answer finished.");
}

/** The branch moved on since the read on screen. */
type Newer = { sha: string; branch: string; ahead: number | null };

type Props = { owner: string; repo: string; gitRef?: string; initialFile?: string; pull?: number; siteUrl: string; /** Folders to read, from ?only=&skip= (a scope string). */ scope?: string };
/** A follow-up continues a conversation, or starts one from a stored answer or tour. */
type ThreadStart = { thread?: string; root?: { kind: "answer" | "tour"; id: string } };

export function TrailApp({ owner, repo, gitRef, initialFile, pull, siteUrl, scope }: Props) {
  const [phase, setPhase] = useState<Phase>("preparing");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RepoSummary | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [tours, setTours] = useState<TourIndexEntry[]>([]);
  const [ledger, setLedger] = useState<CallRecord[]>([]);
  const [tour, setTour] = useState<Tour | null>(null);
  const [tourFromCache, setTourFromCache] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tracing, setTracing] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [selected, setSelected] = useState<{ id: string; kind: "module" | "file" } | null>(null);
  const [viewFile, setViewFile] = useState<{ path: string; line?: number; end?: number } | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [live, setLive] = useState<LiveRead | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [docs, setDocs] = useState<Docs | null>(null);
  const [dialog, setDialog] = useState<"shortcuts" | "transcript" | null>(null);
  const [docPage, setDocPage] = useState<string | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const [answers, setAnswers] = useState<{ id: string; question: string; title: string }[]>([]);
  const [answer, setAnswer] = useState<{ question: string; text: string; streaming: boolean; stored: StoredAnswer | null; fromCache: boolean; stage?: ResearchStage } | null>(null);
  const [pullView, setPullView] = useState<PullView | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pulls, setPulls] = useState<PullIndexEntry[]>([]);
  const [pullLive, setPullLive] = useState<PullLive | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threads, setThreads] = useState<ThreadIndexEntry[]>([]);
  const [newer, setNewer] = useState<Newer | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  // Modules opened into their files on the map (kept in the address as ?open=a,b).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(typeof window === "undefined" ? [] : (new URLSearchParams(window.location.search).get("open") ?? "").split(",").filter(Boolean)));
  // A clicked link on the map (or picked from a module's panel), with the import lines behind it.
  const [evidence, setEvidence] = useState<LinkInfo | null>(null);
  // Where stored tours stop in the code, for the code panel's markers.
  const [marks, setMarks] = useState<TourMark[]>([]);
  // The file shown in the map's Calls view.
  const [callsFile, setCallsFile] = useState<string | null>(null);
  // A tour being written or edited by hand.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Tour steps seen in this browser, per commit.
  const [seen, setSeen] = useState<Record<string, number[]>>({});
  const [mapBig, setMapBig] = useState(false);
  const started = useRef(false);
  const running = useRef<Run | null>(null);
  // Where each tour was left, so going back to it resumes there.
  const stepOf = useRef(new Map<string, number>());
  const side = useRef<HTMLElement>(null);
  const closeSide = useCallback(() => setSideOpen(false), []);
  useModal(side, closeSide, sideOpen);

  /** Starts a paid action that Stop can cancel. */
  const startRun = useCallback(() => (running.current = newRun()), []);
  const endRun = useCallback((r: Run) => {
    if (running.current === r) running.current = null;
  }, []);
  /** Stop: tell the server (so the model call ends if no one else is waiting on it), then stop waiting here. */
  function stopRun() {
    const r = running.current;
    if (!r) return;
    running.current = null;
    fetch("/api/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: r.id }) }).catch(() => {});
    r.stop.abort();
  }
  /** Shows what went wrong, with Retry when there's something to retry. */
  const fail = useCallback((e: unknown, retry?: () => void) => {
    if (needsSignIn(e)) return setSignIn(true);
    const stopped = wasStopped(e);
    setProblem({ text: stopped ? "Stopped. Whatever the model had already read may still be billed." : (e as Error).message, retry, stopped });
  }, []);

  const openTour = useCallback(
    async (id: string, at = 0, s?: RepoSummary) => {
      const sum = s ?? summary;
      if (!sum) return;
      try {
        const { tour: t } = await api<{ tour: Tour }>(`/api/tour?${qs(sum)}&id=${id}`);
        setTour(t);
        setAnswer(null);
        setDocPage(null);
        setTourFromCache(true);
        setStep(Math.min(Math.max(0, at), t.steps.length - 1));
        setSelected(null);
        setViewFile(null);
      } catch (e) {
        fail(e);
      }
    },
    [summary, fail],
  );

  /** A conversation was started or continued: show it and keep the sidebar's list in step. */
  const keepThread = useCallback((t: Thread | undefined) => {
    if (!t) return setThread(null);
    setThread(t);
    setThreads((list) => [...list.filter((x) => x.id !== t.id), { id: t.id, title: t.turns[0].title, turns: t.turns.length, at: t.at }]);
  }, []);

  const trace = useCallback(
    async (question: string, s?: RepoSummary, start?: ThreadStart): Promise<boolean> => {
      const sum = s ?? summary;
      if (!sum || tracing) return false;
      setTracing(question);
      setProblem(null);
      setPlaying(false);
      const run = startRun();
      try {
        const r = await api<{ tour: Tour; fromCache: boolean; ledger: CallRecord[]; thread?: Thread }>(
          "/api/tour",
          { ...at(sum), question, ...start, runId: run.id },
          run.stop.signal,
        );
        setTour(r.tour);
        setAnswer(null);
        setDocPage(null);
        setTourFromCache(r.fromCache);
        announce(`Tour ready: ${r.tour.title}, ${r.tour.steps.length} steps.`);
        setLedger(r.ledger);
        keepThread(r.thread);
        // Tours inside a conversation belong to it, not to the repo's list.
        if (!r.thread)
          setTours((list) => [
            ...list.filter((t) => t.id !== r.tour.id),
            { id: r.tour.id, title: r.tour.title, question: r.tour.question, steps: r.tour.steps.length, cost: r.tour.calls[0]?.cost ?? null, at: Date.now() },
          ]);
        setStep(0);
        setSelected(null);
        setViewFile(null);
        setPlaying(true);
        return true;
      } catch (e) {
        fail(e, () => void trace(question, sum, start));
        return false;
      } finally {
        endRun(run);
        setTracing(null);
      }
    },
    [summary, tracing, keepThread, startRun, endRun, fail],
  );

  // Load what's known about the repo (free: GitHub + import graph + anything stored).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const r = await api<{
          summary: RepoSummary;
          atlas: Atlas | null;
          tours: TourIndexEntry[];
          ledger: CallRecord[];
          answers?: { id: string; question: string; title: string }[];
          docs?: Docs | null;
          pulls?: PullIndexEntry[];
          threads?: ThreadIndexEntry[];
          pull?: PullView | null;
          pullError?: string | null;
          newer?: Newer | null;
        }>("/api/prepare", { input: `${owner}/${repo}${gitRef ? `@${gitRef}` : ""}`, pull, scope });
        setSummary(r.summary);
        setPulls(r.pulls ?? []);
        setThreads(r.threads ?? []);
        setNewer(r.newer ?? null);
        setPullView(r.pull ?? null);
        setPullError(r.pullError ?? null);
        setTours(r.tours);
        setLedger(r.ledger);
        setAnswers(r.answers ?? []);
        setDocs(r.docs ?? null);
        if (!r.atlas) {
          setPhase("ready");
          return;
        }
        setAtlas(r.atlas);
        setPhase("map");
        // A GitHub file link (…/blob/<ref>/<path>#L10-L20) opens that file at those lines.
        if (initialFile) {
          const m = window.location.hash.match(/^#L(\d+)/);
          setViewFile({ path: initialFile, line: m ? Number(m[1]) : undefined });
          setSelected({ id: initialFile, kind: "file" });
          setBrowse(true);
          return;
        }
        if (await showFromUrl(r.summary, r.docs ?? null)) return;
        const want = pull ? r.pull?.tourId : null;
        const first = r.atlas.tours.map((t) => r.tours.find((x) => x.question.toLowerCase() === t.question.toLowerCase())).find(Boolean) ?? r.tours[0];
        if (want) await openTour(want, 0, r.summary);
        // On a PR page with no tour yet, the PR panel waits for "Tour this PR" instead of a repo tour.
        else if (first && !pull) await openTour(first.id, 0, r.summary);
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    })();
  }, [owner, repo, gitRef, initialFile, pull, scope, openTour, showFromUrl]);

  /** A pull-request tour: the change on top of the cached repo, streamed so its steps appear as they're written. */
  async function tourPull() {
    if (!summary || !pullView || tracing) return;
    setPlaying(false);
    setAnswer(null);
    setDocPage(null);
    setSelected(null);
    setViewFile(null);
    setProblem(null);
    setTour(null);
    setTracing(`PR #${pullView.facts.number}`);
    setPullLive({ thinkingChars: 0, title: null, steps: [] });
    const run = startRun();
    try {
      const res = await fetch("/api/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...at(summary), number: pullView.facts.number, runId: run.id }),
        signal: run.stop.signal,
      });
      const done = await readEvents<{ tour: Tour; fromCache: boolean; ledger: CallRecord[]; pulls: PullIndexEntry[] }>(res, (ev) => {
        if (ev.type === "thinking") setPullLive((l) => ({ ...(l ?? { title: null, steps: [] }), thinkingChars: ev.chars as number }));
        else if (ev.type === "partial") setPullLive((l) => ({ thinkingChars: l?.thinkingChars ?? 0, title: (ev.title as string | null) ?? null, steps: ev.steps as string[] }));
      });
      setTour(done.tour);
      setTourFromCache(done.fromCache);
      setLedger(done.ledger);
      setPulls(done.pulls);
      setPullView((v) => (v ? { ...v, tourId: done.tour.id } : v));
      setStep(0);
      setPlaying(true);
    } catch (e) {
      fail(e, () => void tourPull());
    } finally {
      endRun(run);
      setTracing(null);
      setPullLive(null);
    }
  }

  /** What's in focus, with the architecture, as a prompt to paste into any AI chat. */
  const copyPrompt = (focus: PromptFocus) => atlas && summary && void copyText(promptFor(atlas, summary, focus, summary), "Prompt copied. Paste it into any AI chat");

  /** Opens the docs, writing them first (one call on the cached repo) if this commit has none yet. */
  async function openDocs(node?: string) {
    if (!summary) return;
    if (docs) {
      setPlaying(false);
      setAnswer(null);
      setViewFile(null);
      setDocPage(node ?? docPage ?? docs.pages[0]?.node ?? null);
      setSelected(null);
      return;
    }
    // Writing them is a paid call: not while another one runs.
    if (tracing) return;
    setPlaying(false);
    setDocsBusy(true);
    setTracing("Writing the docs, one page per module (usually under a minute)");
    setProblem(null);
    const run = startRun();
    try {
      const r = await api<{ docs: Docs; ledger: CallRecord[] }>("/api/docs", { ...at(summary), runId: run.id }, run.stop.signal);
      setAnswer(null);
      setViewFile(null);
      setDocs(r.docs);
      setLedger(r.ledger);
      setDocPage(node ?? r.docs.pages[0]?.node ?? null);
      announce(`Docs written: ${r.docs.pages.length} pages.`);
      setSelected(null);
    } catch (e) {
      fail(e, () => void openDocs(node));
    } finally {
      endRun(run);
      setDocsBusy(false);
      setTracing(null);
    }
  }

  /** Names the layers of a map read before reads did, so it draws as a layered architecture diagram. */
  async function groupLayers() {
    if (!summary || tracing) return;
    setProblem(null);
    setTracing("Grouping the map into layers");
    const run = startRun();
    try {
      const r = await api<{ atlas: Atlas; ledger: CallRecord[] }>("/api/layers", { ...at(summary), runId: run.id }, run.stop.signal);
      setAtlas(r.atlas);
      setLedger(r.ledger);
    } catch (e) {
      fail(e, () => void groupLayers());
    } finally {
      endRun(run);
      setTracing(null);
    }
  }

  /** A generative-UI answer, streamed so it renders as DeepSeek writes it. */
  async function askAnswer(question: string, mode: "answer" | "thorough" | "research" = "answer", start?: ThreadStart): Promise<boolean> {
    if (!summary || tracing) return false;
    setPlaying(false);
    setSelected(null);
    setViewFile(null);
    setProblem(null);
    setTracing(question);
    setDocPage(null);
    setAnswer({ question, text: "", streaming: true, stored: null, fromCache: false });
    const run = startRun();
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...at(summary), question, mode, ...start, runId: run.id }),
        signal: run.stop.signal,
      });
      const ev = await readEvents<{ answer: StoredAnswer; fromCache: boolean; ledger: CallRecord[]; thread?: Thread }>(res, (e) => {
        if (e.type === "text") setAnswer((a) => (a ? { ...a, text: e.text as string } : a));
        // Research: each stage shows (and is announced) as it starts.
        if (e.type === "stage") {
          const stage = e as unknown as ResearchStage;
          setAnswer((a) => (a ? { ...a, stage } : a));
          announce(stage.stage === "plan" ? "Planning the research." : stage.stage === "round" ? `Research round ${stage.n}.` : "Writing the answer.");
        }
      });
      const stored = ev.answer;
      setAnswer({ question: stored.question, text: stored.text, streaming: false, stored, fromCache: ev.fromCache });
      setLedger(ev.ledger);
      keepThread(ev.thread);
      announce(`Answer ready: ${answerTitle(stored.text) ?? stored.question}.`);
      if (!ev.thread) setAnswers((list) => [...list.filter((x) => x.id !== stored.id), { id: stored.id, question: stored.question, title: answerTitle(stored.text) ?? stored.question }]);
      return true;
    } catch (e) {
      setAnswer(null);
      fail(e, () => void askAnswer(question, mode, start));
      return false;
    } finally {
      endRun(run);
      setTracing(null);
    }
  }

  async function openAnswer(id: string, s?: RepoSummary) {
    const sum = s ?? summary;
    if (!sum) return;
    try {
      const { answer: stored } = await api<{ answer: StoredAnswer }>(`/api/ask?${qs(sum)}&id=${id}`);
      setPlaying(false);
      setSelected(null);
      setViewFile(null);
      setDocPage(null);
      setAnswer({ question: stored.question, text: stored.text, streaming: false, stored, fromCache: true });
    } catch (e) {
      fail(e);
    }
  }

  /** Opens one turn of a conversation: its stored answer or tour. */
  function openTurn(t: ThreadTurn, s?: RepoSummary) {
    return t.kind === "answer" ? openAnswer(t.refId, s) : openTour(t.refId, 0, s);
  }

  /** A stored conversation, at the turn asked for (the last one by default). Free. */
  async function openThread(id: string, turn = -1, s?: RepoSummary) {
    const sum = s ?? summary;
    if (!sum) return;
    try {
      const { thread: t } = await api<{ thread: Thread }>(`/api/thread?${qs(sum)}&id=${id}`);
      setThread(t);
      await openTurn(t.turns[turn >= 0 && turn < t.turns.length ? turn : t.turns.length - 1], sum);
    } catch (e) {
      fail(e);
    }
  }

  /**
   * Shows what the address names: a conversation turn, an answer, a docs page, a file, or a tour step. Used on load
   * and when Back or Forward changes the address. False when it names nothing.
   */
  async function showFromUrl(sum: RepoSummary, docsNow: Docs | null): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const thread = params.get("thread");
    if (thread) return await openThread(thread, Number(params.get("turn") ?? 0) - 1, sum).then(() => true);
    const answerId = params.get("answer");
    if (answerId) return await openAnswer(answerId, sum).then(() => true);
    const doc = params.get("doc");
    if (doc && docsNow?.pages.some((pg) => pg.node === doc)) {
      setAnswer(null);
      setSelected(null);
      setViewFile(null);
      setPlaying(false);
      setDocPage(doc);
      return true;
    }
    const file = params.get("file");
    if (file) {
      const line = Number(params.get("line")) || undefined;
      setViewFile({ path: file, line });
      setSelected({ id: file, kind: "file" });
      setPlaying(false);
      return true;
    }
    const tourId = params.get("tour");
    if (tourId) {
      setAnswer(null);
      setDocPage(null);
      setSelected(null);
      await openTour(tourId, Number(params.get("step") ?? 1) - 1, sum);
      return true;
    }
    return false;
  }

  /** New questions from the sidebar start fresh; Tour or Answer as picked. */
  function ask(question: string, mode: AskMode): Promise<boolean> {
    setThread(null);
    setSideOpen(false);
    return mode === "tour" ? trace(question) : askAnswer(question, mode);
  }

  /** A follow-up to what's on screen: continues its conversation, or starts one from it. */
  function followUp(question: string, mode: AskMode): Promise<boolean> {
    const rootRef = answer?.stored ? { kind: "answer" as const, id: answer.stored.id } : tour ? { kind: "tour" as const, id: tour.id } : null;
    const start: ThreadStart | undefined = thread ? { thread: thread.id } : rootRef ? { root: rootRef } : undefined;
    if (!start) return Promise.resolve(false);
    return mode === "tour" ? trace(question, undefined, start) : askAnswer(question, mode, start);
  }

  /** Leaving a conversation: opening something that isn't one of its turns. */
  const leaveThreadUnless = (id: string) => {
    if (!thread?.turns.some((t) => t.refId === id)) setThread(null);
  };

  /** The first read, streamed so the map builds live; falls back to the plain request if streaming fails. */
  async function readStream(sum: RepoSummary, run: Run): Promise<{ atlas: Atlas; ledger: CallRecord[]; tours: TourIndexEntry[]; summary: RepoSummary }> {
    const res = await fetch("/api/atlas/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...at(sum), runId: run.id }),
      signal: run.stop.signal,
    });
    if (!res.ok || !res.body) throw new Error("stream unavailable");
    // An error the server reported is final; a dropped connection falls back to the plain request.
    return readEvents<{ atlas: Atlas; ledger: CallRecord[]; tours: TourIndexEntry[]; summary: RepoSummary }>(res, (ev) => {
      if (ev.type === "thinking") setLive((l) => ({ ...(l ?? EMPTY_LIVE), thinkingChars: ev.chars as number }));
      else if (ev.type === "partial") setLive((l) => ({ ...(l ?? EMPTY_LIVE), ...(ev as unknown as Omit<LiveRead, "thinkingChars">) }));
    }).catch((e: Error) => {
      throw Object.assign(e, { fatal: e instanceof ApiError || wasStopped(e) });
    });
  }

  async function read() {
    if (!summary) return;
    setPhase("reading");
    setProblem(null);
    setLive(EMPTY_LIVE);
    const run = startRun();
    try {
      const r = await readStream(summary, run).catch((e: Error & { fatal?: boolean }) => {
        if (e.fatal) throw e;
        return api<{ atlas: Atlas; ledger: CallRecord[]; tours: TourIndexEntry[]; summary: RepoSummary }>(
          "/api/atlas",
          { ...at(summary), runId: run.id },
          run.stop.signal,
        );
      });
      endRun(run);
      setAtlas(r.atlas);
      setLedger(r.ledger);
      setTours(r.tours);
      setSummary(r.summary);
      setPhase("map");
      // On a PR page the PR panel comes next; elsewhere the read already traced the main flow.
      if (pull) return;
      const main = r.atlas.tours[0];
      const saved = main && r.tours.find((t) => t.question.toLowerCase() === main.question.toLowerCase());
      if (saved) {
        await openTour(saved.id, 0, r.summary);
        setTourFromCache(false);
        setPlaying(true);
      } else if (main) {
        trace(main.question, r.summary);
      }
    } catch (e) {
      endRun(run);
      if (needsSignIn(e) || wasStopped(e)) {
        setPhase("ready");
        fail(e, () => void read());
        return;
      }
      setError((e as Error).message);
      setPhase("error");
    }
  }

  // Shareable address for what's on screen: ?thread=<id>&turn=<n> in a conversation, ?answer=<id> for an answer,
  // ?doc=<module> for a docs page, ?file=<path>&line=<n> for a file, ?tour=<id>&step=<n> for a tour, and
  // /owner/repo/pull/<n>?step=<n> for a PR's tour. Opening something new adds a history entry (so Back returns to
  // what was there); moving between steps only updates the address.
  const shownKey = useRef<string | null>(null);
  const restoring = useRef(false);
  const docShown = docs && docPage && !selected ? docPage : null;
  const fileShown = selected?.kind === "file" ? selected.id : null;
  useEffect(() => {
    if (!summary || phase !== "map") return;
    const url = new URL(window.location.href);
    for (const k of ["thread", "turn", "answer", "tour", "step", "doc", "file", "line", "open"]) url.searchParams.delete(k);
    if (expanded.size) url.searchParams.set("open", [...expanded].join(","));
    if (pull) url.pathname = tour && !tour.pull ? `/${owner}/${repo}` : `/${owner}/${repo}/pull/${pull}`;
    const shownRef = answer ? (answer.stored?.id ?? null) : (tour?.id ?? null);
    const turn = thread && shownRef ? thread.turns.findIndex((t) => t.refId === shownRef) : -1;
    if (fileShown) {
      url.searchParams.set("file", fileShown);
      if (viewFile?.line) url.searchParams.set("line", String(viewFile.line));
    } else if (docShown) {
      url.searchParams.set("doc", docShown);
    } else if (thread && turn >= 0) {
      url.searchParams.set("thread", thread.id);
      url.searchParams.set("turn", String(turn + 1));
    } else if (answer?.stored) {
      url.searchParams.set("answer", answer.stored.id);
    } else if (tour && !answer) {
      if (!(tour.pull && pull && tour.id === pullView?.tourId)) url.searchParams.set("tour", tour.id);
      url.searchParams.set("step", String(step + 1));
    }
    const key = `${url.pathname}?${[...url.searchParams].filter(([k]) => k !== "step" && k !== "line" && k !== "open").join("&")}`;
    const fresh = shownKey.current !== null && shownKey.current !== key && !restoring.current;
    if (fresh) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    shownKey.current = key;
    restoring.current = false;
  }, [tour, step, summary, phase, pull, pullView?.tourId, owner, repo, thread, answer, docShown, fileShown, viewFile?.line, expanded]);

  // Back and Forward: show what the address now names.
  const fromUrl = useRef(showFromUrl);
  fromUrl.current = showFromUrl;
  useEffect(() => {
    const onPop = () => {
      if (!summary) return;
      restoring.current = true;
      void fromUrl.current(summary, docs);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [summary, docs]);

  // Tour markers, refreshed when a tour is added.
  useEffect(() => {
    if (!summary || phase !== "map") return;
    let live = true;
    fetch(`/api/tours/steps?${qs(summary)}`)
      .then((r) => (r.ok ? r.json() : { marks: [] }))
      .then((d: { marks: TourMark[] }) => live && setMarks(d.marks))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [summary, phase, tours.length]);

  // Tours of the repo's earlier read that could come along (reads made before tours were carried automatically).
  const [carry, setCarry] = useState<{ from: string; count: number } | null>(null);
  useEffect(() => {
    if (!summary || phase !== "map") return;
    let live = true;
    fetch(`/api/tour/carry?${qs(summary)}`)
      .then((r) => (r.ok ? r.json() : { carry: null }))
      .then((d: { carry: { from: string; count: number } | null }) => live && setCarry(d.carry))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [summary, phase, tours.length]);

  // Remember where each tour was left, and tick the step as seen.
  const seenKey = summary ? `${summary.owner}/${summary.repo}@${summary.sha}${summary.scope ? `~${summary.scope}` : ""}` : null;
  useEffect(() => {
    if (seenKey) setSeen(readSeen(seenKey));
  }, [seenKey]);
  useEffect(() => {
    if (!tour) return;
    stepOf.current.set(tour.id, step);
    if (seenKey && !answer && !docPage) setSeen((s) => markSeen(seenKey, s, tour.id, step));
  }, [tour, step, seenKey, answer, docPage]);

  // Autoplay.
  useEffect(() => {
    if (!playing || !tour) return;
    if (step >= tour.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), dwell(tour.steps[step].narration, speed));
    return () => clearTimeout(t);
  }, [playing, tour, step, speed]);

  // Keyboard: ← → to step and space to play/pause while a tour is on screen, / to search files, ? for shortcuts,
  // T for the tour as text. Never while typing, with a dialog open, or for a key the focused control uses itself.
  const tourOnScreen = !!tour && !answer && !docShown && !selected && !draft;
  const modalOpen = !!dialog || costOpen || filesOpen || cardOpen || signIn || sideOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes an open module or file panel (dialogs and the docs handle their own).
      if (e.key === "Escape" && !modalOpen && (selected || evidence) && !(e.target as HTMLElement | null)?.closest("input, textarea")) {
        setSelected(null);
        setEvidence(null);
        setViewFile(null);
        return;
      }
      if (!shortcutAllowed(e.key, e.target as HTMLElement | null, modalOpen)) return;
      // Single-character shortcuts can be switched off in the shortcuts dialog (WCAG 2.1.4).
      if (["/", "?", "t", "T", "f", "F"].includes(e.key) && !charKeysOn()) return;
      if ((e.key === "f" || e.key === "F") && document.getElementById("map-find")) {
        e.preventDefault();
        document.getElementById("map-find")!.focus();
        return;
      }
      if (e.key === "/" && summary && atlas) {
        e.preventDefault();
        setBrowse(true);
        return;
      }
      if (e.key === "?") return setDialog("shortcuts");
      if (!tour || !tourOnScreen) return;
      if (e.key === "t" || e.key === "T") return setDialog("transcript");
      if (e.key === "ArrowRight") setStep((s) => Math.min(tour.steps.length - 1, s + 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
      if (e.key !== " ") setPlaying(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, summary, atlas, tourOnScreen, modalOpen, selected, evidence]);

  const current = tour?.steps[step];
  // Links inside a tour's text: [#3] to a step, [Tour title#2] to another tour, a backticked path to its file.
  const repoFiles = useMemo(() => new Set(summary ? [...summary.fileSizes.map(([p]) => p), ...(summary.otherFiles ?? []).map(([p]) => p)] : []), [summary]);
  const richLinks: RichLinks = {
    steps: tour?.steps.length,
    onStep: (i) => (setPlaying(false), setViewFile(null), setStep(i)),
    tours,
    onTour: (id, at) => (setThread(null), void openTour(id, at)),
    files: repoFiles,
    onFile: (path, line) => setViewFile({ path, line }),
  };

  const header = (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {phase === "map" && (
          <button onClick={() => setSideOpen(true)} aria-label="Tours, questions and docs" title="Tours, questions and docs" className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line bg-panel text-fg-2 hover:text-fg lg:hidden">
            <PanelLeft className="size-4" />
          </button>
        )}
        <Logo compact />
        <span className="truncate font-mono text-[13px] text-fg-2">
          {owner === LOCAL_OWNER ? "this machine" : owner} / <span className="text-fg">{repo}</span>
          {summary && <span className="ml-2 text-fg-3">@{summary.sha.slice(0, 7)}</span>}
          {summary?.scope && (
            <a href={`/${owner}/${repo}`} title="This read covers only some folders. Click for the whole repo." className="ml-2 rounded-md border border-trail/40 px-1.5 py-0.5 align-middle text-[11px] text-trail hover:border-trail">
              {scopeLabel(parseScope(summary.scope))}
            </a>
          )}
          {summary?.private && (
            <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-fg-3" title="Private: stored only on this instance">
              <Lock className="size-3" /> private
            </span>
          )}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {summary && ledger.length > 0 && (
          <span className="hidden md:inline">
            <Ember ledger={ledger} summary={summary} />
          </span>
        )}
        {summary && (
          <>
            <button
              onClick={() => (atlas ? setBrowse((b) => !b) : setFilesOpen(true))}
              aria-pressed={atlas ? browse : undefined}
              title={atlas ? "Browse and search every file in this commit" : "See what will be read"}
              className="hidden items-center gap-1.5 rounded-[10px] border border-line bg-panel px-3 py-1.5 text-[12.5px] text-fg-2 hover:border-outline hover:text-fg sm:inline-flex"
            >
              <FileSearch className="size-3.5" /> {summary.files.read} {atlas ? "files read" : "files to read"}
            </button>
            <CostPill ledger={ledger} summary={summary} onOpen={() => setCostOpen(true)} />
          </>
        )}
        <a href="/data" title="Every repo read on this instance, with its spend" className="hidden items-center gap-1.5 rounded-[10px] border border-line bg-panel px-3 py-1.5 text-[12.5px] text-fg-2 hover:border-outline hover:text-fg md:inline-flex">
          <BarChart3 className="size-3.5" /> Data
        </a>
        <button onClick={() => setDialog("shortcuts")} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" className="hidden size-9 place-items-center rounded-[10px] border border-line bg-panel text-fg-2 hover:text-fg sm:grid">
          <Keyboard className="size-4" />
        </button>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );

  const drawers = summary && (
    <>
      <CostDrawer open={costOpen} onClose={() => setCostOpen(false)} ledger={ledger} summary={summary} />
      <FilesDrawer open={filesOpen} onClose={() => setFilesOpen(false)} summary={summary} />
    </>
  );

  if (phase !== "map" || !atlas || !summary) {
    return (
      <div className="flex min-h-dvh flex-col bg-ink">
        {header}
        <main id="main" className="dot-grid flex flex-1 items-start justify-center px-4 py-10 sm:py-14">
          {(phase === "preparing" || phase === "error") && <h1 className="sr-only">{owner === LOCAL_OWNER ? repo : `${owner}/${repo}`}</h1>}
          {phase === "preparing" && (
            <div className="mt-24 flex flex-col items-center gap-3 text-center">
              <Loader2 className="size-6 animate-spin text-trail" />
              <p className="font-mono text-[12px] tracking-[0.15em] text-fg-2 uppercase">Fetching the commit · mapping imports</p>
              <p className="text-xs text-fg-3">No model yet: this part is free.</p>
            </div>
          )}
          {phase === "ready" && summary && (
            <div className="flex w-full flex-col items-center gap-4">
              {pull && (pullView || pullError) && (
                <div className="w-full max-w-[720px] rounded-card border border-line bg-panel p-4">
                  {pullView ? <PullHeader facts={pullView.facts} /> : <p className="text-sm text-danger">{pullError}</p>}
                  <p className="mt-2 text-[13px] text-fg-3">Codetrail reads the whole repo once first (that also maps it). The PR tour then runs on top of that read, mostly from cache.</p>
                </div>
              )}
              {problem && <ProblemNote problem={problem} onDismiss={() => setProblem(null)} />}
              <ReadCard summary={summary} onRead={read} />
            </div>
          )}
          {phase === "reading" && summary && <Reading summary={summary} label="Reading the whole repository" live={live} onStop={stopRun} />}
          {phase === "error" && (
            <div className="mt-20 max-w-md rounded-card border border-danger/40 bg-panel p-6 text-center">
              <AlertTriangle className="mx-auto size-6 text-danger" />
              <p className="mt-3 text-sm text-fg">{error}</p>
              <button onClick={() => window.location.reload()} className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg-2 hover:text-fg">
                <RotateCcw className="size-3.5" /> Try again
              </button>
            </div>
          )}
        </main>
        {drawers}
        {signIn && <SignInModal onClose={() => setSignIn(false)} />}
      </div>
    );
  }

  const selectedModule = selected?.kind === "module" ? atlas.nodes.find((n) => n.id === selected.id) : undefined;
  const moduleColor = groupsOf(atlas.nodes).color;
  // What closing a file goes back to.
  const under = docShown ? "the docs page" : answer ? "the answer" : tour ? "the tour" : null;
  // From the last step: the next suggested tour not finished yet (free when stored), else the next one asked here.
  const tourOrder = (() => {
    if (!tour || tour.pull) return null;
    const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");
    const stored = new Map(tours.map((t) => [norm(t.question), t]));
    const order = [...atlas.tours.map((t) => ({ title: t.title, question: t.question, saved: stored.get(norm(t.question)) })), ...tours.filter((t) => !atlas.tours.some((a) => norm(a.question) === norm(t.question))).map((t) => ({ title: t.title, question: t.question, saved: t }))];
    return { order, at: order.findIndex((o) => o.saved?.id === tour.id || norm(o.question) === norm(tour.question)) };
  })();
  // From the first step: the saved tour just before this one, so a series reads both ways.
  const prevTour = (() => {
    const before = tourOrder && tourOrder.at > 0 ? tourOrder.order.slice(0, tourOrder.at).reverse().find((o) => o.saved && o.saved.id !== tour?.id)?.saved : undefined;
    return before && before.id !== tour?.id ? { title: before.title, run: () => (setThread(null), void openTour(before.id, 0)) } : null;
  })();
  const nextTour = (() => {
    if (!tour || !tourOrder) return null;
    const { order, at } = tourOrder;
    const rest = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].filter((o) => o.saved?.id !== tour.id);
    const pick = rest.find((o) => !o.saved || new Set(seen[o.saved.id] ?? []).size < o.saved.steps) ?? rest[0];
    if (!pick) return null;
    return {
      title: pick.title,
      meta: pick.saved ? `${pick.saved.steps} steps · free` : `≈ ${formatUsd(summary.estimate.followUp)}`,
      run: () => {
        setThread(null);
        if (pick.saved) void openTour(pick.saved.id, 0);
        else void trace(pick.question);
      },
    };
  })();
  /** From a sidebar pick on a phone: the drawer closes so what was picked is visible. */
  const picked = <A extends unknown[]>(f: (...a: A) => unknown) => (...a: A) => {
    setSideOpen(false);
    f(...a);
  };
/** Opening something else while writing a tour: asks first, then leaves the editor. */
const leaving = <A extends unknown[]>(f: (...a: A) => unknown) =>
  picked((...a: A) => {
    if (draft?.steps.length && !window.confirm("Leave the tour you're writing? It hasn't been saved.")) return;
    setDraft(null);
    f(...a);
  });
  const codePath = viewFile?.path ?? (answer || docPage ? undefined : current?.file);
  // In a PR tour, changed files open at the PR's head with their changes marked.
  const changedFile = codePath && tour?.pull ? tour.pull.files.find((f) => f.path === codePath && f.status !== "removed") : undefined;
  const highlight = viewFile ? (viewFile.line ? { start: viewFile.line, end: viewFile.end ?? viewFile.line } : {}) : { start: current?.startLine, end: current?.endLine };

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {header}
      {newer && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-4 py-1.5 font-mono text-[11.5px] text-fg-2">
          <span>
            Read at {summary.sha.slice(0, 7)} · {newer.ahead ? `${newer.ahead.toLocaleString()} ${newer.ahead === 1 ? "commit" : "commits"}` : "newer commits"} since, on {newer.branch}
          </span>
          <a href={`/${owner}/${repo}/tree/${newer.sha}`} className="text-trail hover:underline">
            Read the latest{summary.estimate.firstRead !== null ? ` · ≈ ${formatUsd(summary.estimate.firstRead)}` : ""}
          </a>
        </p>
      )}
      <main id="main" className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[290px_minmax(0,1fr)_minmax(400px,0.9fr)]">
        <h1 className="sr-only">{owner === LOCAL_OWNER ? repo : `${owner}/${repo}`}: map, tours and code</h1>
        {/* The map holds many tab stops: this jumps straight to the step and its code. */}
        <a href="#step" className="sr-only z-50 rounded-md bg-trail px-3 py-2 font-mono text-sm text-[#16171a] focus:not-sr-only focus:fixed focus:top-16 focus:left-3">
          Skip to the step and code
        </a>
        {sideOpen && <button aria-label="Close" tabIndex={-1} onClick={closeSide} className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] lg:hidden" />}
        {/* A column on desktop; on phones and tablets a drawer opened from the header. */}
        <aside
          ref={side}
          aria-label="Repository and tours"
          tabIndex={-1}
          {...(sideOpen ? { role: "dialog", "aria-modal": true } : {})}
          className={`outline-none lg:relative lg:order-1 lg:block lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-line ${sideOpen ? "fixed inset-y-0 left-0 z-50 w-[min(340px,88vw)] overflow-y-auto border-r border-line bg-ink" : "hidden"}`}
        >
          <div className="flex justify-end px-3 pt-3 lg:hidden">
            <button onClick={closeSide} aria-label="Close" className="rounded p-1.5 text-fg-3 hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          <Sidebar
            summary={summary}
            atlas={atlas}
            tours={tours}
            ledger={ledger}
            activeTourId={tour?.id ?? null}
            tracing={tracing}
            onOpenTour={leaving((id: string) => {
              leaveThreadUnless(id);
              setPlaying(false);
              setDocPage(null);
              setSelected(null);
              // Back to a tour already seen: where it was left, not playing.
              void openTour(id, stepOf.current.get(id) ?? 0);
            })}
            onTrace={leaving((q: string) => {
              setThread(null);
              void trace(q);
            })}
            answers={answers}
            activeAnswerId={answer?.stored?.id ?? null}
            onOpenAnswer={leaving((id: string) => {
              leaveThreadUnless(id);
              void openAnswer(id);
            })}
            onAsk={ask}
            docsPages={docs?.pages ?? null}
            docsBusy={docsBusy}
            onDocs={leaving((node?: string) => void openDocs(node))}
            pulls={pulls}
            activePull={tour?.pull?.number ?? null}
            threads={threads}
            activeThreadId={thread?.id ?? null}
            onOpenThread={leaving((id: string) => void openThread(id))}
            seen={seen}
            onTourUrl={async (url) => {
              try {
                const r = await api<{ tour: Tour; tours: TourIndexEntry[] }>("/api/tour/url", { ...at(summary), url });
                setTours(r.tours);
                setThread(null);
                setViewFile(null);
                setSelected(null);
                setTour(r.tour);
                setTourFromCache(true);
                setStep(0);
                setSideOpen(false);
                announce(`Tour opened: ${r.tour.title}, ${r.tour.steps.length} steps.`);
                return null;
              } catch (e) {
                if (needsSignIn(e)) setSignIn(true);
                return (e as Error).message;
              }
            }}
            carry={carry}
            onCarry={async () => {
              try {
                const r = await api<{ carried: { from: string; count: number } | null; tours: TourIndexEntry[] }>("/api/tour/carry", at(summary));
                setTours(r.tours);
                setCarry(null);
                announce(r.carried ? `${r.carried.count} ${r.carried.count === 1 ? "tour" : "tours"} brought over and checked against this commit.` : "No tours to bring over.");
              } catch (e) {
                announce((e as Error).message);
              }
            }}
            onResetProgress={() => {
              if (!seenKey) return;
              setSeen(resetSeen(seenKey));
              announce("Tour progress cleared.");
            }}
            onWrite={picked(() => {
              if (draft?.steps.length && !window.confirm("Start a new tour? The one you're writing will be discarded.")) return;
              setPlaying(false);
              setDraftError(null);
              setDraft({ title: "", summary: "", steps: [] });
            })}
          />
        </aside>

        <p className="sr-only" aria-live="polite">
          {tour && current ? `Step ${step + 1} of ${tour.steps.length}: ${current.title}.${current.file ? ` ${current.file}, lines ${current.startLine} to ${current.endLine}.` : ""}` : ""}
        </p>
        <section aria-label="Map of the repository" className={`relative order-2 border-t border-line lg:order-2 lg:h-auto lg:min-h-0 lg:border-t-0 ${mapBig ? "h-[78vh]" : "h-[42vh]"}`}>
          <TrailGraph
            atlas={atlas}
            summary={summary}
            tour={tour}
            step={step}
            selected={selected?.id ?? null}
            onGroupLayers={groupLayers}
            siteUrl={siteUrl}
            toolbarExtra={
              <button
                onClick={() => setMapBig((b) => !b)}
                aria-pressed={mapBig}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-panel/90 px-2.5 py-1.5 font-mono text-[11px] text-fg-2 lg:hidden"
              >
                {mapBig ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />} {mapBig ? "Smaller map" : "Bigger map"}
              </button>
            }
            callsFile={callsFile}
            onCallsFile={setCallsFile}
            onOpenCode={(file, line) => {
              setPlaying(false);
              setEvidence(null);
              setSelected({ id: file, kind: "file" });
              setViewFile({ path: file, line });
            }}
            expanded={expanded}
            onToggle={(id) =>
              setExpanded((was) => {
                const next = new Set(was);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            onEdge={(route) => {
              setPlaying(false);
              setSelected(null);
              setEvidence(route);
            }}
            onSelect={(id, kind) => {
              if (!id) {
                setSelected(null);
                setViewFile(null);
                return;
              }
              setPlaying(false);
              setEvidence(null);
              setSelected({ id, kind });
              setViewFile(kind === "file" ? { path: id } : null);
            }}
          />
        </section>

        <section id="step" tabIndex={-1} aria-label="Current step and code" className="outline-none relative order-1 flex min-h-0 flex-col gap-4 p-4 lg:order-3 lg:overflow-hidden lg:border-l lg:border-line">
          {/* The explanation scrolls on its own (half the column when code is shown), so the code and the player stay put. */}
          <div className={`relative flex flex-col gap-4 lg:-mx-1 lg:min-h-0 lg:overflow-y-auto lg:px-1 ${codePath ? "lg:max-h-[52%] lg:shrink-0" : "lg:flex-1"}`}>
          {tracing && !pullLive && (
            <div role="status" className="flex items-center gap-3 rounded-card border border-trail/40 bg-trail-soft px-4 py-3">
              <Loader2 className="size-4 shrink-0 animate-spin text-trail" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{docsBusy || !answer ? tracing : `Answering: ${tracing}`}</p>
                <p className="text-xs text-fg-3">Codetrail already has this repo, so this is usually quick and cheap.</p>
              </div>
              <StopButton onStop={stopRun} />
            </div>
          )}
          {problem && <ProblemNote problem={problem} onDismiss={() => setProblem(null)} />}

          {(docShown || (answer && !selected)) && tour && !tracing && (
            <button
              onClick={() => {
                setAnswer(null);
                setDocPage(null);
                leaveThreadUnless(tour.id);
              }}
              className="inline-flex items-center gap-1.5 self-start font-mono text-[11px] text-fg-3 hover:text-fg"
            >
              <ArrowLeft className="size-3" /> Back to the tour: {tour.title}
            </button>
          )}
          {draft ? (
            <TourEditor
              draft={draft}
              onChange={setDraft}
              onScreen={codePath && highlight.start ? { file: codePath, start: highlight.start, end: highlight.end ?? highlight.start } : null}
              onShow={(s: DraftStep) => setViewFile({ path: s.file, line: s.startLine, end: s.endLine })}
              onCancel={() => {
                setDraft(null);
                setViewFile(null);
              }}
              saving={draftSaving}
              error={draftError}
              onSave={async () => {
                setDraftSaving(true);
                setDraftError(null);
                try {
                  const r = await api<{ tour: Tour; tours: TourIndexEntry[] }>("/api/tour/custom", { ...at(summary), title: draft.title, summary: draft.summary, steps: draft.steps.map(({ key: _key, ...st }) => ({ ...st, startLine: Math.min(st.startLine, st.endLine), endLine: Math.max(st.startLine, st.endLine) })) });
                  setTours(r.tours);
                  setDraft(null);
                  setViewFile(null);
                  setSelected(null);
                  setTour(r.tour);
                  setTourFromCache(true);
                  setStep(0);
                } catch (e) {
                  if (needsSignIn(e)) setSignIn(true);
                  else setDraftError((e as Error).message);
                } finally {
                  setDraftSaving(false);
                }
              }}
            />
          ) : evidence && !selected ? (
            <EvidencePanel
              route={evidence}
              atlas={atlas}
              onOpen={(file, line) => setViewFile({ path: file, line })}
              onClose={() => {
                setEvidence(null);
                setViewFile(null);
              }}
            />
          ) : docs && docShown ? (
            <DocsView
              docs={docs}
              atlas={atlas}
              summary={summary}
              page={docShown}
              onPage={setDocPage}
              onOpen={(file, start) => setViewFile({ path: file, line: start })}
              onClose={() => {
                setDocPage(null);
                setViewFile(null);
              }}
            />
          ) : selectedModule ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-mono text-[11.5px] text-fg-3">
                  <span className="size-2 rounded-full" style={{ background: moduleColor.get(selectedModule.id) ?? SUPPORT }} />
                  module{selectedModule.layer ? ` · ${selectedModule.layer} layer` : ""} · {selectedModule.kind}
                </p>
                <button onClick={() => setSelected(null)} aria-label="Close" className="rounded p-1 text-fg-3 hover:text-fg">
                  <X className="size-3.5" />
                </button>
              </div>
              <h2 className="mt-2 font-display text-[24px] font-medium tracking-[-0.03em] [font-stretch:82%]">{selectedModule.label}</h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">
                <Rich text={selectedModule.purpose} />
              </p>
              <button
                onClick={() =>
                  setExpanded((was) => {
                    const next = new Set(was);
                    if (!next.delete(selectedModule.id)) next.add(selectedModule.id);
                    return next;
                  })
                }
                className="mt-2 mr-4 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-trail hover:underline"
              >
                {expanded.has(selectedModule.id) ? "Close it on the map" : "Show its files on the map"}
              </button>
              {docs?.pages.some((pg) => pg.node === selectedModule.id) && (
                <button
                  onClick={() => {
                    setSelected(null);
                    setViewFile(null);
                    void openDocs(selectedModule.id);
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-trail hover:underline"
                >
                  <BookOpen className="size-3.5" /> Open its docs page
                </button>
              )}
              <button onClick={() => copyPrompt({ module: selectedModule.id })} className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-trail hover:underline">
                <MessageSquareText className="size-3.5" /> Copy as a prompt for an AI chat
              </button>
              <ul className="mt-3 space-y-0.5">
                {selectedModule.files.map((f) => (
                  <li key={f}>
                    <button
                      onClick={() => setViewFile({ path: f })}
                      title={f}
                      className={`w-full truncate rounded px-1.5 py-1 text-left font-mono text-[12px] ${viewFile?.path === f ? "bg-raised text-fg" : "text-fg-2 hover:bg-raised"}`}
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
              <ModuleLinks
                id={selectedModule.id}
                atlas={atlas}
                summary={summary}
                onPick={(link) => {
                  setSelected(null);
                  setEvidence(link);
                }}
              />
            </div>
          ) : selected?.kind === "file" ? (
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-mono text-[12px] text-fg-2" title={selected.id}>
                {selected.id}
              </p>
              <button
                onClick={() => {
                  setSelected(null);
                  setViewFile(null);
                }}
                className="shrink-0 font-mono text-[11px] text-trail hover:underline"
              >
                {under ? `close file · back to ${under}` : "close file"}
              </button>
            </div>
          ) : answer ? (
            <>
              <AnswerView
                question={answer.question}
                text={answer.text}
                streaming={answer.streaming}
                answer={answer.stored}
                fromCache={answer.fromCache}
                onOpen={(file, start) => setViewFile({ path: file, line: start })}
                at={summary}
                onPrompt={answer.stored ? () => copyPrompt({ answer: answer.stored! }) : undefined}
                stage={answer.streaming ? answer.stage : undefined}
              />
              {answer.stored && !answer.streaming && (
                <ThreadView
                  key={answer.stored.id}
                  summary={summary}
                  thread={thread}
                  activeRef={answer.stored.id}
                  followUps={answerFollowUps(answer.stored.text)}
                  busy={!!tracing}
                  open={!viewFile}
                  onTurn={(t) => openTurn(t)}
                  onAsk={followUp}
                />
              )}
            </>
          ) : tour && current ? (
            <>
              {tour.pull && <PullHeader facts={tour.pull} compact />}
              <RichContext.Provider value={richLinks}>
                <Narration
                  tour={tour}
                  atlas={atlas}
                  step={step}
                  fromCache={tourFromCache}
                  onShare={() => setCardOpen(true)}
                  onExport={() => downloadCodeTour(tour, summary, nextTour?.title)}
                  onTranscript={() => setDialog("transcript")}
                  onReceipt={() => setCostOpen(true)}
                  onEdit={() => {
                    setPlaying(false);
                    setDraftError(null);
                    setDraft({
                      basedOn: tour.id,
                      title: `${tour.title} (my version)`,
                      summary: tour.summary,
                      steps: tour.steps.map((s) => ({ file: s.file, startLine: s.startLine, endLine: s.endLine, title: s.title, narration: s.narration })),
                    });
                  }}
                  onPrompt={() => copyPrompt({ tour })}
                  next={nextTour}
                  prev={prevTour}
                />
              </RichContext.Provider>
              {tour.review && <ReviewNotes notes={tour.review} onOpen={(file, line) => setViewFile({ path: file, line })} />}
              {!tour.pull && (
                <ThreadView key={tour.id} summary={summary} thread={thread} activeRef={tour.id} followUps={tour.followUps ?? []} busy={!!tracing} onTurn={(t) => openTurn(t)} onAsk={followUp} />
              )}
            </>
          ) : pull && pullView ? (
            <PullStart view={pullView} readSha={summary.sha} busy={!!pullLive} live={pullLive} onTour={tourPull} />
          ) : pull && pullError ? (
            <p className="rounded-card border border-danger/40 bg-panel px-4 py-3 text-sm text-fg-2">{pullError}</p>
          ) : (
            !tracing && (
              <div className="rounded-card border border-line p-5 text-sm text-fg-2">
                <MousePointerClick className="mb-2 size-5 text-trail" />
                Pick a tour on the left, ask your own question, or click a node on the map.
              </div>
            )
          )}

          <button id="files-toggle" onClick={() => setBrowse((b) => !b)} aria-expanded={browse} className="self-start font-mono text-[11px] tracking-[0.08em] text-fg-3 hover:text-fg">
            {browse ? "hide files" : "browse & search files · press /"}
          </button>
          {browse && (
            <FileBrowser
              tall={!tour && !answer}
              summary={summary}
              atlas={atlas}
              onOpen={(path, line) => {
                setViewFile({ path, line });
                setSelected({ id: path, kind: "file" });
                setPlaying(false);
              }}
              onClose={() => {
                setBrowse(false);
                document.getElementById("files-toggle")?.focus();
              }}
            />
          )}
          </div>

          {codePath && (
            <div className="h-[56vh] min-h-0 lg:h-auto lg:min-h-[160px] lg:flex-1">
              <CodePanel
                owner={summary.owner}
                repo={summary.repo}
                sha={changedFile ? tour!.pull!.headSha : summary.sha}
                path={codePath}
                start={highlight.start}
                end={highlight.end}
                patch={changedFile?.patch}
                marks={changedFile ? [] : marks.filter((m) => m.file === codePath && !(tour?.id === m.tourId && step === m.step && !viewFile))}
                onMark={(m) => {
                  setSelected(null);
                  setViewFile(null);
                  setEvidence(null);
                  setAnswer(null);
                  setDocPage(null);
                  leaveThreadUnless(m.tourId);
                  void openTour(m.tourId, m.step);
                }}
                onCalls={() => setCallsFile(codePath)}
              />
            </div>
          )}

          {tour && !selected && !answer && !docPage && !draft && (
            <div className="sticky bottom-3 rounded-card bg-ink/90 backdrop-blur lg:static lg:shrink-0 lg:bg-transparent">
              <PlayerBar
                tour={tour}
                step={step}
                playing={playing}
                dwellMs={current ? dwell(current.narration, speed) : 0}
                speed={speed}
                onStep={(i) => {
                  setStep(i);
                  setPlaying(false);
                }}
                onToggle={() => {
                  if (!playing && step >= tour.steps.length - 1) setStep(0);
                  setPlaying((p) => !p);
                }}
                onSpeed={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
                seen={seen[tour.id]}
              />
            </div>
          )}
        </section>
      </main>
      {drawers}
      {cardOpen && tour && <TrailCardModal summary={summary} tour={tour} onClose={() => setCardOpen(false)} />}
      {signIn && <SignInModal onClose={() => setSignIn(false)} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "transcript" && tour && <TranscriptDialog tour={tour} summary={summary} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** A module's links, in and out, each opening the import lines behind it: the map's links without the map. */
function ModuleLinks({ id, atlas, summary, onPick }: { id: string; atlas: Atlas; summary: RepoSummary; onPick: (link: LinkInfo) => void }) {
  const links = architectureSpec(atlas, { files: summary }).edges.filter((e) => e.from === id || e.to === id);
  if (!links.length) return null;
  const label = (m: string) => atlas.nodes.find((n) => n.id === m)?.label ?? m;
  return (
    <div className="mt-4">
      <h3 className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Links</h3>
      <ul className="mt-1.5 space-y-0.5">
        {links.map((l) => (
          <li key={`${l.from}>${l.to}`}>
            <button
              onClick={() =>
                onPick({
                  from: l.from,
                  to: l.to,
                  label: plainLabel(l.label ?? ""),
                  verified: l.verified,
                  evidence: l.evidence ?? [],
                })
              }
              className="w-full rounded px-1.5 py-1 text-left text-[12.5px] text-fg-2 hover:bg-raised"
            >
              {l.from === id ? `→ ${label(l.to)}` : `← ${label(l.from)}`}{" "}
              <span className="font-mono text-[11px] text-fg-3">{l.verified ? `${l.evidence?.length ?? 0} ${l.evidence?.length === 1 ? "import" : "imports"}` : "inferred"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A link on the map, and the import lines in the code that back it. */
function EvidencePanel({ route, atlas, onOpen, onClose }: { route: LinkInfo; atlas: Atlas; onOpen: (file: string, line?: number) => void; onClose: () => void }) {
  const name = (id: string) => (id.includes("::") ? id.slice(id.indexOf("::") + 2) : (atlas.nodes.find((n) => n.id === id)?.label ?? id));
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[11.5px] text-fg-3">
          <Link2 className="size-3.5" /> link · {route.verified ? "confirmed by imports" : "inferred by the model"}
        </p>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-3 hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      <h2 className="mt-2 font-display text-[22px] leading-tight font-medium tracking-[-0.03em] [font-stretch:82%]">
        {name(route.from)} → {name(route.to)}
      </h2>
      {route.label && <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{route.label}</p>}
      {route.evidence.length ? (
        <>
          <p className="mt-4 font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">
            The {route.evidence.length === 1 ? "import" : `${route.evidence.length} imports`} behind it
          </p>
          <ul className="mt-2 space-y-0.5">
            {route.evidence.slice(0, 40).map((e) => (
              <li key={`${e.file}>${e.to}`}>
                <button onClick={() => onOpen(e.file, e.line ?? undefined)} className="w-full rounded px-1.5 py-1 text-left font-mono text-[12px] text-fg-2 hover:bg-raised" title={`${e.file} imports ${e.to}`}>
                  <span className="text-fg">{e.file}</span>
                  {e.line ? <span className="text-trail">:{e.line}</span> : null} <span className="text-fg-3">imports {e.to}</span>
                </button>
              </li>
            ))}
          </ul>
          {route.evidence.length > 40 && <p className="mt-1 font-mono text-[11px] text-fg-3">and {route.evidence.length - 40} more</p>}
        </>
      ) : (
        <p className="mt-4 text-[13.5px] leading-relaxed text-fg-3">No import in the code backs this link: the model inferred it from how the code is used (a runtime call, an event, a request).</p>
      )}
    </div>
  );
}

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <button onClick={onStop} title="Stop this call. If no one else is waiting on it, the model stops writing." className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-panel px-2.5 py-1.5 font-mono text-[11.5px] text-fg-2 hover:border-danger/60 hover:text-fg">
      <Square className="size-3 fill-current" /> Stop
    </button>
  );
}

function ProblemNote({ problem, onDismiss }: { problem: Problem; onDismiss: () => void }) {
  // After Stop, focus lands on "Start again" instead of being lost with the Stop button.
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (problem.stopped) again.current?.focus();
  }, [problem]);
  return (
    <div role="alert" className={`flex w-full max-w-[1240px] items-start gap-2 rounded-card border bg-panel px-4 py-3 text-sm text-fg-2 ${problem.stopped ? "border-line" : "border-danger/40"}`}>
      {problem.stopped ? <Square className="mt-1 size-3 shrink-0 fill-current text-fg-3" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />}
      <span className="min-w-0 flex-1">{problem.text}</span>
      {problem.retry && (
        <button
          ref={again}
          onClick={() => {
            onDismiss();
            problem.retry?.();
          }}
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11.5px] text-trail hover:underline"
        >
          <RotateCcw className="size-3" /> {problem.stopped ? "Start again" : "Retry"}
        </button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-fg-3 hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function TrailCardModal({ summary, tour, onClose }: { summary: RepoSummary; tour: Tour; onClose: () => void }) {
  const src = `/${summary.owner}/${summary.repo}/trail-card?tour=${tour.id}`;
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Share card" onClose={onClose} wide>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Share card: ${tour.title}`} width={1200} height={630} className="h-auto w-full rounded-[10px] border border-line bg-panel" />
      <p className="mt-2 text-[12.5px] text-fg-3">This image is the link preview when you share this tour.</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          onClick={() =>
            copyText(window.location.href, "Link copied").then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="rounded-[10px] border border-line bg-panel px-3 py-2 font-mono text-[12px] text-fg-2 hover:text-fg"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
        <a href={src} download={`${summary.repo}-tour.png`} className="rounded-[10px] bg-trail px-3 py-2 font-mono text-[12px] font-semibold text-[#16171a]">
          Download PNG
        </a>
      </div>
    </Dialog>
  );
}
