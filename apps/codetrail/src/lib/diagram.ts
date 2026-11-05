// One diagram engine for every boxes-and-arrows view: the architecture (with modules opened up into their files),
// each docs page's neighbourhood, and the function call graph. A spec says what to draw; ELK's layered layout
// says where. Pure, so the browser draws it interactively and the server renders the same thing as an SVG file.
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import { groupsOf, homeOf, plainLabel } from "./architecture";
import type { Atlas, RepoSummary } from "./schemas";
import { nodeForFile } from "@/server/trail/ground";

export type DBox = {
  id: string;
  label: string;
  /** A second, smaller line: the folder, a line number. */
  caption?: string;
  color: string;
  group?: string;
  /** The compound box this one sits inside (a module opened up into its files). */
  parent?: string;
  /** "file" and "fn" boxes are smaller; a compound box holds others. */
  kind?: "module" | "file" | "fn" | "compound" | "external";
};
export type DGroup = { id: string; title: string; color: string };
/** Where a link comes from in the code: the import line that backs it. */
export type Evidence = { file: string; line: number | null; to: string };
export type DEdge = { from: string; to: string; label?: string; verified: boolean; evidence?: Evidence[] };
export type DiagramSpec = { groups: DGroup[]; boxes: DBox[]; edges: DEdge[]; direction?: "DOWN" | "RIGHT" };

export type Point = { x: number; y: number };
export type Placed = { id: string; x: number; y: number; w: number; h: number; box: DBox; lines: string[] };
export type PlacedGroup = { id: string; x: number; y: number; w: number; h: number; title: string; color: string };
export type Route = { key: string; from: string; to: string; label: string; verified: boolean; evidence: Evidence[]; points: Point[] };
export type Layout = { boxes: Map<string, Placed>; groups: PlacedGroup[]; routes: Route[]; w: number; h: number };
/** A link as the evidence panel shows it, from the map or from a list. */
export type LinkInfo = Pick<Route, "from" | "to" | "label" | "verified" | "evidence">;

const GROUP_TOP = 34;
export const COMPOUND_TOP = 46;

/** Two lines at most, broken at a word, so a box stays narrow. */
function wrap(label: string, max = 24): string[] {
  if (label.length <= max) return [label];
  const words = label.split(" ");
  let first = "";
  while (words.length && (first + " " + words[0]).trim().length <= max) first = `${first} ${words.shift()}`.trim();
  if (!first) first = words.shift() ?? "";
  const rest = words.join(" ");
  return [first, rest.length > max ? `${rest.slice(0, max - 1)}…` : rest].filter(Boolean);
}

const sizeOf = (b: DBox, lines: string[]) => {
  const small = b.kind === "file" || b.kind === "fn" || b.kind === "external";
  const longest = Math.max(...lines.map((l) => l.length), (b.caption?.length ?? 0) * 0.8);
  return {
    width: Math.min(small ? 210 : 230, Math.max(small ? 120 : 150, longest * (small ? 6.8 : 7.4) + 36)),
    height: small ? (b.caption ? 44 : 32) : b.caption ? 58 : 40,
  };
};

