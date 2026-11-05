"use client";

// The map in three views: Architecture (the modules as a layered diagram), Modules (the same map as a graph you
// can drag, relationships labelled) and Files (the real import graph worked out from the code, grouped by module).
import { ChevronDown, List, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupsOf, plainLabel } from "@/lib/architecture";
import { architectureSpec, drawioXml, type Layout, type LinkInfo } from "@/lib/diagram";
import { atlasToMermaid, svgFile, svgToPng } from "@/lib/export-map";
import { formatUsd } from "@/lib/format";
import { promptFor } from "@/lib/prompt";
import { announce, copyText } from "@/lib/announce";
import { useMenu } from "@/lib/use-menu";
import { SUPPORT } from "@/lib/palette";
import type { Atlas, RepoSummary, Tour } from "@/lib/schemas";
import { nodeForFile } from "@/server/trail/ground";
import { ArchitectureView } from "./architecture";
import { CallsView } from "./calls-view";
import { GraphView, type GraphEdge, type GraphNode } from "./graph";

const FILE_CAP = 120;

const shortLabel = (label: string) => {
  const l = label.replace(/\s+/g, " ").trim();
  return l.length > 22 ? `${l.slice(0, 21)}…` : l;
};

type Props = {
  atlas: Atlas;
  summary: RepoSummary;
  tour: Tour | null;
  step: number;
  selected: string | null;
  onSelect: (id: string | null, kind: "module" | "file") => void;
  /** Modules opened into their files on the Architecture view. */
  expanded: Set<string>;
  onToggle: (id: string) => void;
  /** A link was clicked: show the import lines behind it. */
  onEdge: (link: LinkInfo) => void;
  /** Where the README image and the Markdown page are served from. */
  siteUrl: string;
  /** More controls for the bottom toolbar (the phone layout's map size). */
  toolbarExtra?: React.ReactNode;
  /** The file on the Calls view, and a way to open code from it. */
  callsFile: string | null;
  onCallsFile: (path: string) => void;
  onOpenCode: (file: string, line: number) => void;
  /** Names the layers of a map read before reads did (one small call on the module list). */
  onGroupLayers?: () => Promise<void>;
};

const VIEWS = ["architecture", "modules", "files", "calls"] as const;

