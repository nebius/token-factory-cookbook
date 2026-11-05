// An answer as Markdown: its title and summary, each block in reading order (notes, tables, file lists, call
// sequences as Mermaid, code references linked at the commit with their lines), and what to ask next. Only
// references that held up when checked are linked.
import type { ElementNode } from "@openuidev/lang-core";
import { parseAnswer } from "./answer-lib";
import { refKey, type StoredAnswer } from "./answer-schema";
import { blobUrl, mdLink } from "./ref";
import { withModels } from "./models";

type At = { owner: string; repo: string; sha: string };
const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const fence = (lines: string[], file: string) => {
  const ext = file.split(".").pop() ?? "";
  const tick = lines.some((l) => l.includes("```")) ? "````" : "```";
  return [`${tick}${/^[a-z0-9]+$/i.test(ext) ? ext : ""}`, ...lines, tick];
};

/** `code` holds the text of files the answer points at, by path, to include the lines themselves. */
export function answerToMarkdown(answer: StoredAnswer, at: At, code: Record<string, string[]> = {}): string {
  const root = parseAnswer(answer.text).root as ElementNode | null;
  const props = (root?.props ?? {}) as { title?: string; summary?: string; blocks?: unknown[]; followUps?: string[] };
  const out: string[] = [`# ${props.title ?? answer.question}`, "", `> ${answer.question}`, ""];
  if (props.summary) out.push(props.summary, "");
  for (const b of props.blocks ?? []) {
    const el = b as ElementNode;
    if (!el || el.type !== "element") continue;
    const p = el.props as Record<string, unknown>;
    if (el.typeName === "Callout") out.push(`> **${p.tone === "warn" ? "Watch out" : "Note"}:** ${p.text ?? ""}`, "");
    else if (el.typeName === "Table") {
      const cols = (p.columns as string[]) ?? [];
      const rows = (p.rows as unknown[][]) ?? [];
      if (cols.length) out.push(`| ${cols.map(cell).join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${cols.map((_, i) => cell(r?.[i])).join(" | ")} |`), "");
    } else if (el.typeName === "FileList") {
      for (const item of (p.items as { path?: string; why?: string }[]) ?? []) {
        const real = item.path ? answer.checks.files[item.path] : null;
        out.push(`- ${real ? mdLink(`\`${real}\``, blobUrl(at.owner, at.repo, at.sha, real)) : `\`${item.path ?? ""}\``}: ${item.why ?? ""}`);
      }
      out.push("");
    } else if (el.typeName === "Sequence") {
      const steps = (p.steps as { from?: string; to?: string; message?: string }[]) ?? [];
      out.push(...steps.map((s, i) => `${i + 1}. ${s.from} → ${s.to}: ${s.message}`), "");
      const actor = (s: string | undefined) => (s ?? "?").replace(/[^\w]/g, "_");
      out.push("```mermaid", "sequenceDiagram", ...steps.map((s) => `  ${actor(s.from)}->>${actor(s.to)}: ${(s.message ?? "").replace(/[;#\n]/g, " ")}`), "```", "");
    } else if (el.typeName === "CodeRef" && typeof p.file === "string" && typeof p.startLine === "number") {
      const checked = answer.checks.refs[refKey(p.file, p.startLine)];
      if (!checked) {
        out.push(`- \`${p.file}:${p.startLine}\` (not found in the code, left unlinked): ${p.note ?? ""}`, "");
        continue;
      }
      out.push(`${mdLink(`\`${checked.file}:${checked.startLine}-${checked.endLine}\``, blobUrl(at.owner, at.repo, at.sha, checked.file, checked.startLine, checked.endLine))}: ${p.note ?? ""}`, "");
      const lines = code[checked.file]?.slice(checked.startLine - 1, checked.endLine);
      if (lines?.length) out.push(...fence(lines, checked.file), "");
    }
  }
  if (props.followUps?.length) out.push("## Ask next", "", ...props.followUps.map((q) => `- ${q}`), "");
  out.push(`Answered by Codetrail${withModels(answer.calls)} at commit ${at.sha.slice(0, 7)}; every linked reference was checked against the code.`);
  return out.join("\n");
}

/** The files an answer's checked code references point at, to fetch before exporting. */
export const answerFiles = (answer: StoredAnswer) => [...new Set(Object.values(answer.checks.refs).flatMap((r) => (r ? [r.file] : [])))];
