"use client";

import { Check, Copy, ExternalLink, FileCode2, GitCompareArrows, Milestone, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { lineRanges, patchLines } from "@/lib/diff";
import { copyText } from "@/lib/announce";
import { blobUrl, LOCAL_OWNER } from "@/lib/ref";
import type { TourMark } from "@/server/trail/service";

const LANG: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  py: "python", pyi: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", rb: "ruby", php: "php",
  cs: "csharp", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", swift: "swift", m: "objective-c", mm: "objective-cpp",
  md: "markdown", mdx: "mdx", json: "json", jsonc: "jsonc", yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", html: "html", htm: "html",
  css: "css", scss: "scss", sass: "sass", less: "less", vue: "vue", svelte: "svelte", astro: "astro", sh: "bash", bash: "bash", zsh: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql", lua: "lua", dart: "dart", ex: "elixir", exs: "elixir", erl: "erlang", zig: "zig",
  prisma: "prisma", proto: "proto", tf: "hcl", hcl: "hcl", nix: "nix", r: "r", jl: "julia", hs: "haskell", ml: "ocaml", clj: "clojure", sol: "solidity",
};

function langOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (/^Dockerfile/i.test(name)) return "docker";
  if (/^Makefile$/i.test(name)) return "make";
  return LANG[name.split(".").pop()?.toLowerCase() ?? ""] ?? "text";
}

const rawUrl = (owner: string, repo: string, sha: string, path: string) =>
  owner === LOCAL_OWNER ? null : `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;

// Highlighted files (and their text, for copying), kept across steps: most tours stay in a handful of files.
type Shown = { html: string; text: string };
const htmlCache = new Map<string, Promise<Shown>>();

async function shiki(text: string, lang: string): Promise<string> {
  const { codeToHtml } = await import("shiki");
  try {
    return await codeToHtml(text, { lang, theme: "github-dark-default" });
  } catch {
    return codeToHtml(text, { lang: "text", theme: "github-dark-default" });
  }
}

async function highlight(url: string, fallback: string | null, path: string): Promise<Shown> {
  // Codetrail's stored copy of the commit first (no GitHub limits), then GitHub's raw file.
  let res = await fetch(url).catch(() => null);
  if (!res?.ok && fallback) res = await fetch(fallback).catch(() => null);
  if (!res?.ok) throw new Error(`couldn't load the file (${res?.status ?? "offline"})`);
  const text = await res.text();
  return { html: await shiki(text, langOf(path)), text };
}

type Props = {
  owner: string;
  repo: string;
  sha: string;
  path: string;
  start?: number;
  end?: number;
  /** In a pull-request tour: this file's patch, so the lines it changed are marked (and the diff can be shown). */
  patch?: string;
  /** Steps of stored tours in this file: marked in the gutter, like CodeTour's markers. */
  marks?: TourMark[];
  onMark?: (mark: TourMark) => void;
  /** Opens this file in the call graph. */
  onCalls?: () => void;
};

const MARKS_KEY = "codetrail:tour-marks";

