// Tours that follow the code: when a newer commit of a repo is read, every tour of the previous read is brought
// over and checked again. A step whose quoted line is still there moves with it; a step whose line is gone stays,
// marked stale, at its old place. Free (no model call), and CodeTour's own drift warning, done for you.
import { onCode, type Step, type Tour } from "@/lib/schemas";
import { findAnchor, nodeForFile } from "./ground";

type NodeFiles = { id: string; files: string[] };

/** One step at the new commit. `oldText` is its file at the old commit, to place the quoted line inside the range. */
function carryStep(s: Step, oldText: string | undefined, newText: string | undefined, nodes: NodeFiles[]): Step & { moved?: boolean } {
  if (!onCode(s)) return s;
  const { stale: _stale, ...step } = s;
  const node = nodeForFile(s.file, nodes) ?? s.node;
  if (newText === undefined) return { ...step, node, stale: true };
  const lines = newText.split("\n");
  const span = s.endLine - s.startLine;
  // The same lines, unchanged: nothing to do.
  if (oldText !== undefined && oldText.split("\n").slice(s.startLine - 1, s.endLine).join("\n") === lines.slice(s.startLine - 1, s.endLine).join("\n")) return { ...step, node };
  const oldAt = (oldText !== undefined ? findAnchor(oldText, s.anchor, s.startLine) : null) ?? s.startLine;
  const at = findAnchor(newText, s.anchor, oldAt);
  // Gone: shown where it was, kept inside the file.
  if (at === null) return { ...step, node, stale: true, startLine: Math.min(s.startLine, lines.length), endLine: Math.min(s.endLine, lines.length) };
  const start = Math.max(1, Math.min(lines.length, at - (oldAt - s.startLine)));
  const end = Math.min(lines.length, start + span);
  return start === s.startLine && end === s.endLine ? { ...step, node } : { ...step, node, startLine: start, endLine: end, moved: true };
}

/** A tour of the old commit, as it reads at the new one. */
export function carryTour(tour: Tour, oldFiles: Map<string, string>, newFiles: Map<string, string>, nodes: NodeFiles[], fromSha: string): Tour {
  let moved = 0;
  let stale = 0;
  const steps = tour.steps.map((s) => {
    const { moved: m, ...next } = carryStep(s, oldFiles.get(s.file), newFiles.get(s.file), nodes);
    if (m) moved++;
    if (next.stale) stale++;
    return next;
  });
  return { ...tour, steps, carriedFrom: { sha: fromSha, moved, stale } };
}
