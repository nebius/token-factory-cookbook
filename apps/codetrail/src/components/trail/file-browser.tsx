"use client";

// Every file the model read, as a folder tree with token badges and module dots, plus search over paths and
// contents. Picking a result opens it in the code panel at that line.
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTokens } from "@/lib/format";
import { groupsOf } from "@/lib/architecture";
import { SUPPORT } from "@/lib/palette";
import type { Atlas, RepoSummary } from "@/lib/schemas";
import { nodeForFile } from "@/server/trail/ground";

type Hit = { path: string; line: number | null; text: string };
type FileEntry = { name: string; path: string; tokens: number; status?: "signatures" | "left out" };
type Dir = { name: string; path: string; dirs: Map<string, Dir>; files: FileEntry[]; tokens: number };

/** Every text file in the commit: the ones sent whole (with token counts) and the rest, marked. */
function buildTree(sizes: RepoSummary["fileSizes"], others: RepoSummary["otherFiles"]): Dir {
  const root: Dir = { name: "", path: "", dirs: new Map(), files: [], tokens: 0 };
  const entries: [string, number, FileEntry["status"]][] = [...sizes.map(([p, , t]) => [p, t, undefined] as [string, number, undefined]), ...(others ?? []).map(([p, , st]) => [p, 0, st] as [string, number, FileEntry["status"]])];
  for (const [path, tokens, status] of entries) {
    const parts = path.split("/");
    let d = root;
    d.tokens += tokens;
    for (const part of parts.slice(0, -1)) {
      if (!d.dirs.has(part)) d.dirs.set(part, { name: part, path: d.path ? `${d.path}/${part}` : part, dirs: new Map(), files: [], tokens: 0 });
      d = d.dirs.get(part)!;
      d.tokens += tokens;
    }
    d.files.push({ name: parts.at(-1)!, path, tokens, status });
  }
  return root;
}

export function FileBrowser({ summary, atlas, onOpen, onClose, tall }: { summary: RepoSummary; atlas: Atlas; onOpen: (path: string, line?: number) => void; onClose: () => void; tall?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tree = useMemo(() => buildTree(summary.fileSizes, summary.otherFiles), [summary]);
  const total = summary.fileSizes.length + (summary.otherFiles?.length ?? 0);
  const colorOf = useMemo(() => {
    const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
    const color = groupsOf(atlas.nodes).color;
    return (path: string) => color.get(nodeForFile(path, nodes) ?? "") ?? SUPPORT;
  }, [atlas]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?${new URLSearchParams({ owner: summary.owner, repo: summary.repo, sha: summary.sha, ...(summary.scope ? { scope: summary.scope } : {}), q: q.trim() })}`)
        .then((r) => r.json())
        .then((d: { hits?: Hit[] }) => setHits(d.hits ?? []))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q, summary]);

  return (
    <div
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className={`flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-panel ${tall ? "max-h-[60vh]" : "max-h-[34vh]"}`}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="size-3.5 shrink-0 text-fg-3" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search all ${total} files by path or code`}
          aria-label="Search files"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-3"
        />
        {loading && <span className="font-mono text-[10.5px] text-fg-3">…</span>}
        <button onClick={onClose} aria-label="Close" className="rounded p-0.5 text-fg-3 hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[12px]">
        {hits ? (
          hits.length === 0 ? (
            <p className="px-3 py-2 text-fg-3">No matches in this commit&apos;s files.</p>
          ) : (
            hits.map((h, i) => (
              <button key={i} onClick={() => onOpen(h.path, h.line ?? undefined)} className="block w-full px-3 py-1.5 text-left hover:bg-raised">
                <span className="flex items-center gap-2 text-fg-2">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf(h.path) }} />
                  <span className="truncate">{h.path}</span>
                  {h.line && <span className="shrink-0 text-trail">:{h.line}</span>}
                </span>
                {h.line && <span className="mt-0.5 block truncate pl-3.5 text-fg-3">{h.text}</span>}
              </button>
            ))
          )
        ) : (
          <TreeDir dir={tree} depth={0} open colorOf={colorOf} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}

function TreeDir({ dir, depth, open: initial, colorOf, onOpen }: { dir: Dir; depth: number; open?: boolean; colorOf: (p: string) => string; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(!!initial);
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      {depth > 0 && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1 py-1 pr-3 text-left text-fg-2 hover:bg-raised" style={{ paddingLeft: 8 + (depth - 1) * 14 }}>
          <ChevronRight className={`size-3 shrink-0 transition ${open ? "rotate-90" : ""}`} aria-hidden />
          <span className="truncate">{dir.name}/</span>
          <span className="ml-auto shrink-0 text-[10.5px] text-fg-3">{formatTokens(dir.tokens)}</span>
        </button>
      )}
      {open && (
        <>
          {dirs.map((d) => (
            <TreeDir key={d.path} dir={d} depth={depth + 1} colorOf={colorOf} onOpen={onOpen} />
          ))}
          {files.map((f) => (
            <button key={f.path} onClick={() => onOpen(f.path)} className="flex w-full items-center gap-2 py-1 pr-3 text-left text-fg-2 hover:bg-raised hover:text-fg" style={{ paddingLeft: 12 + depth * 14 }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf(f.path) }} />
              <span className={`truncate ${f.status ? "text-fg-3" : ""}`}>{f.name}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-fg-3" title={f.status === "signatures" ? "Sent to the model as signatures only" : f.status ? "Not sent to the model; still browsable here" : "Sent to the model in full"}>
                {f.status === "signatures" ? "signatures" : f.status ? "not sent" : formatTokens(f.tokens)}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
