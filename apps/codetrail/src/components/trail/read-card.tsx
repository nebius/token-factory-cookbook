"use client";

import { FileSearch, Image as ImageIcon, Play, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { formatTokens, formatUsd, perMillion } from "@/lib/format";
import { LOCAL_OWNER } from "@/lib/ref";
import type { RepoSummary } from "@/lib/schemas";
import { KIND_COLOR, SUPPORT } from "@/lib/palette";
import { GraphView, type GraphEdge, type GraphNode } from "./graph";
import { useModal } from "./dialog";
import { Treemap } from "./treemap";
import { inScope, normalScope, parseScope, scopeLabel, scopeQuery, type Scope } from "@/lib/scope";

const CONTEXT = 1_048_576;

/** Rough wall-clock for the first read (map + main tour), from our runs: ~15-25s at 250-450K tokens. */
const expectedSeconds = (tokens: number) => Math.round(12 + tokens / 25_000);

export function ReadCard({ summary, onRead }: { summary: RepoSummary; onRead: () => void }) {
  const [files, setFiles] = useState(false);
  const used = Math.max(1, Math.round((summary.tokens / CONTEXT) * 100));
  return (
    <div className="w-full max-w-[1240px]">
      <p className="font-mono text-[12px] text-fg-3">
        {summary.owner === LOCAL_OWNER ? "this machine" : summary.owner} / {summary.repo} · {summary.sha.slice(0, 7)} · {summary.ref}
      </p>
      <h1 className="mt-2 font-display text-[44px] leading-none font-light tracking-[-0.05em] [font-stretch:78%] sm:text-[60px]">
        Ready to <span className="font-extrabold text-trail [font-stretch:110%]">read</span>.
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fg-2">
        Codetrail {summary.owner === LOCAL_OWNER ? "read this folder from disk" : "downloaded this commit"}, skipped what isn&apos;t code and mapped the imports, all on its own. Nothing has been sent to the model and nothing has been spent. Below is
        what one read would send.
      </p>

      <div className="mt-10 flex flex-wrap items-start gap-12">
        <div className="min-w-0 flex-[999_1_600px] space-y-11">
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="font-medium">How much of {summary.modelLabel}&apos;s 1M-token context this repo will fill</h2>
              <span className="font-mono text-[12px] text-fg-3">
                one dot = 10K tokens ·{" "}
                <span className="text-trail">
                  ≈ {formatTokens(summary.tokens)} to send ({used}%)
                </span>
              </span>
            </div>
            <div
              role="img"
              aria-label={`The read will send about ${formatTokens(summary.tokens)} of 1,048,576 tokens, about ${used} of 100 dots. Nothing has been sent yet.`}
              className="mt-4 grid grid-cols-[repeat(25,minmax(0,1fr))] gap-[7px] sm:gap-[9px]"
            >
              {Array.from({ length: 100 }, (_, i) => (
                <span key={i} className={`aspect-square rounded-full ${i < used ? "bg-trail" : "bg-raised"}`} style={{ animation: `waypoint-pop .45s ${i * 6}ms both` }} />
              ))}
            </div>
            {summary.files.compressed > 0 && (
              <p className="mt-3 text-[13px] text-fg-2">
                {summary.files.compressed} lower-priority files won&apos;t fit whole, so they&apos;ll be sent as signatures only (imports and declarations, with their real line numbers).
              </p>
            )}
            {summary.files.overBudget > 0 && (
              <p className="mt-1.5 text-[13px] text-warn">
                {summary.files.overBudget} more files won&apos;t fit even as signatures, so they&apos;ll be left out (tests and examples go first).
              </p>
            )}
            {summary.files.secrets > 0 && (
              <p className="mt-1.5 text-[13px] text-fg-2">{summary.files.secrets} files that look like they hold credentials will be left out and never sent to the model.</p>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="font-medium">What will be sent</h2>
              <span className="font-mono text-[12px] text-fg-3">
                {summary.files.read} files to send · {summary.files.skipped} skipped
              </span>
            </div>
            <div className="mt-4">
              <Treemap summary={summary} />
            </div>
          </section>

          <FolderPicker summary={summary} />

          <section className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
            {[
              { v: `${summary.files.read}`, l: `files to read, of ${summary.files.total}` },
              { v: summary.lines.toLocaleString(), l: "lines, each numbered" },
              { v: formatTokens(summary.tokens), l: summary.tokensMeasured ? "tokens (measured)" : "tokens (estimated)" },
              { v: summary.graphEdges.toLocaleString(), l: "import links, from the code" },
            ].map((s) => (
              <div key={s.l} className="border-b border-line py-4 pr-2">
                <div className="font-display text-[26px] font-medium tracking-tight [font-stretch:80%]">{s.v}</div>
                <div className="mt-1 text-[12.5px] text-fg-3">{s.l}</div>
              </div>
            ))}
          </section>
        </div>

        <aside className="min-w-0 flex-[1_1_340px] space-y-6 max-md:order-first">
          <div className="rounded-card border border-line bg-panel p-6">
            <p className="text-[13px] text-fg-3">Map + main tour, one read, estimated</p>
            <p className="mt-1 font-display text-[44px] font-medium tracking-[-0.04em] [font-stretch:80%]">≈ {formatUsd(summary.estimate.firstRead)}</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">
              Then ≈ {formatUsd(summary.estimate.followUp)} per extra tour while the repo is in cache, up to ≈ {formatUsd(summary.estimate.followUpCold)}{" "}
              if it isn&apos;t yet. Saved tours replay free.
            </p>
            <button
              onClick={onRead}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[12px] bg-trail px-4 py-3.5 font-display text-[14px] font-bold tracking-wide text-[#16171a] transition hover:bg-trail-strong disabled:opacity-60 [font-stretch:90%]"
            >
              <Play className="size-4 fill-current" /> READ THE REPO · ~{expectedSeconds(summary.tokens)}s
            </button>
            <button onClick={() => setFiles(true)} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-line px-4 py-2.5 text-[13px] text-fg-2 hover:border-outline hover:text-fg">
              <FileSearch className="size-4" /> See every file that will be read
            </button>
            {summary.price && (
              <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-fg-3">
                Live price · {perMillion(summary.price.input)} input · <span className="text-trail">{perMillion(summary.price.cached)} cached</span> · {perMillion(summary.price.output)} output
                per 1M tokens · Nebius Token Factory
              </p>
            )}
          </div>
          <div className="text-[13px] leading-relaxed text-fg-2">
            <p className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">How this read works</p>
            <p className="mt-2">
              Every file goes to {summary.modelLabel} in one prompt with line numbers, plus the import graph worked out from the code. One call returns the modules, how they
              connect, the questions worth asking and the first tour. Every step is then checked against the real file.
            </p>
          </div>
        </aside>
      </div>
      <FilesDrawer open={files} onClose={() => setFiles(false)} summary={summary} />
    </div>
  );
}

const REASON: Record<string, string> = {
  lockfile: "lockfile",
  generated: "generated or boilerplate",
  binary: "not text code",
  too_large: "over 200 KB",
  minified: "minified",
  secret: "looks like it holds credentials",
  scope: "outside the chosen folders",
};

export function FilesDrawer({ open, onClose, summary }: { open: boolean; onClose: () => void; summary: RepoSummary }) {
  const [tab, setTab] = useState<"read" | "compressed" | "budget" | "skipped">("read");
  const panel = useRef<HTMLElement>(null);
  useModal(panel, onClose, open);
  if (!open) return null;
  const tabs = [
    { id: "read" as const, label: `Read (${summary.files.read})` },
    { id: "compressed" as const, label: `Signatures only (${summary.files.compressed})` },
    { id: "budget" as const, label: `Over budget (${summary.files.overBudget})` },
    { id: "skipped" as const, label: `Skipped (${summary.files.skipped})` },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="What the model reads" tabIndex={-1} className="relative flex h-full w-full max-w-lg flex-col border-l border-line bg-night outline-none">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[20px] font-medium tracking-tight [font-stretch:85%]">What the model reads</h2>
            <p className="text-xs text-fg-3">README, manifests and entry points first, tests and examples last.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-fg-3 hover:bg-raised hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex gap-1 border-b border-line px-3 py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-xs ${tab === t.id ? "bg-raised-2 text-fg" : "text-fg-3 hover:text-fg-2"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {summary.files.images.length > 0 && tab === "read" && (
          <p className="flex items-center gap-1.5 border-b border-line px-5 py-2 text-xs text-fg-2">
            <ImageIcon className="size-3.5 text-verified" /> Images sent too: {summary.files.images.join(", ")}
          </p>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto px-5 py-3 font-mono text-xs">
          {tab === "read" && summary.read.map((p, i) => <Row key={p} n={i + 1} path={p} />)}
          {tab === "compressed" && (summary.compressed.length ? summary.compressed.map((p) => <Row key={p} path={p} note="signatures only" />) : <Empty />)}
          {tab === "budget" && (summary.overBudget.length ? summary.overBudget.map((p) => <Row key={p} path={p} />) : <Empty />)}
          {tab === "skipped" &&
            (summary.skippedSample.length ? (
              <>
                {summary.skippedSample.map((s) => <Row key={s.path} path={s.path} note={REASON[s.reason] ?? s.reason} />)}
                {summary.skippedSample.length < summary.files.skipped && (
                  <li className="py-2 font-sans text-fg-3">
                    Showing {summary.skippedSample.length.toLocaleString()} of {summary.files.skipped.toLocaleString()} skipped files.
                  </li>
                )}
              </>
            ) : (
              <Empty />
            ))}
        </ul>
      </aside>
    </div>
  );
}

function Row({ path, n, note }: { path: string; n?: number; note?: string }) {
  return (
    <li className="flex items-baseline gap-3 py-1 text-fg-2">
      {n !== undefined && <span className="w-8 shrink-0 text-right text-fg-3">{n}</span>}
      <span className="min-w-0 flex-1 truncate" title={path}>
        {path}
      </span>
      {note && <span className="shrink-0 font-sans text-[11px] text-fg-3">{note}</span>}
    </li>
  );
}

const Empty = () => <li className="py-2 font-sans text-fg-3">Nothing here.</li>;

export type LiveRead = {
  thinkingChars: number;
  chars: number;
  summary: string | null;
  nodes: { id: string; label: string; kind: string }[];
  edges: { from: string; to: string; label: string }[];
  tours: string[];
  steps: { title: string; node: string | null }[];
};

/**
 * While the model reads: elapsed time, a "thinking" counter, then the map building itself live as modules,
 * links and tour steps stream in. Without a stream it still shows the files going by.
 */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// After this long with no new output, say so instead of looking busy.
const QUIET_S = 25;

export function Reading({ summary, label, live, onStop }: { summary: RepoSummary; label: string; live?: LiveRead | null; onStop?: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState(0);
  const [lastOutput, setLastOutput] = useState(0);
  const outputSize = (live?.chars ?? 0) + (live?.thinkingChars ?? 0);
  useEffect(() => setLastOutput(Date.now()), [outputSize]);
  // The file list scrolls by as decoration; it stops for reduced motion, or when paused.
  const still = useReducedMotion();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (still || paused) return;
    const f = setInterval(() => setTick((x) => x + 1), 140);
    return () => clearInterval(f);
  }, [still, paused]);
  const expected = expectedSeconds(summary.tokens);
  const files = summary.read;
  const nodes = live?.nodes ?? [];
  const graphNodes: GraphNode[] = nodes.map((n) => ({ id: n.id, label: n.label, color: KIND_COLOR[n.kind] ?? SUPPORT, weight: 1, kind: n.kind }));
  const ids = new Set(nodes.map((n) => n.id));
  const graphEdges: GraphEdge[] = (live?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to, label: e.label }));
  const stage = !live || (live.chars === 0 && live.thinkingChars === 0) ? "reading" : live.chars === 0 ? "thinking" : live.steps.length ? "tour" : nodes.length ? "mapping" : "writing";
  const STAGES = [
    { id: "reading", text: `Reading ${summary.files.read} files (${formatTokens(summary.tokens)} tokens)` },
    { id: "thinking", text: live?.thinkingChars ? `Thinking · ≈ ${Math.round(live.thinkingChars / 3.6).toLocaleString()} tokens` : "Thinking" },
    { id: "mapping", text: `Mapping modules · ${nodes.length}` },
    { id: "tour", text: `Writing the main tour · ${live?.steps.length ?? 0} steps` },
  ];
  const order = ["reading", "thinking", "writing", "mapping", "tour"];
  const at = order.indexOf(stage);

  return (
    <div className="w-full max-w-[1240px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] text-trail uppercase">{label}</p>
          <h1 className="mt-2 font-display text-[36px] leading-none font-light tracking-[-0.05em] [font-stretch:78%] sm:text-[48px]">
            {summary.modelLabel} <span className="font-extrabold [font-stretch:105%]">is reading.</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="font-mono text-[12px] text-fg-3" aria-live="off">
            {clock(elapsed)} · usually ~{expected}s
          </p>
          {onStop && (
            <button onClick={onStop} className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-panel px-3 py-1.5 font-mono text-[12px] text-fg-2 hover:border-danger/60 hover:text-fg">
              <Square className="size-3 fill-current" /> Stop
            </button>
          )}
        </div>
      </div>
      {/* No real percentage exists for one model call, so the bar only says "working". */}
      <div className="mt-5 h-1 overflow-hidden rounded-full bg-line">
        <div className="indeterminate h-full w-1/3 rounded-full bg-trail" />
      </div>
      {/* Rounded to 5 seconds, so a screen reader hears it now and then, not five times a second. */}
      <p role="status" className="mt-2 min-h-[1em] font-mono text-[11.5px] text-fg-3">
        {elapsed > QUIET_S && lastOutput && (Date.now() - lastOutput) / 1000 > QUIET_S
          ? `Still working · no new output for ${Math.floor((Date.now() - lastOutput) / 5000) * 5}s. Big repos can take a while before the first words.`
          : ""}
      </p>
      <p className="sr-only" aria-live="polite">
        {STAGES.find((x) => x.id === (stage === "writing" ? "thinking" : stage))?.text.replace(/ ·.*$/, "")}
      </p>

      <div className="mt-8 flex flex-wrap gap-8">
        <div className="relative h-[460px] min-w-0 flex-[999_1_560px] overflow-hidden rounded-card border border-line dot-grid">
          {graphNodes.length > 0 ? (
            <div aria-hidden inert className="h-full w-full">
              <GraphView nodes={graphNodes} edges={graphEdges} active={null} previous={null} visited={new Map()} selected={null} onSelect={() => {}} edgeLabels="all" minRadius={22} maxRadius={22} />
            </div>
          ) : (
            <div className="absolute inset-0 overflow-hidden p-5 font-mono text-[11.5px] leading-6 text-fg-3 [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)]">
              {files.length > 0 &&
                Array.from({ length: 18 }, (_, k) => {
                  const path = files[(tick + k) % files.length];
                  return (
                    <div key={k} className={k === 9 ? "text-trail" : undefined}>
                      {k === 9 ? "› " : "  "}
                      {path}
                    </div>
                  );
                })}
            </div>
          )}
          <p className="absolute bottom-3 left-4 font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">
            {graphNodes.length ? `the map, as ${summary.modelLabel} writes it` : "files going into one prompt"}
          </p>
          {!graphNodes.length && !still && (
            <button onClick={() => setPaused((p) => !p)} aria-pressed={paused} className="absolute right-3 bottom-2 rounded-md px-2 py-1 font-mono text-[10.5px] text-fg-3 hover:text-fg">
              {paused ? "Resume the list" : "Pause the list"}
            </button>
          )}
        </div>

        <div className="min-w-0 flex-[1_1_320px] space-y-6">
          <ol className="space-y-3">
            {STAGES.map((s, i) => {
              const idx = order.indexOf(s.id);
              const done = at > idx;
              const now = at === idx || (s.id === "thinking" && stage === "writing");
              return (
                <li key={s.id} className={`flex items-center gap-3 font-mono text-[12.5px] ${done ? "text-fg-2" : now ? "text-fg" : "text-fg-3"}`}>
                  <span className={`size-2.5 rounded-full ${done ? "bg-trail" : now ? "animate-pulse bg-trail" : "border border-outline"}`} />
                  {s.text}
                  {i === 0 && done && <span className="text-ok">✓</span>}
                </li>
              );
            })}
          </ol>
          {live?.summary && <p className="text-[13.5px] leading-relaxed text-fg-2">{live.summary}</p>}
          {live && live.tours.length > 0 && (
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Questions worth asking</p>
              <ul className="mt-2 space-y-1 text-[13px] text-fg-2">
                {live.tours.map((t) => (
                  <li key={t} className="border-l-2 border-line pl-2.5">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {live && live.steps.length > 0 && (
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Main tour</p>
              <ol className="mt-2 space-y-1 font-mono text-[12px] text-fg-2">
                {live.steps.map((s, i) => (
                  <li key={i}>
                    <span className="text-trail">{String(i + 1).padStart(2, "0")}</span> {s.title}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Folders with their share of what would be sent: the top level, and one level down where a folder splits up. */
function foldersOf(summary: RepoSummary) {
  const tokens = new Map<string, number>();
  const add = (dir: string, t: number) => tokens.set(dir, (tokens.get(dir) ?? 0) + t);
  for (const [path, , t] of summary.fileSizes) {
    const parts = path.split("/");
    if (parts.length < 2) continue;
    add(parts[0], t);
    if (parts.length > 2) add(`${parts[0]}/${parts[1]}`, t);
  }
  const total = summary.fileSizes.reduce((a, [, , t]) => a + t, 0) || 1;
  const top = [...tokens].filter(([d]) => !d.includes("/")).sort((a, b) => b[1] - a[1]);
  return top.flatMap(([dir, t]) => {
    const subs = [...tokens].filter(([d, n]) => d.startsWith(`${dir}/`) && n / total > 0.03).sort((a, b) => b[1] - a[1]);
    return [{ dir, tokens: t, depth: 0 }, ...(subs.length >= 2 ? subs.slice(0, 12).map(([d, n]) => ({ dir: d, tokens: n, depth: 1 })) : [])];
  });
}

/**
 * Read only some folders (DeepWiki-style include/exclude): untick folders to skip them, or name the ones to keep.
 * The estimate follows as you choose; Apply opens that read, which is stored apart from the full one.
 */
function FolderPicker({ summary }: { summary: RepoSummary }) {
  const current = parseScope(summary.scope);
  const [open, setOpen] = useState(!!current);
  const [skip, setSkip] = useState<string[]>(current?.skip ?? []);
  const [only, setOnly] = useState((current?.only ?? []).join(", "));
  const folders = foldersOf(summary);
  const draft: Scope | null = normalScope({ only: only.split(","), skip });
  const kept = summary.fileSizes.filter(([p]) => inScope(p, draft)).reduce((a, [, , t]) => a + t, 0);
  const all = summary.fileSizes.reduce((a, [, , t]) => a + t, 0) || 1;
  const p = summary.price;
  // The files kept, plus the rest of the prompt (instructions, the import graph, files sent as signatures).
  // Patterns that match nothing in this commit (a typo, a folder that isn't there): named, and nothing is read.
  const known = [...summary.fileSizes.map(([p]) => p), ...(summary.otherFiles ?? []).map(([p]) => p)];
  const unmatched = draft ? [...draft.only, ...draft.skip].filter((pat) => !known.some((p) => inScope(p, { only: [pat], skip: [] }))) : [];
  const empty = !!draft && !known.some((p) => inScope(p, draft));
  const tokens = empty ? 0 : Math.round(kept + Math.max(0, summary.tokens - all));
  const cost = p && !empty ? tokens * p.input + 8_000 * p.output : null;
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  if (!folders.length) return null;
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 className="font-medium">Choose folders {current ? <span className="ml-2 font-mono text-[12px] text-trail">{scopeLabel(current)}</span> : null}</h2>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="folder-picker" className="font-mono text-[12px] text-fg-3 hover:text-fg">
          {open ? "Hide" : "Read only part of the repo →"}
        </button>
      </div>
      {open && (
        <div id="folder-picker" className="mt-4 space-y-4">
          <p className="text-[13px] text-fg-3">Untick folders to leave them out, or name the only ones to read. A read of some folders is its own read: the full one stays as it is.</p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {folders.map((f) => {
              const parentOff = f.depth === 1 && skip.includes(f.dir.split("/")[0]);
              // A box only says whether the folder is skipped; "only" is its own setting below.
              const on = !skip.includes(f.dir) && !parentOff;
              return (
                <li key={f.dir} className={f.depth ? "pl-5" : ""}>
                  <label className="flex items-center gap-2 py-0.5 font-mono text-[12.5px] text-fg-2">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={parentOff}
                      onChange={(e) => setSkip((was) => (e.target.checked ? was.filter((d) => d !== f.dir) : [...was, f.dir]))}
                      className="accent-[var(--color-trail)]"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {f.dir}/{parentOff && <span className="ml-1.5 font-sans text-[11px] text-fg-3">(left out with its folder)</span>}
                    </span>
                    <span className="text-fg-3">{formatTokens(f.tokens)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="block">
            <span className="font-mono text-[11px] text-fg-3">Only these folders or globs, comma-separated (empty: all of them)</span>
            <input
              value={only}
              onChange={(e) => setOnly(e.target.value)}
              placeholder="e.g. src, packages/core"
              aria-invalid={unmatched.length > 0}
              aria-describedby={unmatched.length ? "scope-unmatched" : undefined}
              className="mt-1 w-full rounded-[10px] border border-line bg-panel px-3 py-2 font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus:border-trail/60"
            />
          </label>
          {unmatched.length > 0 && (
            <p id="scope-unmatched" role="alert" className="text-[13px] text-danger">
              Nothing in this commit matches {unmatched.map((u) => `"${u}"`).join(", ")}. Check the spelling, or pick from the folders above.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-panel px-4 py-3">
            <p className="font-mono text-[12.5px] text-fg-2">
              {empty ? "No files would be read" : `${scopeLabel(draft) ?? "Everything"} · ≈ ${formatTokens(tokens)} tokens${cost !== null ? ` · first read ≈ ${formatUsd(cost)}` : ""}`}
              <span className="block text-[11px] text-fg-3">{current ? "Counted from the folders in this read; exact numbers after Apply." : "Exact numbers after Apply."}</span>
            </p>
            <span className="flex gap-2">
              {current && (
                <a href={`/${summary.owner}/${summary.repo}`} className="rounded-[10px] px-3 py-1.5 text-[13px] text-fg-2 hover:text-fg">
                  Read everything
                </a>
              )}
              <button
                disabled={!changed || empty}
                title={empty ? "No files match these folders" : undefined}
                onClick={() => window.location.assign(`/${summary.owner}/${summary.repo}${scopeQuery(draft)}`)}
                className="rounded-[10px] bg-trail px-3 py-1.5 text-[13px] font-semibold text-[#16171a] disabled:opacity-40"
              >
                Apply
              </button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
