// Written docs (wiki-style), one page per module, in one structured call on the cached repo prefix. Every key
// file and code reference is checked against the commit; the result is stored and replays for free.
import { docsJsonSchema, docsSchema, type DocPage, type Docs } from "@/lib/docs-schema";
import type { Atlas } from "@/lib/schemas";
import { chatJSON } from "@/server/ai/nebius";
import { getJSON, putJSON } from "@/server/store";
import { groundSteps, resolvePath } from "./ground";
import { checkLimitsFor, commitKey, shared, trackedCall, type Prepared } from "./service";

const key = (p: Prepared) => `${commitKey(p)}/docs.json`;
export const getStoredDocs = (p: Prepared) => getJSON<Docs>(key(p));

const task = (atlas: Atlas) => `Write developer documentation for this repository: one page per module below, in this order.

Modules (id: label, purpose, key files):
${atlas.nodes.map((n) => `- ${n.id}: ${n.label}. ${n.purpose} Files: ${n.files.slice(0, 6).join(", ")}`).join("\n")}

For each page: an overview of what the module is for and how the rest of the code uses it; 2-4 short sections (how it works, key concepts, extending it, gotchas: whichever apply); its key files with their role; and 1-4 code references with an exact anchor line copied from inside the range. Only state what the code shows. Plain, concrete language for a developer new to the repo.`;

export async function getDocs(p: Prepared, atlas: Atlas, who: string): Promise<{ docs: Docs; fromCache: boolean }> {
  const stored = await getStoredDocs(p);
  if (stored) return { docs: stored, fromCache: true };
  return shared(`${commitKey(p)}/docs`, () => writeDocs(p, atlas, who));
}

async function writeDocs(p: Prepared, atlas: Atlas, who: string): Promise<{ docs: Docs; fromCache: boolean }> {
  await checkLimitsFor(who, "asks");

  const { result, record } = await trackedCall(p, "ask", "Write the docs", (cfg) =>
    chatJSON(cfg, {
      prefix: p.prefix,
      task: task(atlas),
      schema: docsSchema,
      jsonSchema: docsJsonSchema,
      name: "codetrail_docs",
      cacheKey: `codetrail:${p.info.owner}/${p.info.repo}@${p.info.sha}`,
      effort: "medium",
      maxTokens: 32_000,
    }),
  );

  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const known = new Set(atlas.nodes.map((n) => n.id));
  const pages: DocPage[] = result.pages
    .filter((page) => known.has(page.node))
    .map((page) => ({
      ...page,
      keyFiles: page.keyFiles.map((f) => {
        const path = resolvePath(f.path, p.files);
        return { path: path ?? f.path, role: f.role, ok: !!path };
      }),
      refs: page.refs.map((r) => {
        const g = groundSteps([{ node: page.node, title: "", file: r.file, startLine: r.startLine, endLine: r.endLine, anchor: r.anchor, narration: "" }], p.files, nodes).steps[0];
        return g ? { ...r, file: g.file, startLine: g.startLine, endLine: g.endLine, ok: true, corrected: g.corrected } : { ...r, ok: false, corrected: false };
      }),
    }));
  const docs: Docs = { pages, calls: [record], at: Date.now() };
  await putJSON(key(p), docs);
  return { docs, fromCache: false };
}
