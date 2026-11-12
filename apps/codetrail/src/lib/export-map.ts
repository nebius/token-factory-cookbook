// Map exports: the architecture as a Mermaid flowchart, a tour as a Mermaid sequence diagram, and the graph on screen
// as a standalone SVG file.
import { groupsOf, homeOf, plainLabel } from "./architecture";
import { LOCAL_OWNER } from "./ref";
import { onCode, type Atlas, type Tour } from "./schemas";
import { withModels } from "./models";

const safeId = (id: string) => `m_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
const safeLabel = (s: string) => s.replace(/"/g, "#quot;").replace(/[[\]{}()<>|]/g, " ").trim();

/**
 * Top to bottom like an architecture diagram: one subgraph per layer, coloured, each module linking to its folder
 * on GitHub at the commit read. Solid arrows are links confirmed by imports; dotted ones were inferred by the model.
 */
export function atlasToMermaid(atlas: Pick<Atlas, "nodes" | "edges">, at?: { owner: string; repo: string; sha: string }): string {
  const { by, groups, color } = groupsOf(atlas.nodes);
  const node = new Map(atlas.nodes.map((n) => [n.id, n]));
  const box = (id: string) => `${safeId(id)}["${safeLabel(node.get(id)!.label)}"]:::${safeId(`c_${color.get(id)!.slice(1)}`)}`;
  const lines = ["flowchart TD"];
  groups.forEach((g, i) => {
    if (!by) return g.nodes.forEach((id) => lines.push(`  ${box(id)}`));
    lines.push(`  subgraph g${i}["${safeLabel(g.title)}"]`, "    direction TB", ...g.nodes.map((id) => `    ${box(id)}`), "  end");
  });
  for (const e of atlas.edges) lines.push(`  ${safeId(e.from)} ${e.verified ? "-->" : "-.->"}|"${safeLabel(plainLabel(e.label))}"| ${safeId(e.to)}`);
  if (at && at.owner !== LOCAL_OWNER) {
    for (const n of atlas.nodes) {
      const home = n.files.length === 1 ? n.files[0] : homeOf(n.files);
      const kind = n.files.length === 1 ? "blob" : "tree";
      lines.push(`  click ${safeId(n.id)} "https://github.com/${at.owner}/${at.repo}/${kind}/${at.sha}/${home.split("/").map(encodeURIComponent).join("/")}"`);
    }
  }
  for (const c of new Set(color.values())) lines.push(`  classDef ${safeId(`c_${c.slice(1)}`)} fill:${c}26,stroke:${c},stroke-width:1.5px`);
  return lines.join("\n");
}

const seqText = (s: string) => s.replace(/[;#<>\n\r]/g, " ").replace(/\s+/g, " ").trim();

/** A tour as who-hands-to-whom: modules are participants, each step a message from the previous step's module. */
export function tourToSequence(tour: Pick<Tour, "steps">, atlas: Pick<Atlas, "nodes">): string {
  const label = new Map(atlas.nodes.map((n) => [n.id, n.label]));
  const lines = ["sequenceDiagram", "  autonumber"];
  const steps = tour.steps.filter(onCode);
  for (const id of new Set(steps.map((s) => s.node))) lines.push(`  participant ${safeId(id)} as ${seqText(label.get(id) ?? id)}`);
  steps.forEach((s, i) => {
    const from = i === 0 ? s.node : steps[i - 1].node;
    lines.push(`  ${safeId(from)}->>${safeId(s.node)}: ${seqText(s.title)} (${s.file}:L${s.startLine})`);
  });
  return lines.join("\n");
}

/**
 * Serializes an on-screen SVG with the theme's CSS variables resolved, so it renders anywhere. With `whole`, the
 * file frames the whole diagram (its own size, zoom and pan undone), not just what's on screen.
 */
export function svgFile(svg: SVGSVGElement, whole?: { w: number; h: number }): string {
  const css = getComputedStyle(document.documentElement);
  const { width, height } = whole ? { width: whole.w, height: whole.h } : svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (whole) clone.querySelector(":scope > g")?.removeAttribute("transform");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  clone.setAttribute("viewBox", `0 0 ${Math.round(width)} ${Math.round(height)}`);
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", css.getPropertyValue("--color-ink").trim() || "#08090b");
  clone.insertBefore(bg, clone.firstChild);
  return clone.outerHTML.replace(/var\(--([\w-]+)\)/g, (_, name: string) => css.getPropertyValue(`--${name}`).trim() || "#888");
}

/**
 * A tour as a VS Code CodeTour file (https://aka.ms/codetour-schema), pinned to the commit it was traced at. Each
 * step selects its whole line range (CodeTour's columns are 1-based, so the selection ends at the start of the next
 * line) and puts its comment under the range.
 */
/** `next`: the title of the tour that follows, so CodeTour offers it at the end (its `nextTour`). */
export function tourToCodeTour(tour: Pick<Tour, "title" | "summary" | "steps" | "pull" | "primary" | "calls">, at: { owner: string; repo: string; sha: string }, next?: string) {
  const ref = tour.pull?.headSha ?? at.sha;
  return {
    $schema: "https://aka.ms/codetour-schema",
    title: tour.title,
    ...(tour.primary ? { isPrimary: true } : {}),
    ...(next ? { nextTour: next } : {}),
    description: `${tour.summary}\n\nGenerated by Codetrail${withModels(tour.calls)} for ${at.owner}/${at.repo} at ${ref.slice(0, 7)}.`,
    ref,
    // Text steps become CodeTour content steps (no file).
    steps: tour.steps.map((s) =>
      onCode(s)
        ? { title: s.title, file: s.file, line: s.endLine, selection: { start: { line: s.startLine, character: 1 }, end: { line: s.endLine + 1, character: 1 } }, description: s.narration }
        : { title: s.title, description: s.narration },
    ),
  };
}

/** An SVG file drawn onto a canvas at twice its size, as a PNG. */
export async function svgToPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The image couldn't be drawn."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * 2;
    canvas.height = img.naturalHeight * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image couldn't be made."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
