// Packs the repository into one block of text for the model: every file with numbered lines, in priority
// order, cut at the token budget. The text is identical for every call on the same commit, so Token
// Factory's prompt cache can serve it after the first calls.
import type { RepoFile } from "./github";
import { signatureBlock } from "./compress";
import type { ImportGraph } from "./graph";

/** Characters per token for numbered code: 3.3-3.5 measured on zustand and express, 3.15 on ky (test-heavy TS). */
const CHARS_PER_TOKEN = 3.2;
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

export type PackedFile = { path: string; lines: number; tokens: number };
export type Pack = {
  text: string;
  tokens: number;
  included: PackedFile[];
  /** Files that didn't fit whole, sent as signatures only (imports and declarations, real line numbers). */
  compressed: PackedFile[];
  /** Files left out entirely because even their signatures didn't fit. */
  overBudget: PackedFile[];
};

const TEST = /(^|\/)(tests?|__tests__|spec|specs|e2e|testing|testdata|fixtures?|__mocks__|mocks?)(\/|$)|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.go$/i;
const EXTRA = /(^|\/)(examples?|samples?|demos?|benchmarks?|bench|playground|scripts|tools|website|site|docs?\/(?!.*(architect|design|overview|internals)))(\/|$)/i;
const MANIFEST = /(^|\/)(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|setup\.py|pom\.xml|build\.gradle(\.kts)?|Gemfile|composer\.json|deno\.jsonc?|mix\.exs)$/;
const DOC = /\.(md|mdx|rst|txt|adoc)$/i;

/** Lower is read first. */
export function priorityOf(path: string, entries: Set<string>, fanIn: Map<string, number>): number {
  const depth = path.split("/").length - 1;
  if (/^readme\.(md|mdx|rst|txt)$/i.test(path)) return 0;
  if (TEST.test(path)) return 7;
  if (EXTRA.test(path) || path.startsWith(".github/")) return 6 + depth * 0.05;
  if (MANIFEST.test(path) && depth <= 2) return 1;
  if (entries.has(path)) return 2;
  if (/(^|\/)(ARCHITECTURE|DESIGN|INTERNALS|CONTRIBUTING|OVERVIEW)\.md$/i.test(path)) return 2.5;
  if (DOC.test(path)) return 5.5 + depth * 0.1;
  // Source: shallower and more-imported files first.
  return 3 + Math.min(depth, 8) * 0.15 - Math.min(fanIn.get(path) ?? 0, 20) * 0.05;
}

export const numbered = (f: RepoFile) =>
  `=== ${f.path} (${f.lines} lines) ===\n${f.text
    .split("\n")
    .map((line, i) => `${i + 1}| ${line}`)
    .join("\n")}\n`;

/**
 * Orders files by priority and packs as many as fit in `budgetTokens`. The order only depends on the files,
 * so the same commit always packs to the same text (and the same cache prefix).
 */
export function packRepo(files: RepoFile[], graph: ImportGraph, budgetTokens: number): Pack {
  const entries = new Set(graph.entries);
  const fanIn = new Map<string, number>();
  for (const [, to] of graph.edges) fanIn.set(to, (fanIn.get(to) ?? 0) + 1);

  const ranked = files
    .map((f) => ({ f, block: numbered(f), p: priorityOf(f.path, entries, fanIn) }))
    .sort((a, b) => a.p - b.p || a.f.path.localeCompare(b.f.path));

  const kept: typeof ranked = [];
  const rest: typeof ranked = [];
  let tokens = 0;
  for (const r of ranked) {
    const t = estimateTokens(r.block);
    if (tokens + t <= budgetTokens && rest.length === 0) {
      kept.push(r);
      tokens += t;
    } else {
      rest.push(r);
    }
  }
  // What didn't fit whole goes in as signatures, in the same priority order, while room remains.
  const compressedBlocks: string[] = [];
  const compressed: PackedFile[] = [];
  const overBudget: PackedFile[] = [];
  for (const r of rest) {
    const block = signatureBlock(r.f.path, r.f.text);
    const t = block ? estimateTokens(block) : 0;
    if (block && tokens + t <= budgetTokens) {
      compressedBlocks.push(block);
      compressed.push({ path: r.f.path, lines: r.f.lines, tokens: t });
      tokens += t;
    } else {
      overBudget.push({ path: r.f.path, lines: r.f.lines, tokens: estimateTokens(r.block) });
    }
  }
  const text = [...kept.map((r) => r.block), ...compressedBlocks].join("\n");
  return {
    text,
    tokens: estimateTokens(text),
    included: kept.map((r) => ({ path: r.f.path, lines: r.f.lines, tokens: estimateTokens(r.block) })),
    compressed,
    overBudget,
  };
}
