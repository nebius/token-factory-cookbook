import Link from "next/link";
import { MODEL_LABEL } from "@/env";
import { Headlamp } from "@/components/landing/headlamp";
import { LiveStats } from "@/components/landing/live-stats";
import { RepoInput } from "@/components/landing/repo-input";
import { SiteHeader } from "@/components/site-header";
import { FALLBACK_FEATURED } from "@/lib/featured-fallback";
import { timeAgo } from "@/lib/format";
import { siteTotals } from "@/server/stats";
import { LOCAL_OWNER } from "@/lib/ref";
import { listLocal } from "@/server/repo/local";
import { getFeatured, getRecent, newestPerRepo } from "@/server/trail/service";

export const dynamic = "force-dynamic";

const HOW = [
  {
    km: "1 · Read",
    title: "The whole repo, one prompt",
    body: `${MODEL_LABEL} holds 1M tokens, so every file goes in at once with line numbers. No index picking chunks, so a flow across ten files stays whole.`,
  },
  {
    km: "2 · Check",
    title: "Every step against the real file",
    body: "Each step quotes one line. Codetrail finds it in the file at that commit and fixes the range if the model drifted. Steps it can't find are dropped, never shown.",
  },
  {
    km: "3 · Share",
    title: "Saved, shareable, reusable",
    body: "Every tour gets a link to the exact step and a share card for its link preview. Tours, docs and answers are saved, so the next person opens them free. Pull requests get their own tour on top of the same read.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Codetrail?",
    a: `It turns a GitHub repository into an architecture map, written docs, guided code tours and answers to your questions, all from one read of the whole repo by ${MODEL_LABEL}.`,
  },
  {
    q: "How accurate is it?",
    a: "Every tour step, doc reference and answer quotes a real line of code. Codetrail checks it against the file at that commit, moves the range if the line numbers drifted, and drops anything it can't find. Map links backed by real imports are marked.",
  },
  {
    q: "Is it free?",
    a: "Opening a repo someone already read is always free. On the hosted app, reading a new repo or asking a question needs a GitHub sign-in, with a free daily allowance. Self-hosted, you pay only for the model calls. On DeepSeek V4.1 Flash 1017 that's about $0.03 to read a small repo and under a cent for a follow-up once the repo is cached; Kimi K3.1 Pro costs about 7× as much. The price shows before every call.",
  },
  {
    q: "Can it read private repos?",
    a: "Yes, when you self-host it with a GitHub token that can read them. The code, tours and docs stay in your own database. The hosted app reads public repos only.",
  },
  {
    q: "What happens to the code?",
    a: `Codetrail downloads the commit, skips binaries, lockfiles and anything that looks like a credential, and sends the rest to ${MODEL_LABEL} on Nebius Token Factory in one prompt. It keeps the files and results so they open instantly next time.`,
  },
  {
    q: "How big a repo can it read?",
    a: "Up to about 700K tokens in full (the model's context is 1M). For bigger repos, lower-priority files go in as signatures only, and tests and examples are left out first. Before anything is spent, the Ready screen shows exactly what will be sent and what it will cost.",
  },
  {
    q: "Does asking again cost money?",
    a: "No. Every tour, answer, docs page and conversation is stored for the commit it was asked on, and opens free for everyone after that. While you type a question, the Ask box shows anything already stored that answers it. A new question sends the repo first, so it can be billed as cached input (about 2% of the price). That cache is best-effort, and the first few calls on a repo often miss it, so the Ask box shows both prices.",
  },
  {
    q: "Can I ask follow-up questions?",
    a: "Yes. Under every answer and repo tour (not pull-request tours) there are suggested follow-ups and a box for your own. Each follow-up gets a short recap of the conversation, so the answer builds on what was said, and every code reference is checked like the rest. Conversations get their own link. For harder questions, Thorough mode traces the answer across every file involved, and Research plans what to find out and looks in up to three rounds before it answers.",
  },
  {
    q: "Can it explain a pull request?",
    a: "Yes. Paste a PR link, or swap github.com for this site in its URL. Codetrail already has the repo from its read, so the tour adds only the change: the patches and the PR's version of each changed file. You get the change in the order it runs, with the diff marked, and notes for the reviewer (risks, missing tests, questions), each tied to a line that was checked.",
  },
  {
    q: "Can my coding agent use it?",
    a: "Yes. The MCP server gives Claude Code, Cursor and other agents the map, tours, answers with follow-ups and pull-request tours of any GitHub repo (and, self-hosted, your local folders), at /api/mcp or run locally, plus a search of a read's files and its docs. It installs as a Claude Code plugin, and in one click in VS Code and Cursor. Tours also export to VS Code CodeTour, docs export as Markdown, and any module, tour or answer copies as a prompt for an AI chat.",
  },
  {
    q: "How is it different from DeepWiki or GitDiagram?",
    a: "Codetrail reads the whole repo in one prompt, checks every line it points to, plays tours step by step, and shows what each call cost. The comparison above lists where each tool stands, gaps included.",
  },
];

