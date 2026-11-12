// A repo's read as one Markdown page, for AI tools and anyone who wants plain text (like GitDiagram's .md pages):
// the summary, the architecture as Mermaid, the modules, every tour step by step, the docs and the answers. Built
// only from what's stored, so it's free and needs neither GitHub nor the model.
import type { StoredAnswer } from "@/lib/answer-schema";
import { answerToMarkdown } from "@/lib/answer-md";
import { architectureSpec, neighbourhoodSpec, specToMermaid } from "@/lib/diagram";
import { docsToMarkdown, type Docs } from "@/lib/docs-schema";
import { atlasToMermaid } from "@/lib/export-map";
import { formatTokens } from "@/lib/format";
import { blobUrl, mdLink } from "@/lib/ref";
import { onCode, type Atlas, type RepoSummary, type Tour, type TourIndexEntry } from "@/lib/schemas";
import type { RepoInfo } from "@/server/repo/github";
import { getJSON } from "@/server/store";
import { storeKey, type ReadEntry } from "./service";
import { withModels } from "@/lib/models";

type At = { owner: string; repo: string; sha: string };

export async function repoMarkdown(at: At, site: string, summary?: Pick<RepoSummary, "fileSizes" | "imports" | "importLines" | "files" | "tokens" | "modelLabel">): Promise<string | null> {
  const commit = storeKey(at.owner, at.repo, at.sha);
  const [info, atlas, index, docs, answers] = await Promise.all([
    getJSON<RepoInfo>(`${commit}/info.json`),
    getJSON<Atlas>(`${commit}/atlas.json`),
    getJSON<TourIndexEntry[]>(`${commit}/tours.json`),
    getJSON<Docs>(`${commit}/docs.json`),
    getJSON<{ id: string; question: string; title: string }[]>(`${commit}/answers.json`),
  ]);
  if (!info || !atlas) return null;
  const tours = (await Promise.all((index ?? []).map((t) => getJSON<Tour>(`${commit}/tours/${t.id}.json`)))).filter((t): t is Tour => !!t);
  const link = (file: string, a?: number, b?: number) => mdLink(`\`${file}${a ? `:${a}${b && b !== a ? `-${b}` : ""}` : ""}\``, blobUrl(at.owner, at.repo, at.sha, file, a, b));
  const page = `${site.replace(/\/$/, "")}/${at.owner}/${at.repo}`;

  const out: string[] = [
    `# ${at.owner}/${at.repo}`,
    "",
    `> Read by Codetrail${withModels([atlas.call])} at commit \`${at.sha.slice(0, 7)}\`${info.ref ? ` (${info.ref})` : ""}. Every file and line reference below was checked against the code. Interactive version: ${page}`,
    "",
    info.description ?? "",
    "",
    atlas.summary,
    "",
    ...(atlas.stack.length ? [`Stack: ${atlas.stack.join(", ")}`, ""] : []),
    ...(summary ? [`The model read ${summary.files.read} of ${summary.files.total} files (about ${formatTokens(summary.tokens)} tokens) in one prompt.`, ""] : []),
    "## Architecture",
    "",
    "```mermaid",
    summary ? specToMermaid(architectureSpec(atlas)) : atlasToMermaid(atlas, at),
    "```",
    "",
    "## Modules",
    "",
    ...atlas.nodes.flatMap((n) => [`### ${n.label}`, "", `${n.layer ? `Layer: ${n.layer}. ` : ""}${n.purpose}`, "", ...n.files.map((f) => `- ${link(f)}`), ""]),
    "## How the modules connect",
    "",
    ...atlas.edges.map((e) => `- ${atlas.nodes.find((n) => n.id === e.from)?.label ?? e.from} → ${atlas.nodes.find((n) => n.id === e.to)?.label ?? e.to}: ${e.label.replace(/`/g, "")}${e.verified ? " (confirmed by imports)" : " (inferred)"}`),
    "",
  ];
  if (tours.length) {
    out.push("## Tours", "");
    for (const t of tours) {
      out.push(`### ${t.title}`, "", `> ${t.question}`, "", ...(t.summary ? [t.summary, ""] : []));
      t.steps.forEach((s, i) => out.push(`${i + 1}. **${s.title}**${onCode(s) ? ` (${link(s.file, s.startLine, s.endLine)})` : ""}: ${s.narration}`));
      out.push("", `Open it step by step: ${page}?tour=${t.id}`, "");
    }
  }
  if (docs?.pages.length) {
    const diagrams = summary ? Object.fromEntries(docs.pages.map((p) => [p.node, specToMermaid(neighbourhoodSpec(atlas, summary, p.node))])) : undefined;
    out.push("## Docs", "", docsToMarkdown(docs, at, diagrams).replace(/^# .*\n/, "").replace(/^## /gm, "### ").replace(/^### (Key files|Where to look)$/gm, "#### $1"), "");
  }
  if (answers?.length) {
    out.push("## Questions answered", "");
    for (const a of answers) {
      const stored = await getJSON<StoredAnswer>(`${commit}/answers/${a.id}.json`);
      if (stored) out.push(answerToMarkdown(stored, at).replace(/^# /, "### ").replace(/^## /gm, "#### "), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The site's index for AI tools: every public read, with its Markdown page. */
export function llmsTxt(reads: ReadEntry[], site: string): string {
  const root = site.replace(/\/$/, "");
  return [
    "# Codetrail",
    "",
    "> Architecture maps, checked code tours, docs and answers for code repositories, each read whole by one open model. Every file and line reference is checked against the code.",
    "",
    "## Repositories",
    "",
    ...reads.filter((r) => !r.private && !r.scope).map((r) => `- [${r.owner}/${r.repo}](${root}/${r.owner}/${r.repo}.md): ${r.description ?? "no description"} (${r.modules} modules, ${r.tours} ${r.tours === 1 ? "tour" : "tours"}${r.docs ? ", docs" : ""})`),
    "",
  ].join("\n");
}