export function CodePanel({ owner, repo, sha, path, start, end, patch, marks = [], onMark, onCalls }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "path" | null>(null);
  const [showMarks, setShowMarks] = useState(() => {
    try {
      return typeof window === "undefined" || localStorage.getItem(MARKS_KEY) !== "off";
    } catch {
      return true;
    }
  });
  // Where each marked step sits, measured from the rendered lines.
  const [placed, setPlaced] = useState<{ top: number; height: number; marks: TourMark[] }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const changes = useMemo(() => (patch ? patchLines(patch) : null), [patch]);
  const diffView = showDiff && !!patch;
  const github = blobUrl(owner, repo, sha, path, start, end);
  // A stable object: React rewrites the HTML whenever this prop changes, which would wipe the line marks below.
  const inner = useMemo(() => (html ? { __html: html } : null), [html]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const url = `/api/file?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&sha=${sha}&path=${encodeURIComponent(path)}`;
    const key = diffView ? `diff:${sha}:${path}` : url;
    let p = htmlCache.get(key);
    if (!p) {
      p = diffView ? shiki(patch!, "diff").then((h) => ({ html: h, text: patch! })) : highlight(url, rawUrl(owner, repo, sha, path), path);
      p.catch(() => htmlCache.delete(key));
      htmlCache.set(key, p);
    }
    setHtml(null);
    p.then((h) => {
      if (cancelled) return;
      setHtml(h.html);
      setText(h.text);
    }).catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, sha, path, diffView, patch]);

  // Mark the step's lines and bring them into view.
  useEffect(() => {
    const root = box.current;
    if (!root || !html) return;
    const lines = root.querySelectorAll<HTMLElement>(".line");
    if (diffView) {
      // The unified patch: +/- lines carry their own marker character, colour only adds to it.
      lines.forEach((el) => {
        const c = el.textContent?.[0];
        el.classList.toggle("add", c === "+");
        el.classList.toggle("del", c === "-");
        el.classList.toggle("hunk", c === "@");
      });
      setBar(null);
      root.scrollTo({ top: 0 });
      return;
    }
    lines.forEach((el, i) => {
      const n = i + 1;
      const inRange = start !== undefined && end !== undefined && n >= start && n <= end;
      el.classList.toggle("hl", inRange);
      el.classList.toggle("dim", start !== undefined && !inRange);
      el.classList.toggle("add", !!changes?.added.has(n));
      // Removed lines show as a red rule between the lines they sat between.
      el.classList.toggle("del-above", !!changes?.removedAfter.has(n - 1));
    });
    // Where the range sits in the whole file, for the position bar.
    setBar(start && end && lines.length ? { top: ((start - 1) / lines.length) * 100, height: Math.max(2, ((end - start + 1) / lines.length) * 100) } : null);
    const first = start ? lines[start - 1] : undefined;
    if (first) {
      const top = first.offsetTop - root.clientHeight * 0.22;
      root.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else {
      root.scrollTo({ top: 0 });
    }
  }, [html, start, end, changes, diffView]);

  // Tour markers: one per line where steps start, sized to the first step's range.
  useEffect(() => {
    const root = box.current;
    if (!root || !html || diffView || !showMarks || !marks.length) return setPlaced([]);
    const lines = root.querySelectorAll<HTMLElement>(".line");
    const byLine = new Map<number, TourMark[]>();
    for (const m of marks) if (m.start >= 1 && m.start <= lines.length) byLine.set(m.start, [...(byLine.get(m.start) ?? []), m]);
    setPlaced(
      [...byLine].map(([line, ms]) => {
        const first = lines[line - 1];
        const last = lines[Math.min(lines.length, ms[0].end) - 1] ?? first;
        return { top: first.offsetTop, height: Math.max(first.offsetHeight, last.offsetTop + last.offsetHeight - first.offsetTop), marks: ms };
      }),
    );
  }, [html, marks, diffView, showMarks]);

  const copy = (what: "code" | "path") => {
    const body =
      what === "path"
        ? `${path}${start ? `:${start}${end && end !== start ? `-${end}` : ""}` : ""}`
        : start && end && text
          ? text.split("\n").slice(start - 1, end).join("\n")
          : (text ?? "");
    copyText(body, what === "path" ? "Path copied" : "Code copied").then((ok) => {
      if (!ok) return;
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="code-surface flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-line bg-code">
      <div className="flex items-center justify-between gap-2 border-b border-[#1d2026] px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[11.5px]">
          <FileCode2 className="size-3.5 shrink-0 text-[#7a7d86]" />
          <span className="truncate text-[#a9abb2]" title={path}>
            {path}
          </span>
          {start && !diffView && (
            <span className="shrink-0 text-trail">
              L{start}
              {end && end !== start ? `–${end}` : ""}
            </span>
          )}
        </div>
        <span className="ml-auto flex shrink-0 items-center">
          {marks.length > 0 && !diffView && (
            <button
              onClick={() => {
                setShowMarks((v) => {
                  try {
                    localStorage.setItem(MARKS_KEY, v ? "off" : "on");
                  } catch {}
                  return !v;
                });
              }}
              aria-pressed={showMarks}
              aria-label={`Tour stops in this file: ${marks.length}. ${showMarks ? "Shown" : "Hidden"}.`}
              title={`${showMarks ? "Hide" : "Show"} where tours stop in this file (${marks.length} ${marks.length === 1 ? "step" : "steps"})`}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] ${showMarks ? "text-trail" : "text-[#9a9ca6] hover:text-[#eeece6]"}`}
            >
              <Milestone className="size-3" /> {marks.length}
            </button>
          )}
          {onCalls && (
            <button onClick={onCalls} title="Show the functions in this file and what they call" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-[#9a9ca6] hover:text-[#eeece6]">
              <Workflow className="size-3" /> calls
            </button>
          )}
          <button onClick={() => copy("code")} title={start && end ? `Copy lines ${start}–${end}` : "Copy the whole file"} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-[#9a9ca6] hover:text-[#eeece6]">
            {copied === "code" ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />} {copied === "code" ? "copied" : "copy"}
          </button>
          <button onClick={() => copy("path")} title="Copy the path and line range" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-[#9a9ca6] hover:text-[#eeece6]">
            {copied === "path" ? "copied" : "path"}
          </button>
        </span>
        {changes && (
          <button
            onClick={() => setShowDiff((d) => !d)}
            aria-pressed={showDiff}
            title={showDiff ? "Show the file as the PR leaves it" : "Show this file's diff"}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] ${showDiff ? "text-[#eeece6]" : "text-[#9a9ca6] hover:text-[#eeece6]"}`}
          >
            <GitCompareArrows className="size-3" /> {showDiff ? "file" : "diff"}
          </button>
        )}
        {github && (
          <a
            href={github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-[#9a9ca6] hover:text-[#eeece6]"
          >
            GitHub <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {changes && (
        <p className="sr-only">
          Changed in this pull request: {changes.added.size ? `lines ${lineRanges(changes.added)} added` : "no lines added"}
          {changes.removed ? `, ${changes.removed} lines removed` : ""}.
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={box} className={`code-view relative min-h-0 flex-1 overflow-auto ${diffView ? "diff" : ""}`}>
          {error ? (
            <p className="p-4 text-sm text-danger">Couldn&apos;t load this file ({error}).</p>
          ) : inner ? (
            <>
              <div dangerouslySetInnerHTML={inner} />
              {placed.map((p) => (
                <button
                  key={p.top}
                  onClick={() => onMark?.(p.marks[0])}
                  title={p.marks.map((m) => `Tour: ${m.tourTitle} · step ${m.step + 1}: ${m.title}`).join("\n")}
                  aria-label={`Tour stop: ${p.marks.map((m) => `${m.tourTitle}, step ${m.step + 1}`).join("; ")}. Opens the tour there.`}
                  className="group absolute left-0 min-h-6 w-6"
                  style={{ top: p.top, height: Math.max(24, p.height) }}
                >
                  <span className="absolute inset-y-0 left-0 w-[4px] rounded-r bg-trail/80 group-hover:w-[6px] group-hover:bg-trail group-focus-visible:w-[6px]" />
                  {p.marks.length > 1 && <span className="absolute top-0 left-[5px] font-mono text-[9px] leading-none text-trail">{p.marks.length}</span>}
                </button>
              ))}
            </>
          ) : (
            <div className="space-y-2 p-4">
              {Array.from({ length: 14 }, (_, i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-[#171a1f]" style={{ width: `${30 + ((i * 37) % 60)}%` }} />
              ))}
            </div>
          )}
        </div>
        <div aria-hidden className="relative my-2.5 mr-2 w-1 shrink-0 rounded-full bg-[#1d2026]">
          {bar && <div className="absolute right-0 left-0 rounded-full bg-trail transition-all duration-300" style={{ top: `${bar.top}%`, height: `${bar.height}%` }} />}
        </div>
      </div>
    </div>
  );
}