const UNDER_THE_HOOD = [
  { n: "1 call", title: "Map + main tour", body: "One read of every file returns the modules, how they connect, the questions worth asking, and the first tour." },
  { n: "≈ 2%", title: "Follow-ups reuse the repo", body: "Every extra tour sends the same repo first, so it can be billed as cached input: $0.006 per 1M tokens instead of $0.30." },
  { n: "0 guesses", title: "Code checks the model", body: "Import graph, file filters, line numbers and every step's range are worked out in code, not by the model." },
];

type Cell = { text: string; yes?: boolean };
const y = (text = "Yes"): Cell => ({ text, yes: true });
const t = (text: string): Cell => ({ text });
const dash = t("—");

const COMPARE: { cap: string; cells: [Cell, Cell, Cell, Cell, Cell] }[] = [
  { cap: "What the model sees", cells: [y("Every file, one prompt"), t("Tree, README, source excerpts"), t("An index, searched per page and question"), t("No model"), t("AI agents search the code")] },
  { cap: "Architecture diagram", cells: [y("Layers, routed links; open a module into its files"), y("Layers, colours, links"), y("Mermaid in wiki pages"), dash, y("C4 and UML, editable")] },
  { cap: "Written docs for every module", cells: [y("References checked, a diagram per page"), t("A short overview"), y("A wiki"), dash, t("Diagram-led docs")] },
  { cap: "Ask questions about the code", cells: [y("Follow-ups, Thorough and Research"), dash, y("Deep Research"), dash, y()] },
  { cap: "Step-by-step walkthroughs with file + line", cells: [y("Generated or yours, every line checked"), dash, t("Codemaps"), y("Hand-written"), t("In search results")] },
  { cap: "Tour markers in the code, progress", cells: [y(), dash, dash, y(), dash] },
  { cap: "Pull requests", cells: [y("A tour of the change, review notes"), dash, dash, t("Tours pinned to a commit"), t("PR diagrams (paid plan)")] },
  { cap: "Checked against the code", cells: [y("Every quoted line, again on each newer commit"), t("Every linked path"), dash, t("Drift warnings in CI"), dash] },
  { cap: "Export the diagram", cells: [y("Mermaid, SVG, PNG, draw.io"), y("Mermaid, PNG"), dash, t(".tour files"), y("Mermaid, draw.io, PNG, SVG")] },
  { cap: "A live diagram image for a README", cells: [y("SVG or PNG, with a badge"), y("With a badge"), t("A badge"), dash, t("Embeds (Teams plan)")] },
  { cap: "Markdown page for AI tools", cells: [y("/owner/repo.md, llms.txt"), y("/owner/repo.md, llms.txt"), dash, dash, dash] },
  { cap: "Read only some folders", cells: [y("Folders or globs"), dash, t("Page list in .devin/wiki.json"), dash, dash] },
  { cap: "What it costs you", cells: [y("Your key; price before and after every call"), t("Free quota, cost after a run"), t("Free for public repos"), t("Free"), t("Free tier, Pro $19/month")] },
  { cap: "Works from a URL in the browser", cells: [y(), y(), y(), t("VS Code (desktop and web)"), t("VS Code")] },
  { cap: "MCP server for coding agents", cells: [y("Also a Claude Code plugin"), y(), y(), dash, dash] },
  { cap: "Open source", cells: [y("MIT"), y("MIT"), t("No"), y("MIT"), t("No")] },
  { cap: "Private code", cells: [y("GitHub token or local folders; code goes only to the model, on your key"), y("With a GitHub token"), t("With a Devin account"), y("Local files"), t("Local folders; code goes to cloud models")] },
  { cap: "Function-level call graph", cells: [y("JS/TS, Python, Go"), dash, dash, dash, y("From the language server")] },
  { cap: "Explainer video of a repo", cells: [dash, y(), dash, dash, dash] },
];

