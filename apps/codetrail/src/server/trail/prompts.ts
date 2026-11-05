// The prompts. The system prompt and the repo message are the same for every call on a commit (the cached
// prefix); only the task message at the end changes.
import type { PullFacts, PullFile } from "@/lib/schemas";
import type { Content, Message } from "@/server/ai/nebius";
import { skipReason } from "@/server/repo/filter";
import type { RepoFile, RepoImage, RepoInfo } from "@/server/repo/github";
import { estimateTokens, numbered, priorityOf, type Pack } from "@/server/repo/pack";

const SYSTEM = `You are Codetrail. You explain codebases to developers who are new to them, by mapping the modules and walking through how the code actually runs.

You get a whole repository: every file under a "=== path (N lines) ===" header, with each line prefixed by its number ("12| "). Line numbers are not part of the code.

Rules:
- Only use file paths that appear in a header. Never invent files, functions or behaviour.
- Base every claim on code you can see. If something isn't in the files you were given, leave it out.
- Line ranges must point at the code you describe, and anchors must be copied exactly from inside that range.
- Write plainly and concretely for a developer: name the function, what it receives, and what it hands on. No filler words such as "seamlessly", "robust" or "leverages".`;

export function repoPrefix(info: RepoInfo, pack: Pack, graphSummary: string, images: RepoImage[], skippedCount: number): Message[] {
  const langs = Object.entries(info.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([l]) => l)
    .join(", ");
  const header = [
    `Repository: ${info.owner}/${info.repo} at commit ${info.sha} (${info.ref})`,
    info.description ? `Description: ${info.description}` : "",
    langs ? `Languages: ${langs}` : "",
    `Files included below: ${pack.included.length} in full${pack.compressed.length ? `, then ${pack.compressed.length} as "signatures only" (imports and declarations with their real line numbers; "…" marks code left out)` : ""}. Not included: ${pack.overBudget.length} lower-priority files over the size budget, ${skippedCount} lockfiles, generated, binary or credential-like files.`,
    pack.overBudget.length ? `Files not included (over budget, first 60): ${pack.overBudget.slice(0, 60).map((f) => f.path).join(", ")}` : "",
    "",
    "Import graph worked out from the code (not by a model):",
    graphSummary,
    images.length ? `\nImages from the repository follow (${images.map((i) => i.path).join(", ")}). Use them if they show the architecture.` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  const content: Content = [
    { type: "text", text: header },
    ...images.map((img) => ({ type: "image_url" as const, image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
    { type: "text", text: `\n${pack.text}` },
  ];
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content },
  ];
}

const STEP_RULES = `Follow the code in the order it runs, from where the flow starts to where it ends, in 4-12 steps. Each step is one place in one file, and only steps on this path belong in the tour.

For every step:
- file: an exact path from a header.
- startLine/endLine: the lines that matter, at most 40.
- anchor: one distinctive line copied exactly from inside that range (a function signature or a key call), without the "12| " prefix.
- narration: 1-2 sentences on what happens here and what it hands to the next step.
- summary: answer the question in one or two sentences (under 50 words).`;

export const ATLAS_TASK = `Map this repository, then walk through its main flow.

1. summary: what it is and how it is built, in 2-3 sentences.
2. nodes: split the code into 4-14 modules a developer would recognise (by responsibility, not by folder alone). List each module's most important files with exact paths, and the architecture layer it sits in (3-6 layers, like the boxes on an architecture diagram).
3. edges: which modules call, import or feed which. Prefer connections the import graph confirms; add runtime ones (HTTP, events, queues) only when the code shows them.
4. tours: 3-5 concrete questions a newcomer would ask, answered by following the code, e.g. "What happens when a request hits the server?" or "How does a CLI command run end to end?". The first one is the main flow of the project. Write only the question (under 20 words).
5. firstTour: the guided tour that answers the first question in tours. Use the module ids from nodes.

${STEP_RULES}

Keep the map short: it's a map, not documentation.`;

export function tourTask(question: string, nodes: { id: string; label: string; files: string[] }[]): string {
  return `Build a guided tour that answers: "${question}"

Module ids to use for "node":
${nodes.map((n) => `- ${n.id} (${n.label}): ${n.files.slice(0, 4).join(", ")}`).join("\n")}

${STEP_RULES}

If the repository doesn't contain code that answers the question, return 2 steps pointing at the closest relevant code and say so in the summary.`;
}

// --- Pull requests ------------------------------------------------------------------------------------------
const NONE = new Set<string>();
const NO_FAN_IN = new Map<string, number>();
const prRank = (path: string) => (/\.(md|mdx|rst|txt|adoc)$/i.test(path) ? 6 : priorityOf(path, NONE, NO_FAN_IN));

/** Changed files worth reading whole at the PR's head: source before docs and tests, bigger changes first. */
export function rankChanged(files: PullFile[]): PullFile[] {
  return files
    .filter((f) => f.status !== "removed" && !skipReason(f.path, 0))
    .sort((a, b) => prRank(a.path) - prRank(b.path) || b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path));
}

const STATUS: Record<string, string> = { added: "A", removed: "D", modified: "M", renamed: "R", copied: "C", changed: "M" };

/**
 * The task for a PR tour, sent after the cached repo: the PR's description, its changed files, the patches (up to
 * `patchTokens`, most useful files first) and the PR's versions of changed files with line numbers.
 */
export function pullTask(facts: PullFacts, readAt: { sha: string; ref: string }, head: RepoFile[], nodes: { id: string; label: string; files: string[] }[], patchTokens = 120_000) {
  const ranked = rankChanged(facts.files);
  const order = [...ranked, ...facts.files.filter((f) => !ranked.includes(f))];
  const patches: string[] = [];
  const left: string[] = [];
  let used = 0;
  for (const f of order) {
    if (!f.patch) continue;
    const t = estimateTokens(f.patch);
    if (used + t > patchTokens) {
      left.push(f.path);
      continue;
    }
    used += t;
    patches.push(`--- ${f.path}${f.previous ? ` (renamed from ${f.previous})` : ""}\n${f.patch}`);
  }
  const fork = facts.headRepo && facts.headRepo.toLowerCase() !== facts.htmlUrl.split("/").slice(3, 5).join("/").toLowerCase() ? ` from the fork ${facts.headRepo}` : "";
  const text = `Explain pull request #${facts.number} to a reviewer who is new to this repository, as a guided tour through the change.

PR #${facts.number}: "${facts.title}" by ${facts.author} (${facts.state}${facts.draft ? ", draft" : ""}), +${facts.additions} −${facts.deletions} in ${facts.changedFiles} files.
It merges ${facts.headSha.slice(0, 7)}${fork} into ${facts.baseRef} (${facts.baseSha.slice(0, 7)}).
The repository above is at ${readAt.sha.slice(0, 7)} (${readAt.ref}), which may be older or newer than the PR's base. For the changed files, the PR's versions below are the truth.
${facts.body ? `\nThe author's description (a claim: check it against the code):\n"""\n${facts.body.slice(0, 2_000)}\n"""\n` : ""}
Changed files:
${facts.files.map((f) => `${STATUS[f.status] ?? "M"} ${f.previous ? `${f.previous} → ` : ""}${f.path} (+${f.additions} −${f.deletions})${f.patch ? "" : " [no text diff: binary or too large]"}`).join("\n")}

=== The patches ===
${patches.join("\n\n")}
${left.length ? `\n(Patches left out to fit: ${left.join(", ")})\n` : ""}
=== The PR's version of changed files (line numbers are the PR's) ===
${head.length ? head.map(numbered).join("\n") : "(Not available: use the patches.)"}

Module ids to use for "node":
${nodes.map((n) => `- ${n.id} (${n.label}): ${n.files.slice(0, 4).join(", ")}`).join("\n")}

What to write:
- title and summary: what the PR changes and why, as the code shows it. Say so if the description claims something the code doesn't do.
- steps: follow the changed code in the order it runs. A step points at the PR's version of a changed file (its line numbers from the section above) or at unchanged code in the repository that the change plugs into.
  For every step: file is an exact path (from a header above), startLine/endLine cover at most 40 lines, anchor is one distinctive line copied exactly from inside that range without the "12| " prefix, and narration is 1-2 sentences on what the code does and what the PR changed there.
- review: what a careful reviewer would flag (risks, missing tests, unclear intent, small cleanups), each tied to a file and a line it quotes. Don't invent problems.
- modules: ids of the modules the PR changes or affects.`;
  return { text, tokens: estimateTokens(text), sent: { head: head.length, patches: patches.length, left } };
}