/** A polyline with rounded corners. */
export function rounded(points: Point[], r = 8): string {
  if (points.length < 3) return `M${points.map((p) => `${p.x},${p.y}`).join(" L")}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const u = (p: Point) => {
      const len = Math.hypot(p.x - b.x, p.y - b.y) || 1;
      return { x: b.x + ((p.x - b.x) / len) * r1, y: b.y + ((p.y - b.y) / len) * r1 };
    };
    const s = u(a), e = u(c);
    d += ` L${s.x},${s.y} Q${b.x},${b.y} ${e.x},${e.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x},${last.y}`;
}

/** The point halfway along a polyline, for an edge's label. */
export function midpoint(points: Point[]): Point {
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = segs.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i]) {
      const t = left / (segs[i] || 1);
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    left -= segs[i];
  }
  return points[0];
}

const edgeKey = (e: Pick<DEdge, "from" | "to">) => `${e.from}>${e.to}`;

type ELKLike = { layout(graph: ElkNode): Promise<ElkNode> };
let elk: Promise<ELKLike> | undefined;
const getElk = () => (elk ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK() as unknown as ELKLike));

/** Where everything goes. Runs in the browser and on the server (for the README image). */
export async function layoutDiagram(spec: DiagramSpec): Promise<Layout> {
  const byId = new Map(spec.boxes.map((b) => [b.id, b]));
  const lines = new Map(spec.boxes.map((b) => [b.id, wrap(b.label, b.kind === "fn" || b.kind === "file" ? 28 : 24)]));
  const childrenOf = new Map<string, DBox[]>();
  for (const b of spec.boxes) if (b.parent && byId.has(b.parent)) childrenOf.set(b.parent, [...(childrenOf.get(b.parent) ?? []), b]);

  const node = (b: DBox): ElkNode => {
    const kids = childrenOf.get(b.id);
    if (kids?.length)
      return { id: b.id, layoutOptions: { "elk.padding": `[top=${COMPOUND_TOP},left=14,bottom=14,right=14]`, "elk.spacing.nodeNode": "14" }, children: kids.map(node) };
    return { id: b.id, ...sizeOf(b, lines.get(b.id)!) };
  };
  const top = spec.boxes.filter((b) => !b.parent || !byId.has(b.parent));
  const grouped = spec.groups.length > 0;
  const seen = new Set<string>();
  const edges: ElkExtendedEdge[] = spec.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to && !seen.has(edgeKey(e)) && !!seen.add(edgeKey(e)))
    .map((e) => ({ id: edgeKey(e), sources: [e.from], targets: [e.to] }));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": spec.direction ?? "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": spec.direction === "RIGHT" ? "70" : "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.spacing.nodeNode": "22",
      "elk.spacing.edgeEdge": "10",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: grouped
      ? [
          ...spec.groups
            .map((g) => ({ g, kids: top.filter((b) => b.group === g.id) }))
            .filter(({ kids }) => kids.length)
            .map(({ g, kids }): ElkNode => ({ id: `lane:${g.id}`, layoutOptions: { "elk.padding": `[top=${GROUP_TOP},left=16,bottom=16,right=16]` }, children: kids.map(node) })),
          ...top.filter((b) => !b.group || !spec.groups.some((g) => g.id === b.group)).map(node),
        ]
      : top.map(node),
    edges,
  };

  const out = await (await getElk()).layout(graph);
  const boxes = new Map<string, Placed>();
  const groups: PlacedGroup[] = [];
  // Every container's absolute corner: ELK gives children (and edges inside a container) relative coordinates.
  const corner = new Map<string, Point>([["root", { x: 0, y: 0 }]]);
  const place = (n: ElkNode, ox: number, oy: number) => {
    const x = ox + (n.x ?? 0), y = oy + (n.y ?? 0);
    corner.set(n.id, { x, y });
    if (n.id.startsWith("lane:")) {
      const g = spec.groups.find((x) => `lane:${x.id}` === n.id)!;
      groups.push({ id: n.id, x, y, w: n.width ?? 0, h: n.height ?? 0, title: g.title, color: g.color });
    } else {
      const b = byId.get(n.id)!;
      boxes.set(n.id, { id: n.id, x, y, w: n.width ?? 0, h: n.height ?? 0, box: childrenOf.get(n.id)?.length ? { ...b, kind: "compound" } : b, lines: lines.get(n.id)! });
    }
    n.children?.forEach((c) => place(c, x, y));
  };
  out.children?.forEach((c) => place(c, 0, 0));

  const specEdge = new Map(spec.edges.map((e) => [edgeKey(e), e]));
  const routes: Route[] = (out.edges ?? []).flatMap((e) => {
    const { sections, container } = e as ElkExtendedEdge & { sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[]; container?: string };
    const s = sections?.[0];
    const src = specEdge.get(e.id);
    if (!s || !src) return [];
    const at = corner.get(container ?? "root") ?? { x: 0, y: 0 };
    const shift = (p: Point) => ({ x: p.x + at.x, y: p.y + at.y });
    return [{ key: e.id, from: src.from, to: src.to, label: plainLabel(src.label ?? ""), verified: src.verified, evidence: src.evidence ?? [], points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(shift) }];
  });
  return { boxes, groups, routes, w: out.width ?? 0, h: out.height ?? 0 };
}

// --- What to draw ---------------------------------------------------------------------------------------

export type Files = Pick<RepoSummary, "fileSizes" | "imports" | "importLines">;
const MAX_FILES = 10;

/** File-level imports with their module on each end, from the summary's import graph. */
function importsByModule(atlas: Pick<Atlas, "nodes">, files: Files) {
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const moduleOf = new Map(files.fileSizes.map(([path]) => [path, nodeForFile(path, nodes) ?? ""]));
  return files.imports.map(([a, b], i) => {
    const from = files.fileSizes[a]?.[0] ?? "";
    const to = files.fileSizes[b]?.[0] ?? "";
    return { from, to, line: files.importLines?.[i] ?? null, fromModule: moduleOf.get(from) ?? "", toModule: moduleOf.get(to) ?? "" };
  });
}

/** The files to show for an opened module: its key files first, then the most imported of the rest. */
function shownFiles(id: string, atlas: Pick<Atlas, "nodes">, all: ReturnType<typeof importsByModule>, files: Files) {
  const key = atlas.nodes.find((n) => n.id === id)?.files ?? [];
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const mine = files.fileSizes.map(([p]) => p).filter((p) => nodeForFile(p, nodes) === id);
  const fanIn = new Map<string, number>();
  for (const e of all) if (e.toModule === id) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  const rest = mine.filter((p) => !key.includes(p)).sort((a, b) => (fanIn.get(b) ?? 0) - (fanIn.get(a) ?? 0));
  const shown = [...new Set([...key, ...rest])].slice(0, MAX_FILES);
  return { shown, total: Math.max(mine.length, shown.length) };
}

const fileId = (module: string, path: string) => `${module}::${path}`;
const baseName = (p: string) => p.split("/").pop() ?? p;

/**
 * The architecture: modules in their layers, links with the import lines behind them. Opened modules hold their
 * files, and links from an opened module start at the file that has the import.
 */
export function architectureSpec(atlas: Pick<Atlas, "nodes" | "edges">, opts: { expanded?: Set<string>; files?: Files; only?: Set<string> } = {}): DiagramSpec {
  const { by, groups, color } = groupsOf(atlas.nodes);
  const expanded = opts.files ? (opts.expanded ?? new Set<string>()) : new Set<string>();
  const nodes = atlas.nodes.filter((n) => !opts.only || opts.only.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  const imports = opts.files ? importsByModule(atlas, opts.files) : [];
  const groupOf = new Map(groups.flatMap((g) => g.nodes.map((id) => [id, g.id] as const)));

  const boxes: DBox[] = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    caption: n.files.length === 1 ? n.files[0] : homeOf(n.files) || "repository root",
    color: color.get(n.id)!,
    group: by ? groupOf.get(n.id) : undefined,
    kind: "module",
  }));
  const fileBox = new Map<string, string>(); // path → box id, for files of opened modules
  for (const id of expanded) {
    if (!ids.has(id)) continue;
    const { shown, total } = shownFiles(id, atlas, imports, opts.files!);
    const box = boxes.find((b) => b.id === id)!;
    box.caption = `${box.caption} · ${shown.length < total ? `${shown.length} of ${total} files` : `${total} ${total === 1 ? "file" : "files"}`}`;
    for (const p of shown) {
      fileBox.set(p, fileId(id, p));
      boxes.push({ id: fileId(id, p), label: baseName(p), caption: p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : undefined, color: color.get(id)!, parent: id, kind: "file" });
    }
  }

  // The module's own key files first, then files in its folder, then the rest (tests, benchmarks…).
  const keyFiles = new Map(atlas.nodes.map((n) => [n.id, new Set(n.files)]));
  const homes = new Map(atlas.nodes.map((n) => [n.id, homeOf(n.files)]));
  const rank = (module: string, file: string) => (keyFiles.get(module)?.has(file) ? 0 : homes.get(module) && file.startsWith(homes.get(module)!) ? 1 : 2);
  const evidenceFor = (from: string, to: string) =>
    imports
      .filter((e) => e.fromModule === from && e.toModule === to)
      .sort((a, b) => rank(from, a.from) - rank(from, b.from) || rank(to, a.to) - rank(to, b.to) || a.from.localeCompare(b.from))
      .map((e) => ({ file: e.from, line: e.line, to: e.to }));
  const edges: DEdge[] = [];
  for (const e of atlas.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const evidence = evidenceFor(e.from, e.to);
    if (!expanded.has(e.from) && !expanded.has(e.to)) {
      edges.push({ from: e.from, to: e.to, label: e.label, verified: e.verified, evidence });
      continue;
    }
    // At least one end is open: draw the import lines file to file (or file to module), else keep the module link.
    const drawn = new Set<string>();
    for (const ev of evidence) {
      const a = expanded.has(e.from) ? (fileBox.get(ev.file) ?? e.from) : e.from;
      const b = expanded.has(e.to) ? (fileBox.get(ev.to) ?? e.to) : e.to;
      const k = `${a}>${b}`;
      if (a === b || drawn.has(k)) continue;
      drawn.add(k);
      edges.push({ from: a, to: b, label: e.label, verified: true, evidence: evidence.filter((x) => (fileBox.get(x.file) ?? e.from) === a && (fileBox.get(x.to) ?? e.to) === b) });
    }
    if (!drawn.size) edges.push({ from: e.from, to: e.to, label: e.label, verified: e.verified, evidence });
  }
  // Imports between the files of one opened module.
  for (const id of expanded) {
    for (const e of imports) {
      if (e.fromModule !== id || e.toModule !== id) continue;
      const a = fileBox.get(e.from), b = fileBox.get(e.to);
      if (a && b && a !== b) edges.push({ from: a, to: b, label: "imports", verified: true, evidence: [{ file: e.from, line: e.line, to: e.to }] });
    }
  }
  return { groups: by ? groups.map((g) => ({ id: g.id, title: g.title, color: g.color })) : [], boxes, edges };
}

/** A docs page's diagram: the module opened up into its files, and the modules it links to either way. */
export function neighbourhoodSpec(atlas: Pick<Atlas, "nodes" | "edges">, files: Files, moduleId: string): DiagramSpec {
  const near = new Set([moduleId]);
  for (const e of atlas.edges) {
    if (e.from === moduleId) near.add(e.to);
    if (e.to === moduleId) near.add(e.from);
  }
  const spec = architectureSpec(atlas, { expanded: new Set([moduleId]), files, only: near });
  return { ...spec, groups: [], boxes: spec.boxes.map((b) => ({ ...b, group: undefined })) };
}

// --- Files people take away -------------------------------------------------------------------------------

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The laid-out diagram as a draw.io file: layers as containers, boxes, and links with their bends. */
export function drawioXml(layout: Layout, title = "Architecture"): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const ids = new Map<string, string>();
  let n = 2;
  const id = (key: string) => (ids.has(key) ? ids.get(key)! : (ids.set(key, `c${n++}`), ids.get(key)!));
  for (const g of layout.groups) {
    cells.push(
      `<mxCell id="${id(g.id)}" value="${xml(g.title)}" style="rounded=1;dashed=1;fillColor=none;strokeColor=${g.color};fontColor=${g.color};verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" as="geometry"/></mxCell>`,
    );
  }
  // Compound boxes before the boxes inside them, so draw.io stacks them the right way round.
  const boxes = [...layout.boxes.values()].sort((a, b) => Number(b.box.kind === "compound") - Number(a.box.kind === "compound"));
  for (const p of boxes) {
    const compound = p.box.kind === "compound";
    const label = `${xml(p.box.label)}${p.box.caption ? `&#xa;${xml(p.box.caption)}` : ""}`;
    cells.push(
      `<mxCell id="${id(p.id)}" value="${label}" style="rounded=1;whiteSpace=wrap;html=0;strokeColor=${p.box.color};fillColor=${p.box.color}22;${compound ? "verticalAlign=top;align=left;spacingLeft=10;" : ""}fontStyle=${compound ? 1 : 0};" vertex="1" parent="1"><mxGeometry x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" as="geometry"/></mxCell>`,
    );
  }
  for (const r of layout.routes) {
    const bends = r.points.slice(1, -1).map((pt) => `<mxPoint x="${pt.x}" y="${pt.y}"/>`).join("");
    const [s, e] = [r.points[0], r.points[r.points.length - 1]];
    cells.push(
      `<mxCell id="${id(r.key)}" value="${xml(r.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;${r.verified ? "" : "dashed=1;"}endArrow=block;fontSize=10;" edge="1" parent="1" source="${id(r.from)}" target="${id(r.to)}"><mxGeometry relative="1" as="geometry"><mxPoint x="${s.x}" y="${s.y}" as="sourcePoint"/><mxPoint x="${e.x}" y="${e.y}" as="targetPoint"/>${bends ? `<Array as="points">${bends}</Array>` : ""}</mxGeometry></mxCell>`,
    );
  }
  return `<mxfile host="Codetrail"><diagram name="${xml(title)}"><mxGraphModel dx="${Math.round(layout.w)}" dy="${Math.round(layout.h)}" grid="0"><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}

const THEMES = {
  light: { bg: "#f6f3ec", panel: "#ffffff", fg: "#16171a", fg3: "#6b6e76", line: "#8a88a0" },
  dark: { bg: "#08090b", panel: "#121418", fg: "#eceef2", fg3: "#8b8f98", line: "#8a88a0" },
};

/** A standalone SVG of the laid-out diagram, for a README: no scripts, readable on GitHub's light or dark page. */
export function diagramSvg(layout: Layout, theme: "light" | "dark" = "light", footer?: string): string {
  const t = THEMES[theme];
  const pad = 8;
  const h = layout.h + (footer ? 26 : 0);
  const font = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(layout.w + pad * 2)}" height="${Math.round(h + pad * 2)}" viewBox="${-pad} ${-pad} ${Math.round(layout.w + pad * 2)} ${Math.round(h + pad * 2)}" font-family="${font}">`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${t.line}"/></marker></defs>`,
    `<rect x="${-pad}" y="${-pad}" width="100%" height="100%" fill="${t.bg}"/>`,
  ];
  for (const g of layout.groups) {
    out.push(`<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" fill="${g.color}" fill-opacity="0.06" stroke="${g.color}" stroke-opacity="0.5" stroke-dasharray="5 5"/>`);
    out.push(`<text x="${g.x + 16}" y="${g.y + 22}" font-family="${mono}" font-size="11.5" font-weight="600" letter-spacing="1.6" fill="${g.color}">${xml(g.title.toUpperCase())}</text>`);
  }
  const boxes = [...layout.boxes.values()].sort((a, b) => Number(b.box.kind === "compound") - Number(a.box.kind === "compound"));
  for (const p of boxes) {
    const b = p.box;
    const compound = b.kind === "compound";
    const small = b.kind === "file" || b.kind === "fn" || b.kind === "external";
    out.push(`<g transform="translate(${p.x},${p.y})">`);
    out.push(`<rect width="${p.w}" height="${p.h}" rx="${compound ? 12 : 10}" fill="${t.panel}" stroke="${b.color}" stroke-width="1.4"/>`);
    out.push(`<rect width="${p.w}" height="${compound ? COMPOUND_TOP - 6 : p.h}" rx="${compound ? 12 : 10}" fill="${b.color}" fill-opacity="0.13"/>`);
    if (!small) out.push(`<rect x="0" y="10" width="3.5" height="${(compound ? COMPOUND_TOP : p.h) - 20}" rx="1.75" fill="${b.color}"/>`);
    const lines = compound ? [p.lines.join(" ")] : p.lines;
    const x = small ? 10 : 14;
    const y0 = small ? (b.caption ? 17 : 20) : lines.length > 1 && !compound ? 19 : compound ? 20 : 25;
    lines.forEach((l, i) => out.push(`<text x="${x}" y="${y0 + i * 15}" font-size="${small ? 11.5 : 12.5}" font-weight="${small ? 600 : 700}" fill="${t.fg}"${small ? ` font-family="${mono}"` : ""}>${xml(l)}</text>`));
    if (b.caption) out.push(`<text x="${x}" y="${compound ? 35 : p.h - (small ? 9 : 10)}" font-family="${mono}" font-size="${small ? 9.5 : 10.5}" fill="${t.fg3}">${xml(b.caption.length > 40 ? `…${b.caption.slice(-39)}` : b.caption)}</text>`);
    out.push("</g>");
  }
  for (const r of layout.routes) {
    out.push(`<path d="${rounded(r.points)}" fill="none" stroke="${t.line}" stroke-width="1.5"${r.verified ? "" : ' stroke-dasharray="6 5"'} marker-end="url(#a)"/>`);
  }
  if (footer) out.push(`<text x="0" y="${layout.h + 18}" font-family="${mono}" font-size="11" fill="${t.fg3}">${xml(footer)}</text>`);
  out.push("</svg>");
  return out.join("");
}

