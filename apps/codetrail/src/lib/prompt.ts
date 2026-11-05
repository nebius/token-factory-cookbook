// "Copy as a prompt": what Codetrail knows about a repo, as Markdown to paste into any AI chat. The architecture as
// Mermaid, then what's in focus (a module with its links and the import lines behind them, a tour's steps, or an
// answer), every reference as file:line so the chat can be pointed at the code. No model call: built from the read.
import type { StoredAnswer } from "./answer-schema";
import { answerToMarkdown } from "./answer-md";
import { architectureSpec, type Files } from "./diagram";
import { atlasToMermaid } from "./export-map";
import { LOCAL_OWNER } from "./ref";
import type { Atlas, Tour } from "./schemas";

type At = { owner: string; repo: string; sha: string };
export type PromptFocus = { module: string } | { tour: Pick<Tour, "title" | "summary" | "steps"> } | { answer: StoredAnswer } | null;

const range = (file: string, start: number, end: number) => (start === end ? `${file}:${start}` : `${file}:${start}-${end}`);

export function promptFor(atlas: Pick<Atlas, "summary" | "nodes" | "edges">, at: At, focus: PromptFocus = null, files?: Files): string {
  const local = at.owner === LOCAL_OWNER;
  const where = local ? `the local folder "${at.repo}"` : `the GitHub repo ${at.owner}/${at.repo} (https://github.com/${at.owner}/${at.repo}/tree/${at.sha})`;
  const out = [`I'm working in ${where}, at commit ${at.sha.slice(0, 12)}.`, "", "## Architecture", "", atlas.summary, "", "```mermaid", atlasToMermaid(atlas), "```", ""];
  const label = new Map(atlas.nodes.map((n) => [n.id, n.label]));

  if (focus && "module" in focus) {
    const n = atlas.nodes.find((m) => m.id === focus.module);
    if (n) {
      out.push(`## Module: ${n.label}`, "", n.purpose, "", "Key files:", ...n.files.map((f) => `- ${f}`), "");
      const edges = architectureSpec(atlas, { files }).edges.filter((e) => e.from === n.id || e.to === n.id);
      if (edges.length) {
        out.push("Links:");
        for (const e of edges) {
          const other = e.from === n.id ? `uses ${label.get(e.to) ?? e.to}` : `used by ${label.get(e.from) ?? e.from}`;
          const proof = (e.evidence ?? []).slice(0, 3).map((v) => (v.line ? `${v.file}:${v.line}` : v.file));
          out.push(`- ${other}${e.label ? ` (${e.label})` : ""}: ${e.verified ? `confirmed by imports${proof.length ? ` at ${proof.join(", ")}` : ""}` : "inferred, not seen in imports"}`);
        }
        out.push("");
      }
    }
  } else if (focus && "tour" in focus) {
    const t = focus.tour;
    out.push(`## Tour: ${t.title}`, "");
    if (t.summary) out.push(t.summary, "");
    t.steps.forEach((s, i) => out.push(`${i + 1}. ${s.title}${s.file ? ` (${range(s.file, s.startLine, s.endLine)})` : ""}`, `   ${s.narration.replace(/\n+/g, " ")}`));
    out.push("");
  } else if (focus && "answer" in focus) {
    out.push("## An earlier answer about this code", "", answerToMarkdown(focus.answer, at).replace(/^# /m, "### "), "");
  }

  out.push("Read the files and lines above before answering, and cite file:line for anything you rely on.", "", "My question: ");
  return out.join("\n");
}
