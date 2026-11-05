"use client";

// Written docs, wiki-style: one page per module, with checked key files and code references that open in the
// code panel, and the whole set downloadable as Markdown.
import { Check, CornerUpRight, Download, Presentation, X } from "lucide-react";
import { Rich } from "@/components/rich";
import { docsToMarkdown, type Docs } from "@/lib/docs-schema";
import { useEffect, useMemo } from "react";
import { DiagramView } from "@/components/trail/diagram-view";
import { neighbourhoodSpec, specToMermaid } from "@/lib/diagram";
import { groupsOf } from "@/lib/architecture";
import { SUPPORT } from "@/lib/palette";
import type { Atlas, RepoSummary } from "@/lib/schemas";

type Props = {
  docs: Docs;
  atlas: Atlas;
  summary: RepoSummary;
  page: string;
  onPage: (node: string) => void;
  onOpen: (file: string, start?: number, end?: number) => void;
  onClose: () => void;
};

function save(text: string, type: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** All the docs, or one page, as Markdown with each page's diagram; or all of it as JSON. */
function download(docs: Docs, atlas: Atlas, summary: RepoSummary, what: "all" | "json" | string) {
  if (what === "json") return save(JSON.stringify({ repo: `${summary.owner}/${summary.repo}`, commit: summary.sha, pages: docs.pages }, null, 2), "application/json", `${summary.repo}-docs.json`);
  const pages = what === "all" ? docs : { ...docs, pages: docs.pages.filter((p) => p.node === what) };
  const diagrams = Object.fromEntries(pages.pages.map((p) => [p.node, specToMermaid(neighbourhoodSpec(atlas, summary, p.node))]));
  save(docsToMarkdown(pages, summary, diagrams), "text/markdown", what === "all" ? `${summary.repo}-docs.md` : `${summary.repo}-${what}.md`);
}

export function DocsView({ docs, atlas, summary, page, onPage, onOpen, onClose }: Props) {
  const p = docs.pages.find((x) => x.node === page) ?? docs.pages[0];
  const colorOf = groupsOf(atlas.nodes).color;
  const node = p?.node;
  const spec = useMemo(() => (node ? neighbourhoodSpec(atlas, summary, node) : null), [atlas, summary, node]);
  // Esc closes the docs, unless something on top of them (a dialog, a menu) is taking it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog]") && !(e.target as HTMLElement | null)?.closest?.("input, textarea, [role=menu]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!p) return null;
  return (
    <article aria-labelledby="doc-title">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Docs · {docs.pages.length} pages</p>
        <span className="flex items-center gap-1">
          {[
            { what: p.node, label: "This page", title: "This page as Markdown, with its diagram" },
            { what: "all", label: "All · .md", title: "Every page as one Markdown file, with diagrams" },
            { what: "json", label: ".json", title: "Every page as JSON" },
          ].map((x) => (
            <button key={x.label} onClick={() => download(docs, atlas, summary, x.what)} title={x.title} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] text-fg-2 hover:border-outline hover:text-fg">
              <Download className="size-3" /> {x.label}
            </button>
          ))}
          {!summary.scope && (
            <a href={`/${summary.owner}/${summary.repo}/slides?sha=${summary.sha}`} title="The architecture, every module and the main tour as slides" className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] text-fg-2 hover:border-outline hover:text-fg">
              <Presentation className="size-3" /> Slides
            </a>
          )}
          <button onClick={onClose} aria-label="Close the docs" className="rounded p-1 text-fg-3 hover:text-fg">
            <X className="size-3.5" />
          </button>
        </span>
      </div>
      <nav aria-label="Doc pages" className="mt-2 flex flex-wrap gap-1.5">
        {docs.pages.map((x) => (
          <button
            key={x.node}
            onClick={() => onPage(x.node)}
            aria-current={x.node === p.node ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${x.node === p.node ? "border-trail/60 bg-trail-soft text-fg" : "border-line text-fg-2 hover:border-outline"}`}
          >
            <span className="size-1.5 rounded-full" style={{ background: colorOf.get(x.node) ?? SUPPORT }} />
            {x.title}
          </button>
        ))}
      </nav>

      <h2 id="doc-title" className="mt-4 font-display text-[24px] leading-[1.08] font-medium tracking-[-0.03em] [font-stretch:82%]">
        {p.title}
      </h2>
      <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">
        <Rich text={p.overview} />
      </p>
      {spec && spec.boxes.length > 1 && (
        <figure className="mt-4">
          <div className="relative h-[300px] overflow-hidden rounded-card border border-line dot-grid">
            <DiagramView
              key={p.node}
              compact
              spec={spec}
              ariaLabel={`${p.title}: its files, their imports, and the modules it links to. Enter on a file opens it; on a module, its page.`}
              selected={null}
              onSelect={(id) => {
                if (!id) return;
                if (id.includes("::")) onOpen(id.slice(id.indexOf("::") + 2));
                else if (id !== p.node && docs.pages.some((x) => x.node === id)) onPage(id);
              }}
            />
          </div>
          <figcaption className="mt-1.5 font-mono text-[10.5px] text-fg-3">Its files and their imports, and the modules it links to. Click a file to open it, a module to go to its page.</figcaption>
        </figure>
      )}
      {p.sections.map((s) => (
        <section key={s.heading} className="mt-4">
          <h3 className="font-medium text-fg">{s.heading}</h3>
          <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-line text-fg-2">
            <Rich text={s.body} />
          </p>
        </section>
      ))}
      {p.keyFiles.length > 0 && (
        <section className="mt-5">
          <h3 className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Key files</h3>
          <ul className="mt-1.5 divide-y divide-line rounded-[12px] border border-line">
            {p.keyFiles.map((f) => (
              <li key={f.path} className="px-3 py-2">
                <button onClick={() => f.ok && onOpen(f.path)} disabled={!f.ok} className="block w-full text-left disabled:cursor-default">
                  <span className={`font-mono text-[12.5px] ${f.ok ? "text-fg hover:text-trail" : "text-fg-3 line-through"}`}>{f.path}</span>
                  <span className="block text-[12.5px] text-fg-2">{f.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.refs.length > 0 && (
        <section className="mt-5">
          <h3 className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Where to look</h3>
          <ul className="mt-1.5 space-y-2">
            {p.refs.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => r.ok && onOpen(r.file, r.startLine, r.endLine)}
                  disabled={!r.ok}
                  className={`block w-full rounded-[12px] border border-line px-3 py-2 text-left ${r.ok ? "hover:border-trail/60" : "opacity-50"}`}
                >
                  <span className="flex items-center justify-between gap-2 font-mono text-[11.5px]">
                    <span className="truncate text-fg-2">
                      {r.file} <span className="text-trail">L{r.startLine}–{r.endLine}</span>
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-1 tracking-[0.08em] uppercase ${!r.ok ? "text-fg-3" : r.corrected ? "text-warn" : "text-ok"}`}>
                      {!r.ok ? "couldn't verify" : r.corrected ? <><CornerUpRight className="size-3" /> range corrected</> : <><Check className="size-3" /> lines checked</>}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[13px] text-fg-2">
                    <Rich text={r.note} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