/** Any diagram spec as a Mermaid flowchart: groups and opened modules become subgraphs. */
export function specToMermaid(spec: DiagramSpec): string {
  const id = (s: string) => `n_${s.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const text = (s: string) => s.replace(/"/g, "#quot;").replace(/[[\]{}()<>|]/g, " ").trim();
  const lines = [`flowchart ${spec.direction === "RIGHT" ? "LR" : "TD"}`];
  const kids = new Map<string, DBox[]>();
  for (const b of spec.boxes) if (b.parent) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b]);
  const draw = (b: DBox, indent: string) => {
    const inner = kids.get(b.id);
    if (inner?.length) {
      lines.push(`${indent}subgraph ${id(b.id)}["${text(b.label)}"]`, ...inner.map((k) => `${indent}  ${id(k.id)}["${text(k.label)}"]`), `${indent}end`);
    } else lines.push(`${indent}${id(b.id)}["${text(b.label)}"]`);
  };
  const top = spec.boxes.filter((b) => !b.parent);
  for (const g of spec.groups) {
    const mine = top.filter((b) => b.group === g.id);
    if (!mine.length) continue;
    lines.push(`  subgraph ${id(`g_${g.id}`)}["${text(g.title)}"]`);
    mine.forEach((b) => draw(b, "    "));
    lines.push("  end");
  }
  top.filter((b) => !b.group || !spec.groups.some((g) => g.id === b.group)).forEach((b) => draw(b, "  "));
  const seen = new Set<string>();
  for (const e of spec.edges) {
    const k = `${e.from}>${e.to}`;
    if (seen.has(k) || e.from === e.to) continue;
    seen.add(k);
    lines.push(`  ${id(e.from)} ${e.verified ? "-->" : "-.->"}${e.label ? `|"${text(plainLabel(e.label)).slice(0, 40)}"|` : ""} ${id(e.to)}`);
  }
  return lines.join("\n");
}

/** What a box in the call graph points at in the code. */
export type CodeSpot = { file: string; line: number };
type CallsLike = {
  file: string;
  functions: { id: string; name: string; line: number }[];
  calls: { from: string; name: string; line: number; target: { file: string; name: string; line: number } | null }[];
  callers: { file: string; fn: string; line: number; to: string }[];
};
const MAX_CALL_FNS = 40;
const MAX_CALLERS = 8;

/**
 * A file's call graph, left to right: who calls in (grouped by their file), the file's own functions, and what
 * they call (grouped by file). Calls that leave the repo, or that couldn't be placed, are counted, not drawn.
 */
export function callsSpec(c: CallsLike, colors: { here: string; other: string }): { spec: DiagramSpec; spots: Map<string, CodeSpot>; unplaced: number; moreCallers: number } {
  const spots = new Map<string, CodeSpot>();
  const boxes: DBox[] = [];
  const edges: DEdge[] = [];
  const fileBox = (file: string, color: string) => {
    const id = `file:${file}`;
    if (!boxes.some((b) => b.id === id)) boxes.push({ id, label: baseName(file), caption: file, color, kind: "module" });
    return id;
  };
  const fnBox = (file: string, name: string, line: number, color: string) => {
    const id = `fn:${file}::${name}`;
    if (!boxes.some((b) => b.id === id)) {
      boxes.push({ id, label: name, caption: `line ${line}`, color, parent: fileBox(file, color), kind: "fn" });
      spots.set(id, { file, line });
    }
    return id;
  };
  // The file's functions that take part, busiest first, so a big file stays readable.
  const busy = new Map<string, number>();
  for (const x of c.calls) if (x.target) busy.set(x.from, (busy.get(x.from) ?? 0) + 1);
  for (const x of c.callers) busy.set(x.to, (busy.get(x.to) ?? 0) + 1);
  const shown = new Set(
    c.functions
      .filter((f) => busy.has(f.id) || c.functions.length <= 12)
      .sort((a, b) => (busy.get(b.id) ?? 0) - (busy.get(a.id) ?? 0))
      .slice(0, MAX_CALL_FNS)
      .map((f) => f.id),
  );
  for (const f of c.functions) if (shown.has(f.id)) fnBox(c.file, f.id, f.line, colors.here);
  let unplaced = 0;
  for (const x of c.calls) {
    if (!x.target) {
      unplaced++;
      continue;
    }
    if (!shown.has(x.from) && x.from !== "(top level)") continue;
    const from = x.from === "(top level)" ? fnBox(c.file, "(top level)", 1, colors.here) : `fn:${c.file}::${x.from}`;
    const to = x.target.file === c.file ? (shown.has(x.target.name) ? `fn:${c.file}::${x.target.name}` : null) : fnBox(x.target.file, x.target.name, x.target.line, colors.other);
    if (to && to !== from) edges.push({ from, to, label: `line ${x.line}`, verified: true });
  }
  // Callers: the code's own files before tests, examples and benchmarks, a readable handful drawn.
  const minor = (f: string) => (/(^|\/)(tests?|__tests__|spec|examples?|bench(marks)?|e2e|fixtures?)\/|\.(test|spec)\./.test(f) ? 1 : 0);
  const callers = c.callers.filter((x) => shown.has(x.to)).sort((a, b) => minor(a.file) - minor(b.file) || a.file.localeCompare(b.file));
  const drawn = new Set<string>();
  for (const x of callers) {
    const key = `${x.file}::${x.fn}`;
    if (!drawn.has(key) && drawn.size >= MAX_CALLERS) continue;
    drawn.add(key);
    const from = fnBox(x.file, x.fn, x.line, colors.other);
    spots.set(from, { file: x.file, line: x.line });
    edges.push({ from, to: `fn:${c.file}::${x.to}`, label: `${baseName(x.file)}:${x.line}`, verified: true });
  }
  const moreCallers = new Set(callers.map((x) => `${x.file}::${x.fn}`)).size - drawn.size;
  return { spec: { groups: [], boxes, edges, direction: "RIGHT" }, spots, unplaced, moreCallers };
}