export default async function Home() {
  const [recent, totals, featured, folders] = await Promise.all([getRecent().then(newestPerRepo).catch(() => []), siteTotals().catch(() => null), getFeatured(), listLocal()]);
  const trail = featured ?? FALLBACK_FEATURED;

  // Structured data for search engines: the app itself, and the FAQ.
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Codetrail",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: `Diagram, docs, code tour and Q&A for any GitHub repo, read whole by ${MODEL_LABEL}.`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isAccessibleForFree: true,
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <div className="relative min-h-dvh bg-ink text-fg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {/* The header sits over the hero, outside <main>, so it's the page's banner. */}
      <div className="absolute inset-x-0 top-0 z-20">
        <SiteHeader overlay />
      </div>
      <main id="main">
      <Headlamp terrain={trail.terrain} waypoints={trail.waypoints}>
        <div className="relative mx-auto max-w-[1240px] px-4 pt-36 pb-24 sm:px-6 sm:pt-44 sm:pb-32">
          <p className="font-mono text-[11px] tracking-[0.22em] text-trail uppercase">{MODEL_LABEL} · 1M-token context</p>
          <h1 className="mt-5 max-w-[900px] font-display text-[44px] leading-[0.98] font-light tracking-[-0.05em] [font-stretch:78%] sm:text-[84px]">
            Every repo is a <span className="font-extrabold text-trail [font-stretch:112%]">trail</span>.
            <br />
            Walk it<span className="caret text-trail">_</span>
          </h1>
          <p className="mt-6 max-w-[520px] bg-ink/55 text-[17px] leading-relaxed text-fg-2 backdrop-blur-sm">
            Diagram, wiki, code tours and Q&amp;A, in one link. Paste any GitHub repo: {MODEL_LABEL} reads every file at once, draws the architecture, writes the docs and walks
            you through how the code actually runs, step by step.
          </p>
          <div className="mt-9">
            <RepoInput autoFocus />
          </div>
          <p className="mt-10 font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">
            The map behind this text is{" "}
            <Link href={`/${trail.owner}/${trail.repo}`} className="text-fg-2 underline decoration-trail/50 underline-offset-4 hover:text-trail">
              {trail.owner}/{trail.repo}
            </Link>
            &apos;s real source · move your cursor
          </p>
        </div>
      </Headlamp>

      <LiveStats initial={totals} />

      {folders.length > 0 && (
        <section className="mx-auto max-w-[1240px] px-4 pt-12 sm:px-6">
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-fg-3 uppercase">Your folders</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {folders.slice(0, 40).map((f) => (
              <li key={f.name}>
                <Link href={`/${LOCAL_OWNER}/${f.name}`} className="inline-block rounded-[10px] border border-line px-3 py-1.5 font-mono text-[13px] text-fg-2 hover:border-trail/60 hover:text-fg">
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}


      <section id="how" className="mx-auto max-w-[1240px] scroll-mt-4 px-4 py-20 sm:px-6">
        <h2 className="font-display text-[34px] leading-none font-light tracking-[-0.05em] [font-stretch:80%] sm:text-[52px]">
          One read. <span className="font-extrabold [font-stretch:105%]">Every step checked.</span>
        </h2>
        <ol className="mt-12 grid gap-x-8 gap-y-10 border-t-2 border-dotted border-outline md:grid-cols-3">
          {HOW.map((h, i) => (
            <li key={h.km} className="relative pt-8">
              <span className={`absolute -top-[9px] left-0 size-4 rounded-full border-[3px] border-ink ${i === 0 ? "bg-trail" : "bg-fg"}`} />
              <div className="font-mono text-[11px] tracking-[0.2em] text-trail uppercase">{h.km}</div>
              <h3 className="mt-2.5 text-[22px] font-medium tracking-tight">{h.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{h.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-night">
        <div className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6">
          <p className="font-mono text-[11px] tracking-[0.2em] text-fg-3 uppercase">Under the hood · how {MODEL_LABEL} is used</p>
          <div className="mt-6 grid gap-8 md:grid-cols-3">
            {UNDER_THE_HOOD.map((u) => (
              <div key={u.title}>
                <div className="font-display text-[30px] font-medium tracking-tight text-trail [font-stretch:80%]">{u.n}</div>
                <h3 className="mt-1 font-medium">{u.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="compare" className="mx-auto max-w-[1240px] scroll-mt-4 px-4 py-20 sm:px-6">
        <h2 className="font-display text-[34px] leading-none font-light tracking-[-0.05em] [font-stretch:80%] sm:text-[52px]">
          Four tools, <span className="font-extrabold text-trail [font-stretch:105%]">one link.</span>
        </h2>
        <p className="mt-3 max-w-2xl text-[16px] text-fg-2">Architecture diagrams, AI-written docs, hand-written code tours and a code map usually live in four places. Here&apos;s where each one stands, gaps included.</p>
        <div className="relative mt-8 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-3 pr-3 text-left font-mono text-[11px] font-normal tracking-[0.15em] text-fg-3 uppercase">
                  Capability
                </th>
                <th scope="col" className="px-3 py-3 font-display font-bold text-trail [font-stretch:90%]">
                  codetrail
                </th>
                {["GitDiagram", "DeepWiki", "CodeTour", "CodeViz"].map((n) => (
                  <th key={n} scope="col" className="px-3 py-3 font-medium text-fg-2">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.cap} className="border-b border-line">
                  <th scope="row" className="py-3.5 pr-3 text-left font-normal">
                    {r.cap}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={`px-3 py-3.5 text-center ${i === 0 ? "bg-trail-soft" : ""}`}>
                      {c.yes ? (
                        <span className={`inline-flex items-center gap-1.5 ${i === 0 ? "text-trail" : "text-fg"}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {c.text !== "Yes" && <span className="text-[13px]">{c.text}</span>}
                          <span className="sr-only">{c.text === "Yes" ? "Yes" : ""}</span>
                        </span>
                      ) : (
                        <span className="text-[13px] text-fg-3">{c.text}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-fg-3">Based on each tool&apos;s public docs, October 2026.</p>
      </section>

      <section id="faq" className="mx-auto max-w-[1240px] scroll-mt-4 px-4 pb-20 sm:px-6">
        <h2 className="font-display text-[34px] leading-none font-light tracking-[-0.05em] [font-stretch:80%] sm:text-[52px]">
          Questions, <span className="font-extrabold [font-stretch:105%]">answered.</span>
        </h2>
        <div className="mt-8 divide-y divide-line border-y border-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-medium marker:hidden">
                {f.q}
                <span aria-hidden className="font-mono text-[18px] text-trail transition group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-3xl pb-5 text-[15px] leading-relaxed text-fg-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
          <h2 className="flex items-baseline justify-between gap-3 font-mono text-[11px] tracking-[0.2em] text-fg-3 uppercase">
            Recent repos · free to replay
            <Link href="/browse" className="tracking-[0.1em] text-trail normal-case hover:underline">
              Browse all →
            </Link>
          </h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {recent.slice(0, 8).map((r) => (
              <li key={`${r.owner}/${r.repo}`}>
                <Link href={`/${r.owner}/${r.repo}`} className="group flex flex-wrap items-baseline gap-x-6 gap-y-1 py-4">
                  <span className="font-mono text-[15px] group-hover:text-trail">
                    {r.owner === LOCAL_OWNER ? `this machine/${r.repo}` : `${r.owner}/${r.repo}`}
                  </span>
                  {r.description && <span className="min-w-0 flex-1 truncate text-[14px] text-fg-2">{r.description}</span>}
                  <span className="font-mono text-[12px] text-fg-3">
                    {r.owner === LOCAL_OWNER ? "local folder" : `★ ${r.stars.toLocaleString()}`} · {timeAgo(r.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      </main>

      <footer className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-3 border-t border-line px-4 py-7 font-mono text-[11px] tracking-[0.12em] text-fg-3 uppercase sm:px-6">
        <span>Original build by <a href="https://studio1hq.com">Studio1HQ</a> · <a href="https://github.com/Studio1-OSS/Codetrail">Original source</a> · TF edition</span>
        <span>Built on {MODEL_LABEL} · runs on Nebius Token Factory</span>
      </footer>
    </div>
  );
}
