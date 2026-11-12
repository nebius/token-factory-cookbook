// Checks every tour step against the real file. Line numbers from a model drift; the anchor line it copied
// doesn't, so the anchor decides where a step really is. Steps that can't be found are dropped, never shown.
import type { PullAnswer, PullFile, ReviewNote, Step, TourAnswer } from "@/lib/schemas";

const MAX_SPAN = 40;
const norm = (s: string) => s.replace(/^\s*\d+\|\s?/, "").trim().replace(/\s+/g, " ");

type NodeFiles = { id: string; files: string[] };

/** The repo path a model meant: exact, or the one file whose path ends with what it wrote. */
export function resolvePath(file: string, files: Map<string, string>): string | null {
  const clean = file.replace(/^\.?\//, "").replace(/^[\w.-]+\/[\w.-]+@[0-9a-f]+\//, "");
  if (files.has(clean)) return clean;
  const matches = [...files.keys()].filter((p) => p.endsWith(`/${clean}`));
  return matches.length === 1 ? matches[0] : null;
}

/** 1-based line of the anchor nearest to `near`, or null. Exact line match first, then containment. */
export function findAnchor(text: string, anchor: string, near: number): number | null {
  const target = norm(anchor);
  if (!target) return null;
  const lines = text.split("\n").map(norm);
  const pick = (hits: number[]) => (hits.length ? hits.reduce((best, h) => (Math.abs(h - near) < Math.abs(best - near) ? h : best)) : null);
  const exact = lines.flatMap((l, i) => (l === target ? [i + 1] : []));
  if (exact.length) return pick(exact);
  if (target.length < 8) return null;
  return pick(lines.flatMap((l, i) => (l.includes(target) || (l.length >= 12 && target.includes(l)) ? [i + 1] : [])));
}

/** The module a file belongs to: listed in it, or the one sharing the longest folder prefix. */
export function nodeForFile(file: string, nodes: NodeFiles[]): string | null {
  const listed = nodes.find((n) => n.files.includes(file));
  if (listed) return listed.id;
  let best: { id: string; score: number } | null = null;
  for (const n of nodes) {
    for (const f of n.files) {
      const a = f.split("/");
      const b = file.split("/");
      let i = 0;
      while (i < a.length - 1 && i < b.length - 1 && a[i] === b[i]) i++;
      if (!best || i > best.score) best = { id: n.id, score: i };
    }
  }
  return best?.id ?? nodes[0]?.id ?? null;
}

type Grounded = { steps: Step[]; corrected: number; dropped: number; problems: string[] };

export function groundSteps(steps: TourAnswer["steps"], files: Map<string, string>, nodes: NodeFiles[]): Grounded {
  const out: Step[] = [];
  const problems: string[] = [];
  let corrected = 0;
  let dropped = 0;
  const ids = new Set(nodes.map((n) => n.id));

  steps.forEach((s, i) => {
    const label = `Step ${i + 1} ("${s.title}")`;
    const path = resolvePath(s.file, files);
    if (!path) {
      problems.push(`${label}: "${s.file}" is not a file in this repository. Use an exact path from the file headers.`);
      dropped++;
      return;
    }
    const text = files.get(path)!;
    const total = text.split("\n").length;
    const at = findAnchor(text, s.anchor, s.startLine);
    if (at === null) {
      problems.push(`${label}: the anchor line "${s.anchor.slice(0, 120)}" doesn't appear in ${path}. Copy one line exactly as it is in the file.`);
      dropped++;
      return;
    }
    let start = Math.min(Math.max(1, Math.min(s.startLine, s.endLine)), total);
    let end = Math.min(Math.max(s.startLine, s.endLine), total);
    const span = Math.min(end - start + 1, MAX_SPAN);
    end = start + span - 1;
    let moved = path !== s.file || end !== Math.max(s.startLine, s.endLine);
    if (at < start || at > end) {
      // Keep the length the model chose, placed so the anchor sits in its first third.
      start = Math.max(1, at - Math.floor(span / 3));
      end = Math.min(total, start + span - 1);
      moved = true;
    }
    const node = ids.has(s.node) ? s.node : nodeForFile(path, nodes);
    if (node === null) {
      dropped++;
      return;
    }
    if (moved) corrected++;
    out.push({ ...s, node, file: path, startLine: start, endLine: end, corrected: moved });
  });

  return { steps: out, corrected, dropped, problems };
}

/**
 * The code as the pull request leaves it: the repo as read, minus deleted files and the old names of renamed
 * ones, with the PR's versions of changed files on top.
 */
export function overlayFiles(base: Map<string, string>, head: { path: string; text: string }[], changed: PullFile[]): Map<string, string> {
  const out = new Map(base);
  for (const f of changed) {
    if (f.status === "removed") out.delete(f.path);
    if (f.previous) out.delete(f.previous);
  }
  for (const f of head) out.set(f.path, f.text);
  return out;
}

/** A reviewer's note is "checked" when its file exists and the line it quoted is found there (then that line is used). */
export function checkReview(notes: PullAnswer["review"], files: Map<string, string>): ReviewNote[] {
  return notes.map((n) => {
    const path = n.file ? resolvePath(n.file, files) : null;
    const at = path && n.anchor ? findAnchor(files.get(path)!, n.anchor, n.line || 1) : null;
    return { kind: n.kind, text: n.text, file: path ?? (n.file || null), line: at ?? (n.line || null), checked: at !== null };
  });
}
