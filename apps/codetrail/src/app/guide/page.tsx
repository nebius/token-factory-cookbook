// The user guide, in the app: docs/user-guide.md rendered with a table of contents, so the same text serves the
// repo on GitHub and people using Codetrail.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Guide",
  description: "How to use Codetrail: read a repo, follow its architecture diagram and code tours, ask questions, write docs and your own tours, tour pull requests, and give coding agents context.",
  alternates: { canonical: "/guide" },
};

const REPO = "https://github.com/Studio1-OSS/Codetrail";

/** GitHub's heading anchors ("13. Coding agents (MCP)" → "13-coding-agents-mcp"), so the guide's own links work. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

async function guide() {
  const source = await readFile(path.join(process.cwd(), "docs/user-guide.md"), "utf8");
  // The page draws its own title and contents, so the file's title and link list are left out.
  const body = source.replace(/^# .*\n/, "").replace(/^(- \[.*\]\(#.*\)\n)+/m, "");
  const toc: { id: string; text: string }[] = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth, text }) {
        const id = slug(text);
        if (depth === 2) toc.push({ id, text });
        return `<h${depth} id="${id}"><a href="#${id}">${this.parser.parseInline(tokens)}</a></h${depth}>`;
      },
      link({ href, tokens }) {
        const to = href === "../README.md" ? "/" : href.startsWith("../") ? `${REPO}/blob/main/${href.slice(3)}` : href;
        const external = /^https?:/.test(to);
        return `<a href="${to}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  const html = (await marked.parse(body.replace("For what it is and how it works, see the [README](../README.md).", "For what it is and how it works, see the [home page](../README.md).")))
    // Wide tables and code scroll sideways inside a wrapper a keyboard can reach; the table keeps its semantics.
    .replace(/<table>/g, '<div class="guide-scroll" tabindex="0" role="region" aria-label="Table">\n<table>')
    .replace(/<\/table>/g, "</table>\n</div>")
    .replace(/<pre>/g, '<pre tabindex="0">');
  return { html, toc };
}

export default async function GuidePage() {
  const { html, toc } = await guide();
  return (
    <div className="min-h-dvh bg-ink text-fg">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1240px] px-4 pt-10 pb-24 sm:px-6">
        <h1 className="font-display text-[40px] leading-none font-light tracking-[-0.05em] [font-stretch:78%] sm:text-[56px] lg:pl-[270px]">
          How to use <span className="font-extrabold text-trail [font-stretch:110%]">Codetrail.</span>
        </h1>
        <div className="mt-6 grid gap-10 lg:grid-cols-[230px_minmax(0,1fr)]">
          {/* Contents: a column on wide screens, a folded menu on phones. */}
          <nav aria-label="Contents" className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
            <p className="font-mono text-[11px] tracking-[0.18em] text-fg-3 uppercase">Contents</p>
            <Contents toc={toc} />
          </nav>
          <article className="min-w-0">
            <details className="mb-6 rounded-[12px] border border-line px-4 py-3 lg:hidden">
              <summary className="cursor-pointer font-mono text-[11px] tracking-[0.18em] text-fg-3 uppercase">Contents</summary>
              <Contents toc={toc} />
            </details>
            <div className="guide" dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        </div>
      </main>
    </div>
  );
}

function Contents({ toc }: { toc: { id: string; text: string }[] }) {
  return (
    <ol className="mt-3 space-y-1.5 border-l border-line pl-3">
      {toc.map((t) => (
        <li key={t.id}>
          <a href={`#${t.id}`} className="text-[13.5px] text-fg-2 hover:text-trail">
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