export function TrailGraph({ atlas, summary, tour, step, selected, onSelect, expanded, onToggle, onEdge, siteUrl, toolbarExtra, callsFile, onCallsFile, onOpenCode, onGroupLayers }: Props) {
  const [view, setView] = useState<"architecture" | "modules" | "files" | "calls">("architecture");
  // "calls" in the code panel brings the Calls view up on that file.
  useEffect(() => {
    if (callsFile) setView("calls");
  }, [callsFile]);
  const [all, setAll] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  // The text version of the current view, and search on the map.
  const [asList, setAsList] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [grouping, setGrouping] = useState(false);
  const unlayered = !atlas.nodes.some((n) => n.layer);
  // The module list in, a few hundred words of layers (and reasoning) out; the repo isn't sent.
  const layersCost = summary.price ? (atlas.nodes.length * 80 + 400) * summary.price.input + 1_500 * summary.price.output : null;
  const box = useRef<HTMLDivElement>(null);

  const save = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    announce(`Downloaded ${name}.`);
    return true;
  };
  /** The current view as an SVG file: the whole diagram on the Architecture view, what's on screen otherwise. */
  const currentSvg = () => {
    const svg = box.current?.querySelector<SVGSVGElement>("svg[role=group]");
    return svg ? svgFile(svg, view === "architecture" && layout ? { w: layout.w, h: layout.h } : undefined) : null;
  };
  const local = summary.owner === "_local";
  const base = `${siteUrl.replace(/\/$/, "")}/${summary.owner}/${summary.repo}`;
  const embed = `[![Architecture of ${summary.owner}/${summary.repo}](${base}/diagram.svg)](${base}) [![Explore with Codetrail](${siteUrl.replace(/\/$/, "")}/badge.svg)](${base})`;
  const embedPng = `[![Architecture of ${summary.owner}/${summary.repo}](${base}/diagram.png)](${base})`;
  // Each returns whether it worked, so the menu never says "Copied" or "Done" for something that didn't happen.
  const exports: { label: string; hint: string; run: () => boolean | Promise<boolean>; show: boolean }[] = [
    { label: "Copy as Mermaid", hint: "The architecture as a Mermaid flowchart, each module linking to its folder on GitHub", run: () => copyText(atlasToMermaid(atlas, summary), "Mermaid copied"), show: view === "architecture" || view === "modules" },
    { label: "Download SVG", hint: `The ${view} view as an SVG image`, run: () => { const f = currentSvg(); return !!f && save(new Blob([f], { type: "image/svg+xml" }), `${summary.repo}-${view}.svg`); }, show: true },
    { label: "Download PNG", hint: `The ${view} view as a PNG image, at twice the size`, run: async () => { const f = currentSvg(); return !!f && save(await svgToPng(f), `${summary.repo}-${view}.png`); }, show: true },
    { label: "Download for draw.io", hint: "An editable draw.io file, with the layers, boxes and links as laid out here", run: () => !!layout && save(new Blob([drawioXml(layout, `${summary.repo} architecture`)], { type: "application/xml" }), `${summary.repo}-architecture.drawio`), show: view === "architecture" && !!layout },
    { label: "Embed in a README (SVG)", hint: `Copies Markdown for a live diagram image and a badge, served from ${siteUrl}`, run: () => copyText(embed, "README Markdown copied"), show: !local && !summary.private },
    { label: "Copy as a prompt for an AI chat", hint: "The architecture as Mermaid with the repo and commit, ready to paste into any AI chat", run: () => copyText(promptFor(atlas, summary, null, summary), "Prompt copied. Paste it into any AI chat"), show: true },
    { label: "Embed in a README (PNG)", hint: `Copies Markdown for a PNG card of the diagram, for places that don't show SVG images`, run: () => copyText(embedPng, "README Markdown copied"), show: !local && !summary.private },
    { label: "Markdown for AI tools", hint: "This repo's map, tours and docs as one Markdown page an AI tool can read", run: () => !!window.open(`/${summary.owner}/${summary.repo}.md`, "_blank"), show: true },
  ];

  const moduleOf = useMemo(() => {
    const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
    const cache = new Map<string, string>();
    return (path: string) => {
      if (!cache.has(path)) cache.set(path, nodeForFile(path, nodes) ?? "");
      return cache.get(path)!;
    };
  }, [atlas]);
  // One colour per layer (or kind), the same on every view.
  const colorOf = useMemo(() => groupsOf(atlas.nodes).color, [atlas]);
  const labelOf = useMemo(() => new Map(atlas.nodes.map((n) => [n.id, n.label])), [atlas]);

  const modules = useMemo(() => {
    const lines = new Map<string, number>();
    for (const [path, l] of summary.fileSizes) {
      const m = moduleOf(path);
      lines.set(m, (lines.get(m) ?? 0) + l);
    }
    const nodes: GraphNode[] = atlas.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      color: colorOf.get(n.id) ?? SUPPORT,
      weight: Math.max(1, lines.get(n.id) ?? n.files.length * 50),
      kind: `${n.kind} · ${n.files.length} key ${n.files.length === 1 ? "file" : "files"}`,
      detail: n.purpose,
    }));
    const edges: GraphEdge[] = atlas.edges.map((e) => ({ source: e.from, target: e.to, label: shortLabel(e.label), verified: e.verified }));
    return { nodes, edges };
  }, [atlas, summary, moduleOf, colorOf]);

  const files = useMemo(() => {
    const fanIn = new Map<number, number>();
    for (const [, to] of summary.imports) fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
    const onTour = new Set([...(tour?.steps.map((s) => s.file) ?? []), ...(tour?.pull?.files.map((f) => f.path) ?? [])]);
    const ranked = summary.fileSizes
      .map(([path, lines], i) => ({ i, path, lines, score: (onTour.has(path) ? 1000 : 0) + (fanIn.get(i) ?? 0) * 10 + (summary.imports.some(([a]) => a === i) ? 1 : 0) }))
      .filter((f) => f.score > 0 || onTour.has(f.path))
      .sort((a, b) => b.score - a.score);
    const chosen = all ? ranked : ranked.slice(0, FILE_CAP);
    const keep = new Set(chosen.map((f) => f.i));
    const nodes: GraphNode[] = chosen.map((f) => {
      const m = moduleOf(f.path);
      return {
        id: f.path,
        label: f.path.split("/").pop() ?? f.path,
        color: colorOf.get(m) ?? SUPPORT,
        weight: Math.max(5, f.lines),
        group: m || undefined,
        groupLabel: labelOf.get(m),
        kind: `${f.lines.toLocaleString()} lines · imported by ${fanIn.get(f.i) ?? 0}`,
        detail: f.path,
      };
    });
    const edges: GraphEdge[] = summary.imports.filter(([a, b]) => keep.has(a) && keep.has(b)).map(([a, b]) => ({ source: summary.fileSizes[a][0], target: summary.fileSizes[b][0], label: "imports", verified: true }));
    return { nodes, edges, total: ranked.length };
  }, [summary, tour, all, moduleOf, colorOf, labelOf]);

  const current = tour?.steps[step];
  const previous = tour && step > 0 ? tour.steps[step - 1] : undefined;
  const visited = useMemo(() => {
    const m = new Map<string, number[]>();
    tour?.steps.forEach((s, i) => {
      const key = view === "files" ? s.file : s.node;
      if (!key || s.stale) return;
      m.set(key, [...(m.get(key) ?? []), i + 1]);
    });
    return m;
  }, [tour, view]);

  // A PR tour marks what it changes: its modules on the module map, its files on the file graph.
  const changed = useMemo(() => (tour?.pull ? new Set([...(tour.modules ?? []), ...tour.pull.files.map((f) => f.path)]) : undefined), [tour]);

  const g = view === "files" ? files : modules;

  function choose(v: (typeof VIEWS)[number]) {
    setView(v);
    setHit(0);
    if (v === "calls" && !callsFile) {
      const start = tour?.steps[step]?.file || (summary.entries.find((e) => /\.(m?[jt]sx?|py|go)$/.test(e)) ?? null);
      if (start) onCallsFile(start);
    }
  }

  // Search: module names and file paths (function names on the Calls view, handled there).
  const needle = query.trim().toLowerCase();
  type Match = { id: string; module: string; file?: string };
  const found = useMemo((): Match[] => {
    if (needle.length < 2 || view === "calls") return [];
    const mods: Match[] = atlas.nodes.filter((n) => n.label.toLowerCase().includes(needle) || n.id.includes(needle)).map((n) => ({ id: n.id, module: n.id }));
    const paths = summary.fileSizes
      .map(([p]) => p)
      .filter((p) => p.toLowerCase().includes(needle))
      .slice(0, 50)
      .map((p) => ({ id: p, module: moduleOf(p), file: p }));
    return [...mods, ...paths];
  }, [needle, view, atlas, summary, moduleOf]);
  // What lights up on each view: modules (or a file inside an opened module) on the maps, files on the file graph.
  const highlight = useMemo(() => {
    if (!found.length) return null;
    if (view === "files") return new Set(found.filter((f) => f.file).map((f) => f.id));
    return new Set(found.flatMap((f) => (f.file ? (expanded.has(f.module) ? [`${f.module}::${f.file}`, f.module] : [f.module]) : [f.id])));
  }, [found, view, expanded]);
  const currentHit = found.length ? found[hit % found.length] : null;
  const focusId = currentHit ? (view === "architecture" && currentHit.file && expanded.has(currentHit.module) ? `${currentHit.module}::${currentHit.file}` : currentHit.file && view === "files" ? currentHit.file : currentHit.module) : null;
  const active = current ? (view === "files" ? current.file : current.node) : null;
  const prev = previous ? (view === "files" ? previous.file : previous.node) : null;

  return (
    <div ref={box} className="relative h-full w-full dot-grid">
      <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1.5">
        <div role="tablist" aria-label="Map view" className="flex gap-0.5 overflow-x-auto rounded-[10px] border border-line bg-panel/90 p-[3px] backdrop-blur">
          {VIEWS.map((v, i) => (
            <button
              key={v}
              id={`map-tab-${v}`}
              role="tab"
              aria-selected={view === v}
              aria-controls="map-panel"
              tabIndex={view === v ? 0 : -1}
              onClick={() => choose(v)}
              onKeyDown={(e) => {
                const to = e.key === "ArrowRight" ? (i + 1) % VIEWS.length : e.key === "ArrowLeft" ? (i - 1 + VIEWS.length) % VIEWS.length : e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : -1;
                if (to < 0) return;
                e.preventDefault();
                choose(VIEWS[to]);
                document.getElementById(`map-tab-${VIEWS[to]}`)?.focus();
              }}
              className={`shrink-0 rounded-[7px] border-b-2 px-3 py-1.5 font-mono text-[11.5px] tracking-[0.12em] uppercase transition ${view === v ? "border-trail bg-fg text-ink" : "border-transparent text-fg-3 hover:text-fg"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAsList((l) => !l)}
          aria-pressed={asList}
          title="Show this view as a list you can read and tab through"
          className={`inline-flex items-center gap-1.5 rounded-[10px] border px-2.5 py-2 font-mono text-[11px] tracking-[0.08em] uppercase backdrop-blur ${asList ? "border-fg bg-fg text-ink" : "border-line bg-panel/90 text-fg-3 hover:text-fg"}`}
        >
          <List className="size-3.5" aria-hidden /> List
        </button>
      </div>
      <div className={`pointer-events-none absolute top-3 right-3 z-10 hidden max-w-[calc(100%-400px)] flex-wrap justify-end gap-x-4 gap-y-1 rounded-[9px] bg-ink/75 px-2.5 py-1.5 font-mono text-[11px] text-fg-3 backdrop-blur ${view === "calls" ? "" : "sm:flex"}`}>
        <span className="flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden>
            <line x1="0" y1="3" x2="20" y2="3" stroke={view === "architecture" ? "#8a88a0" : "#3987e5"} strokeWidth="2" />
          </svg>
          imports in code
        </span>
        {tour && (
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-[#ffb020] px-1.5 text-[9px] leading-[14px] font-bold text-[#07080c]">1,2</span>
            tour steps
          </span>
        )}
        {changed && (
          <span className="flex items-center gap-1.5">
            <span className="grid size-3.5 place-items-center rounded-full bg-[#2ea043] text-[9px] font-bold text-white">±</span>
            changed in this PR
          </span>
        )}
        {view !== "files" && (
          <span className="flex items-center gap-1.5">
            <svg width="20" height="6" aria-hidden>
              <line x1="0" y1="3" x2="20" y2="3" stroke="#8a88a0" strokeWidth="1.6" strokeDasharray="4 4" />
            </svg>
            inferred by the model
          </span>
        )}
      </div>
      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (!found.length) return;
            const next = (hit + 1) % found.length;
            const m = found[next];
            // A file inside a closed module: open the module so the file shows.
            if (view === "architecture" && m.file && m.module && !expanded.has(m.module)) onToggle(m.module);
            setHit(next);
          }}
          className="flex items-center gap-1.5 rounded-[9px] border border-line bg-panel/90 px-2 py-1 backdrop-blur focus-within:border-trail/60"
        >
          <Search className="size-3.5 shrink-0 text-fg-3" aria-hidden />
          <label htmlFor="map-find" className="sr-only">
            Find on the map: a module, a file{view === "calls" ? " or a function" : ""}
          </label>
          <input
            id="map-find"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHit(0);
            }}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={view === "calls" ? "Find a function" : "Find a module or file"}
            className="w-36 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-fg-3 sm:w-44"
          />
          {needle.length >= 2 && view !== "calls" && (
            <span className="shrink-0 font-mono text-[10.5px] text-fg-3" aria-live="polite">
              {found.length ? `${(hit % found.length) + 1}/${found.length}` : "none"}
              <span className="sr-only">{found.length ? ` matches. Enter shows the next.` : " match."}</span>
            </span>
          )}
        </form>
        <ExportMenu items={exports.filter((x) => x.show)} />
        {toolbarExtra}
        {view !== "calls" && view !== "files" && !asList && (
          <span className="rounded-[8px] bg-ink/80 px-2 py-1 font-mono text-[10.5px] text-fg-3 sm:hidden">solid: imports · dashed: inferred</span>
        )}
        {view === "architecture" && expanded.size > 0 && (
          <button onClick={() => [...expanded].forEach(onToggle)} className="rounded-[9px] border border-line bg-panel/90 px-2.5 py-1.5 font-mono text-[11px] text-fg-2 hover:text-fg">
            Close opened modules
          </button>
        )}
        {view === "architecture" && unlayered && onGroupLayers && (
          <button
            disabled={grouping}
            onClick={() => {
              setGrouping(true);
              onGroupLayers().finally(() => setGrouping(false));
            }}
            title="Ask the model to group these modules into architecture layers. Only the module list is sent, not the repo."
            className="rounded-[9px] border border-trail/50 bg-panel/90 px-2.5 py-1.5 font-mono text-[11px] text-fg hover:border-trail disabled:opacity-60"
          >
            {grouping ? "Grouping into layers…" : `Group into layers${layersCost ? ` · ≈ ${formatUsd(layersCost)}` : ""}`}
          </button>
        )}
        {view === "files" && files.total > FILE_CAP && (
          <button onClick={() => setAll((a) => !a)} className="rounded-[9px] border border-line bg-panel/90 px-2.5 py-1.5 font-mono text-[11px] text-fg-2 hover:text-fg">
            {all ? `Top ${FILE_CAP} only` : `${FILE_CAP} of ${files.total} files · show all`}
          </button>
        )}
      </div>
      <div id="map-panel" role="tabpanel" aria-labelledby={`map-tab-${view}`} className="absolute inset-0">
      {view === "calls" ? (
        <CallsView summary={summary} file={callsFile} onFile={onCallsFile} onOpen={(spot) => onOpenCode(spot.file, spot.line)} asList={asList} query={query} />
      ) : asList ? (
        <MapList view={view} atlas={atlas} summary={summary} expanded={expanded} highlight={highlight} onSelect={onSelect} onEdge={onEdge} />
      ) : view === "architecture" ? (
        <ArchitectureView
          atlas={atlas}
          summary={summary}
          expanded={expanded}
          active={active}
          previous={prev}
          visited={visited}
          changed={changed}
          selected={selected}
          // A file inside an opened module has the id "module::path".
          onSelect={(id) => (id?.includes("::") ? onSelect(id.slice(id.indexOf("::") + 2), "file") : onSelect(id, "module"))}
          onToggle={onToggle}
          onEdge={onEdge}
          onLayout={setLayout}
          highlight={highlight}
          focusId={focusId}
        />
      ) : g.nodes.length === 0 ? (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-fg-3">No import links were found between the files read, so there is no file graph for this repo.</p>
      ) : (
        <GraphView
          key={view}
          nodes={g.nodes}
          edges={g.edges}
          active={active}
          previous={prev}
          visited={visited}
          changed={changed}
          selected={selected}
          onSelect={(id) => onSelect(id, view === "modules" ? "module" : "file")}
          edgeLabels={view === "modules" && g.edges.length <= 16 ? "all" : "focus"}
          minRadius={view === "modules" ? 20 : 7}
          maxRadius={view === "modules" ? 48 : 26}
          highlight={highlight}
        />
      )}
      </div>
    </div>
  );
}

/** One menu for every way to take the map away. */
function ExportMenu({ items }: { items: { label: string; hint: string; run: () => boolean | Promise<boolean> }[] }) {
  const m = useMenu();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="relative">
      <button
        ref={m.trigger}
        onClick={() => m.setOpen((o) => !o)}
        onKeyDown={m.onTriggerKey}
        aria-expanded={m.open}
        aria-haspopup="menu"
        aria-controls="map-export-menu"
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-panel/90 px-2.5 py-1.5 font-mono text-[11px] text-fg-2 hover:text-fg"
      >
        {done ?? "Export"} <ChevronDown className="size-3" aria-hidden />
      </button>
      {m.open && (
        <ul id="map-export-menu" ref={m.menu} role="menu" aria-label="Export" onKeyDown={m.onMenuKey} className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-[10px] border border-line bg-panel p-1 shadow-lg">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                role="menuitem"
                tabIndex={-1}
                onClick={m.pick(async () => {
                  const ok = await item.run();
                  setDone(ok ? (item.label.startsWith("Copy") || item.label.startsWith("Embed") ? "Copied" : "Done") : "Didn't work");
                  setTimeout(() => setDone(null), 1800);
                })}
                className="block w-full rounded-[7px] px-2.5 py-2 text-left hover:bg-raised focus:bg-raised"
              >
                <span className="block text-[12.5px] text-fg">{item.label}</span>
                <span className="block text-[11px] leading-snug text-fg-3">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The map as text: every layer and module with what it does, its files when opened, and its links, each link a
 * button to the import lines behind it. On the Files view, every file with what it imports.
 */
function MapList({ view, atlas, summary, expanded, highlight, onSelect, onEdge }: { view: "architecture" | "modules" | "files"; atlas: Atlas; summary: RepoSummary; expanded: Set<string>; highlight: Set<string> | null; onSelect: (id: string | null, kind: "module" | "file") => void; onEdge: (link: LinkInfo) => void }) {
  const spec = useMemo(() => architectureSpec(atlas, { files: summary, expanded }), [atlas, summary, expanded]);
  const { groups } = useMemo(() => groupsOf(atlas.nodes), [atlas.nodes]);
  const label = (id: string) => atlas.nodes.find((n) => n.id === id)?.label ?? (id.includes("::") ? id.slice(id.indexOf("::") + 2) : id);
  if (view === "files") {
    const byFile = new Map<number, number[]>();
    for (const [a, b] of summary.imports) byFile.set(a, [...(byFile.get(a) ?? []), b]);
    return (
      <div className="absolute inset-0 overflow-y-auto px-4 pt-16 pb-16">
        <h2 className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Files and what they import</h2>
        <ul className="mt-2 space-y-1.5">
          {summary.fileSizes
            .map(([path], i) => ({ path, imports: byFile.get(i) ?? [] }))
            .filter((f) => f.imports.length && (!highlight || highlight.has(f.path)))
            .slice(0, 400)
            .map((f) => (
              <li key={f.path} className="text-[12.5px] text-fg-2">
                <button onClick={() => onSelect(f.path, "file")} className="font-mono text-fg hover:text-trail">
                  {f.path}
                </button>{" "}
                imports {f.imports.map((j) => summary.fileSizes[j][0]).join(", ")}
              </li>
            ))}
        </ul>
      </div>
    );
  }
  const linksOf = (id: string) => spec.edges.filter((e) => (e.from === id || e.to === id) && !e.from.includes("::") && !e.to.includes("::"));
  const groupOf = (id: string) => groups.find((g) => g.nodes.includes(id))?.title;
  const shown = atlas.nodes.filter((n) => !highlight || highlight.has(n.id));
  return (
    <div className="absolute inset-0 overflow-y-auto px-4 pt-16 pb-16">
      <h2 className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">Modules and how they connect</h2>
      <ul className="mt-2 space-y-3">
        {shown.map((n) => (
          <li key={n.id} className="rounded-[10px] border border-line bg-panel px-3 py-2">
            <h3>
              <button onClick={() => onSelect(n.id, "module")} className="text-[14px] font-medium text-fg hover:text-trail">
                {n.label}
              </button>
              {groupOf(n.id) && <span className="ml-2 font-mono text-[11px] text-fg-3">{groupOf(n.id)}</span>}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-fg-2">{n.purpose}</p>
            {expanded.has(n.id) && (
              <p className="mt-1 text-[12px] text-fg-3">
                Files:{" "}
                {spec.boxes
                  .filter((b) => b.parent === n.id)
                  .map((b, i) => (
                    <span key={b.id}>
                      {i > 0 && ", "}
                      <button onClick={() => onSelect(b.id.slice(b.id.indexOf("::") + 2), "file")} className="font-mono text-fg-2 underline decoration-line underline-offset-2 hover:text-fg">
                        {b.label}
                      </button>
                    </span>
                  ))}
              </p>
            )}
            {linksOf(n.id).length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {linksOf(n.id).map((e) => (
                  <li key={`${e.from}>${e.to}`}>
                    <button
                      onClick={() => onEdge({ from: e.from, to: e.to, label: plainLabel(e.label ?? ""), verified: e.verified, evidence: e.evidence ?? [] })}
                      className="text-left text-[12.5px] text-fg-2 hover:text-fg"
                    >
                      {e.from === n.id ? `→ ${label(e.to)}` : `← ${label(e.from)}`}
                      <span className="ml-1.5 font-mono text-[11px] text-fg-3">{e.verified ? `${e.evidence?.length ?? 0} imports` : "inferred"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {!shown.length && <li className="text-[13px] text-fg-3">No module matches your search.</li>}
      </ul>
    </div>
  );
}
