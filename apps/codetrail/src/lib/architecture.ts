// How the module map is drawn as an architecture diagram: modules grouped into layers (the model names them on
// each read; older reads fall back to grouping by kind), one colour per group, and each module's home folder.
import { PALETTE, SUPPORT } from "./palette";
import type { Atlas } from "./schemas";

type Node = Pick<Atlas["nodes"][number], "id" | "label" | "kind" | "files"> & { layer?: string };

const KIND_TITLE: Record<string, string> = {
  entry: "Entry points",
  interface: "Interfaces",
  core: "Core",
  data: "Data",
  integration: "Integrations",
  ui: "User interface",
  config: "Config",
  tooling: "Tooling",
  tests: "Tests",
  docs: "Docs",
};
// Supporting groups go last and share the grey, so the palette's hues go to the code that runs.
const SUPPORTING = /build|test|tool|doc|example|bench|script|\bci\b|config/i;

type Group = { id: string; title: string; color: string; nodes: string[] };

/** Layers when the read named them, else kinds when there's more than one, else a single unnamed group. */
export function groupsOf(nodes: Node[]): { by: "layer" | "kind" | null; groups: Group[]; color: Map<string, string> } {
  const by = nodes.some((n) => n.layer?.trim()) ? "layer" : new Set(nodes.map((n) => n.kind)).size > 1 ? "kind" : null;
  const keyOf = (n: Node) => (by === "layer" ? n.layer?.trim() || "Other" : by === "kind" ? n.kind : "");
  const acc = new Map<string, string[]>();
  for (const n of nodes) acc.set(keyOf(n), [...(acc.get(keyOf(n)) ?? []), n.id]);
  const keys = [...acc.keys()];
  const supporting = (k: string) => !!by && SUPPORTING.test(k);
  const main = keys.filter((k) => !supporting(k));
  // Fixed order, never cycled: past the palette, groups fold into the grey.
  const groups: Group[] = [...main, ...keys.filter(supporting)].map((k) => ({
    id: k || "all",
    title: by === "kind" ? (KIND_TITLE[k] ?? k) : k,
    color: !by ? PALETTE[0] : supporting(k) ? SUPPORT : (PALETTE[main.indexOf(k)] ?? SUPPORT),
    nodes: acc.get(k)!,
  }));
  const color = new Map(groups.flatMap((g) => g.nodes.map((id) => [id, g.color] as const)));
  return { by, groups, color };
}

/** The deepest folder most of a module's files sit in ("src/router/"), or "" for the repository root. */
export function homeOf(files: string[]): string {
  const count = new Map<string, number>();
  for (const f of files) {
    const parts = f.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = `${parts.slice(0, i).join("/")}/`;
      count.set(dir, (count.get(dir) ?? 0) + 1);
    }
  }
  const enough = [...count].filter(([, n]) => n * 2 > files.length);
  return enough.sort((a, b) => b[0].split("/").length - a[0].split("/").length || b[1] - a[1])[0]?.[0] ?? "";
}

/** An edge label as plain words: no code ticks, no trailing ellipsis from clamping. */
export const plainLabel = (s: string) => s.replace(/`/g, "").replace(/\s*…$/, "").trim();
