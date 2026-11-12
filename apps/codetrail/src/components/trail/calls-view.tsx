"use client";

// The Calls view: one file's functions, who calls them and what they call, from the code itself. Pick a file
// (the current step's file to start); click a function to open it in the code panel. As a list, the same
// facts read top to bottom: each function, its callers and what it calls.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { callsSpec, type CodeSpot } from "@/lib/diagram";
import { PALETTE, SUPPORT } from "@/lib/palette";
import type { RepoSummary } from "@/lib/schemas";
import type { Calls } from "@/server/repo/calls";
import { DiagramView } from "./diagram-view";

const CODE = /\.(m?[jt]sx?|c[jt]s|py|go)$/;

type Props = {
  summary: RepoSummary;
  file: string | null;
  onFile: (path: string) => void;
  onOpen: (spot: CodeSpot) => void;
  /** Show the text version instead of the diagram. */
  asList?: boolean;
  /** Search on the map: function names that contain it light up. */
  query?: string;
};

export function CallsView({ summary, file, onFile, onOpen, asList, query = "" }: Props) {
  const [calls, setCalls] = useState<Calls | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every code file of the commit: the ones read whole and the ones sent as signatures or left out.
  const choices = useMemo(() => [...summary.fileSizes.map(([p]) => p), ...(summary.otherFiles ?? []).map(([p]) => p)].filter((p) => CODE.test(p)), [summary]);

  useEffect(() => {
    if (!file) return;
    let live = true;
    setCalls(null);
    setError(null);
    fetch(`/api/calls?${new URLSearchParams({ owner: summary.owner, repo: summary.repo, sha: summary.sha, ...(summary.scope ? { scope: summary.scope } : {}), path: file })}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`couldn't read this file (${r.status})`))))
      .then((d: { calls: Calls }) => live && setCalls(d.calls))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [file, summary]);

  const built = useMemo(() => (calls ? callsSpec(calls, { here: PALETTE[0], other: SUPPORT }) : null), [calls]);
  const needle = query.trim().toLowerCase();
  const highlight = useMemo(() => (built && needle ? new Set(built.spec.boxes.filter((b) => b.kind === "fn" && b.label.toLowerCase().includes(needle)).map((b) => b.id)) : null), [built, needle]);
  // What each box is, for screen readers: a caller, a function in this file, or something it calls.
  const roleOf = useMemo(() => {
    const m = new Map<string, string>();
    if (!built || !file) return m;
    for (const b of built.spec.boxes) {
      if (b.kind !== "fn") continue;
      const here = b.id.startsWith(`fn:${file}::`);
      const calledFromHere = built.spec.edges.some((e) => e.to === b.id && e.from.startsWith(`fn:${file}::`));
      m.set(b.id, here ? "function in this file" : calledFromHere ? `called, in ${b.parent?.slice(5) ?? "another file"}` : `caller, in ${b.parent?.slice(5) ?? "another file"}`);
    }
    return m;
  }, [built, file]);

  return (
    <div className="absolute inset-0 flex flex-col pt-14">
      <div className="relative z-10 mx-3 flex flex-wrap items-center gap-2">
        <FilePicker file={file} choices={choices} onFile={onFile} />
        {calls && built && (
          <span className="rounded-[8px] bg-ink/75 px-2 py-1 font-mono text-[10.5px] text-fg-3 backdrop-blur">
            {calls.functions.length} functions · {calls.calls.length - built.unplaced} calls placed · {calls.callers.length} callers
            {built.unplaced ? ` · ${built.unplaced} calls to libraries or not found` : ""}
            {built.moreCallers ? ` · ${built.moreCallers} more callers not drawn` : ""}
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {!file ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-fg-3">Pick a file to see its functions, what they call, and who calls them.</p>
        ) : error ? (
          <p role="alert" className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-danger">
            {error}
          </p>
        ) : calls && !calls.language ? (
          <p role="status" className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-fg-3">
            Function calls are worked out for JavaScript, TypeScript, Python and Go. Pick one of those files.
          </p>
        ) : calls && built && built.spec.boxes.length === 0 ? (
          <p role="status" className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-fg-3">
            No functions found in this file.
          </p>
        ) : calls && built && asList ? (
          <CallsList calls={calls} onOpen={onOpen} onFile={onFile} />
        ) : built ? (
          <DiagramView
            key={file}
            spec={built.spec}
            selectable={false}
            highlight={highlight}
            focusId={highlight?.values().next().value ?? null}
            ariaLabel={`Calls in ${file}: callers on the left, its functions in the middle, what they call on the right. Enter opens a function in the code.`}
            describe={(id) => {
              const box = built.spec.boxes.find((b) => b.id === id);
              if (!box) return id;
              if (box.kind !== "fn") return `File ${box.caption ?? box.label}${id.slice(5) === file ? ", this file" : ", Enter shows its calls"}`;
              return `${box.label}, ${box.caption}, ${roleOf.get(id) ?? ""}`;
            }}
            onSelect={(id) => {
              const spot = id ? built.spots.get(id) : undefined;
              if (spot) onOpen(spot);
              else if (id?.startsWith("file:") && id.slice(5) !== file) onFile(id.slice(5));
            }}
          />
        ) : (
          <p role="status" className="absolute inset-0 grid place-items-center font-mono text-[11px] text-fg-3">
            Reading the calls…
          </p>
        )}
      </div>
    </div>
  );
}

/** A combobox over the repo's code files: type to filter, arrows to move, Enter to pick. */
function FilePicker({ file, choices, onFile }: { file: string | null; choices: string[]; onFile: (path: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const matches = q.length >= 2 ? choices.filter((p) => p.toLowerCase().includes(q)).slice(0, 12) : [];
  const shown = open && q.length >= 2;
  const pick = (p: string) => {
    onFile(p);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="relative">
      <label htmlFor={`${id}-in`} className="sr-only">
        File to show the calls of. Current file: {file ?? "none"}.
      </label>
      <p className="mb-1 font-mono text-[10.5px] text-fg-3">
        Calls in <span className="text-fg-2">{file ?? "no file yet"}</span>
      </p>
      <input
        ref={input}
        id={`${id}-in`}
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown && matches[at] ? `${id}-o${at}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setAt((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && matches[at]) {
            e.preventDefault();
            pick(matches[at]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Type to pick another file"
        className="w-[min(420px,80vw)] rounded-[9px] border border-line bg-panel/95 px-2.5 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-fg-3 focus:border-trail/60"
      />
      {shown && (
        <ul id={`${id}-list`} role="listbox" aria-label="Matching files" className="absolute top-full left-0 z-20 mt-1 w-full rounded-[9px] border border-line bg-panel p-1 shadow-lg">
          {matches.length ? (
            matches.map((p, i) => (
              <li
                key={p}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={i === at}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`cursor-pointer truncate rounded px-2 py-1 font-mono text-[11.5px] ${i === at ? "bg-raised text-fg" : "text-fg-2"}`}
              >
                {p}
              </li>
            ))
          ) : (
            <li role="option" aria-selected={false} aria-disabled className="px-2 py-1 text-[12px] text-fg-3">
              No JavaScript, TypeScript, Python or Go file matches.
            </li>
          )}
        </ul>
      )}
      <span className="sr-only" aria-live="polite">
        {shown ? `${matches.length} ${matches.length === 1 ? "file matches" : "files match"}` : ""}
      </span>
    </div>
  );
}

/** The call graph as text: each function, who calls it and what it calls, every name a button to the code. */
function CallsList({ calls, onOpen, onFile }: { calls: Calls; onOpen: (spot: CodeSpot) => void; onFile: (path: string) => void }) {
  return (
    <div className="absolute inset-0 overflow-y-auto px-4 pt-3 pb-16">
      <h2 className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Functions in {calls.file}</h2>
      <ul className="mt-2 space-y-3">
        {calls.functions.map((f) => {
          const out = calls.calls.filter((c) => c.from === f.id && c.target);
          const inc = calls.callers.filter((c) => c.to === f.id);
          return (
            <li key={f.id} className="rounded-[10px] border border-line bg-panel px-3 py-2">
              <button onClick={() => onOpen({ file: calls.file, line: f.line })} className="font-mono text-[13px] text-fg hover:text-trail">
                {f.name} <span className="text-fg-3">line {f.line}</span>
              </button>
              {inc.length > 0 && (
                <p className="mt-1 text-[12.5px] text-fg-2">
                  Called from:{" "}
                  {inc.map((c, i) => (
                    <span key={`${c.file}:${c.line}`}>
                      {i > 0 && ", "}
                      <button onClick={() => onOpen({ file: c.file, line: c.line })} className="font-mono text-[12px] underline decoration-line underline-offset-2 hover:text-fg">
                        {c.file}:{c.line}
                      </button>
                    </span>
                  ))}
                </p>
              )}
              {out.length > 0 && (
                <p className="mt-1 text-[12.5px] text-fg-2">
                  Calls:{" "}
                  {out.map((c, i) => (
                    <span key={`${c.name}:${c.line}`}>
                      {i > 0 && ", "}
                      <button
                        onClick={() => (c.target!.file === calls.file ? onOpen({ file: c.target!.file, line: c.target!.line }) : onFile(c.target!.file))}
                        className="font-mono text-[12px] underline decoration-line underline-offset-2 hover:text-fg"
                        title={c.target!.file === calls.file ? `Open ${c.target!.name}` : `Show the calls of ${c.target!.file}`}
                      >
                        {c.target!.name}
                      </button>
                      {c.target!.file !== calls.file && <span className="text-fg-3"> ({c.target!.file})</span>}
                    </span>
                  ))}
                </p>
              )}
              {!inc.length && !out.length && <p className="mt-1 text-[12px] text-fg-3">No calls found to or from it in this repo.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
