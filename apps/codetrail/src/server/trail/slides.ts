// Slides from what a read already stores: a title slide, the architecture, one slide per module (its docs overview,
// its neighbourhood diagram and key files) and the main tour's steps. No model call, so they're free, instant, and
// every reference in them was checked when it was written. Shown at /owner/repo/slides, or as one HTML file.
import { groupsOf } from "@/lib/architecture";
import { architectureSpec, diagramSvg, layoutDiagram, neighbourhoodSpec, type DiagramSpec } from "@/lib/diagram";
import { onCode, type Atlas, type Tour, type TourIndexEntry } from "@/lib/schemas";
import { getJSON } from "@/server/store";
import { getStoredDocs } from "./docs";
import { commitKey, getStoredAtlas, type Prepared } from "./service";

export type Slide = {
  kind: "title" | "diagram" | "module" | "tour" | "end";
  kicker: string;
  title: string;
  text?: string;
  bullets?: string[];
  /** The diagram as data URLs, one per theme. */
  image?: { light: string; dark: string; alt: string };
  files?: string[];
};

const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
async function image(spec: DiagramSpec, alt: string) {
  const layout = await layoutDiagram(spec);
  return { light: dataUrl(diagramSvg(layout, "light")), dark: dataUrl(diagramSvg(layout, "dark")), alt };
}
/** The first few sentences of a paragraph, for a slide. A full stop inside `code` (`http.Server`) doesn't end one. */
export function sentences(text: string, n: number): string[] {
  const out: string[] = [];
  let start = 0;
  let code = false;
  for (let i = 0; i < text.length && out.length < n; i++) {
    if (text[i] === "`") code = !code;
    else if (!code && ".!?".includes(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (out.length < n && rest) out.push(rest);
  return out.filter(Boolean);
}

export async function buildSlides(p: Prepared, pageUrl: string): Promise<Slide[] | null> {
  const atlas: Atlas | null = await getStoredAtlas(p.info);
  if (!atlas) return null;
  const docs = await getStoredDocs(p);
  const index = (await getJSON<TourIndexEntry[]>(`${commitKey(p)}/tours.json`)) ?? [];
  const main = index.find((t) => t.primary) ?? index.find((t) => !t.source) ?? index[0];
  const tour = main ? await getJSON<Tour>(`${commitKey(p)}/tours/${main.id}.json`) : null;
  const name = `${p.info.owner}/${p.info.repo}`;
  const at = `${name} @ ${p.info.sha.slice(0, 7)}`;

  const slides: Slide[] = [
    { kind: "title", kicker: at, title: name, text: p.info.description ?? undefined, bullets: sentences(atlas.summary, 3), files: atlas.stack.slice(0, 8) },
    { kind: "diagram", kicker: "Architecture", title: `${atlas.nodes.length} modules, top to bottom in the order calls flow`, image: await image(architectureSpec(atlas), `The architecture of ${name}`) },
  ];
  const { groups } = groupsOf(atlas.nodes);
  for (const g of groups) {
    for (const id of g.nodes) {
      const n = atlas.nodes.find((x) => x.id === id)!;
      const page = docs?.pages.find((pg) => pg.node === id);
      slides.push({
        kind: "module",
        kicker: g.title || n.kind,
        title: n.label,
        bullets: sentences(page?.overview ?? n.purpose, 3),
        image: await image(neighbourhoodSpec(atlas, p.summary, id), `${n.label}: its files and the modules it links to`),
        files: (page?.keyFiles.filter((f) => f.ok).map((f) => f.path) ?? n.files).slice(0, 6),
      });
    }
  }
  if (tour) {
    slides.push({
      kind: "tour",
      kicker: "How it runs",
      title: tour.title,
      bullets: tour.steps.slice(0, 10).map((s) => (onCode(s) ? `${s.title} · \`${s.file}:${s.startLine}\`` : s.title)),
    });
  }
  slides.push({ kind: "end", kicker: at, title: "Explore it step by step", text: pageUrl });
  return slides;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Escaped, with `inline code` as <code>. */
const rich = (s: string) => esc(s).replace(/`([^`\n]+)`/g, "<code>$1</code>");

/** The slides as one standalone HTML file: the same keys (arrows, space, F for fullscreen), light or dark with the system. */
export function slidesHtml(slides: Slide[], title: string): string {
  const body = slides
    .map((s, i) => {
      const img = s.image ? `<picture><source media="(prefers-color-scheme: dark)" srcset="${s.image.dark}"><img src="${s.image.light}" alt="${esc(s.image.alt)}"></picture>` : "";
      const list = s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${rich(b)}</li>`).join("")}</ul>` : "";
      const files = s.files?.length ? `<p class="files">${s.files.map((f) => `<code>${esc(f)}</code>`).join(" ")}</p>` : "";
      const text = s.text ? `<p class="lead">${rich(s.text)}</p>` : "";
      return `<section class="slide ${s.kind}" aria-label="Slide ${i + 1} of ${slides.length}"${i ? " hidden" : ""}><p class="kicker">${esc(s.kicker)}</p><h1>${esc(s.title)}</h1><div class="body"><div>${text}${list}${files}</div>${img}</div></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f6f3ec;--fg:#16171a;--fg2:#4a4d55;--fg3:#6b6e76;--accent:#935000;--line:#ddd8cc}
@media (prefers-color-scheme: dark){:root{--bg:#0f1013;--fg:#ececef;--fg2:#b9bbc3;--fg3:#868993;--accent:#ffb020;--line:#2a2c33}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:18px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.slide{height:100vh;padding:5vh 6vw;display:flex;flex-direction:column}
.kicker{margin:0;font:600 13px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1{margin:.4em 0 .6em;font-size:clamp(28px,4vw,52px);line-height:1.08;letter-spacing:-.02em}
.body{flex:1;min-height:0;display:flex;gap:4vw}.body>div{flex:1;min-width:0}.slide.diagram .body>div{display:none}
picture{flex:1.4;min-width:0;display:flex;align-items:center;justify-content:center}picture img{width:100%;height:100%;object-fit:contain;border-radius:12px}
.lead{font-size:1.25em;color:var(--fg2)}ul{padding-left:1.1em;color:var(--fg2)}li{margin:.35em 0}
code{font:14px ui-monospace,Menlo,monospace;background:color-mix(in srgb,var(--fg) 8%,transparent);padding:.15em .4em;border-radius:5px}
.files{display:flex;flex-wrap:wrap;gap:.4em}
footer{position:fixed;right:2vw;bottom:2vh;font:13px ui-monospace,Menlo,monospace;color:var(--fg3)}
@media (max-width:800px){.body{flex-direction:column}}
</style></head><body>
${body}
<footer aria-live="polite"><span id="n">1</span> / ${slides.length} · ← → to move · F full screen</footer>
<script>
const s=[...document.querySelectorAll(".slide")];let i=0;
const go=(n)=>{i=Math.max(0,Math.min(s.length-1,n));s.forEach((x,k)=>x.hidden=k!==i);document.getElementById("n").textContent=i+1;};
addEventListener("keydown",(e)=>{if(e.key==="ArrowRight"||e.key===" "||e.key==="PageDown"){e.preventDefault();go(i+1)}else if(e.key==="ArrowLeft"||e.key==="PageUp"){e.preventDefault();go(i-1)}else if(e.key==="Home")go(0);else if(e.key==="End")go(s.length-1);else if(e.key==="f"||e.key==="F"){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}});
addEventListener("click",(e)=>{if(!e.target.closest("a"))go(i+(e.clientX<innerWidth/3?-1:1))});
</script></body></html>`;
}
