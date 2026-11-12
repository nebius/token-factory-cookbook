"use client";

// A graph-database style view (think Neo4j Browser): circles sized by how much code they hold, labelled
// arrows for relationships, a force layout you can drag, zoom and pan, and hover to see a node's
// neighbourhood. Used for both the module map and the file-level import graph.
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { drag as d3drag } from "d3-drag";
import { select } from "d3-selection";
import "d3-transition";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { touchFriendly } from "@/lib/touch";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export type GraphNode = {
  id: string;
  label: string;
  color: string;
  /** Relative size (lines, files…): the circle's area follows it. */
  weight: number;
  /** Nodes with the same group are pulled together (the file graph groups by module). */
  group?: string;
  groupLabel?: string;
  kind?: string;
  detail?: string;
};
export type GraphEdge = { source: string; target: string; label?: string; verified?: boolean };

type SimNode = GraphNode & SimulationNodeDatum & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { label?: string; verified?: boolean; key: string };

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  active: string | null;
  previous: string | null;
  /** Node id → step numbers on the current tour. */
  visited: Map<string, number[]>;
  /** Nodes a pull request changes: marked with a "±" badge. */
  changed?: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Draw relationship labels on every edge (small graphs) or only on hover / the active hop. */
  edgeLabels?: "all" | "focus";
  minRadius?: number;
  maxRadius?: number;
  /** Search matches: lit, the rest dimmed. */
  highlight?: Set<string> | null;
};
// Small nodes keep their caption for hover, the tour and selection, so a big file graph stays readable.
const CAPTION_MIN_R = 16;

const OUTLINE = "var(--color-outline)";
const TRAIL = "#ffb020";

/** Offsets an edge's control point sideways, so A→B and B→A don't draw on top of each other. */
function curve(s: SimNode, t: SimNode, bend: number) {
  const x1 = s.x ?? 0, y1 = s.y ?? 0, x2 = t.x ?? 0, y2 = t.y ?? 0;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Start and end on the circles' rims, not their centres, so arrowheads stay visible.
  const sx = x1 + (dx / len) * s.r, sy = y1 + (dy / len) * s.r;
  const ex = x2 - (dx / len) * (t.r + 6), ey = y2 - (dy / len) * (t.r + 6);
  const mx = (sx + ex) / 2 - (dy / len) * bend, my = (sy + ey) / 2 + (dx / len) * bend;
  return { d: `M${sx},${sy} Q${mx},${my} ${ex},${ey}`, lx: (sx + 2 * mx + ex) / 4, ly: (sy + 2 * my + ey) / 4, angle: (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI };
}

export function GraphView({ nodes, edges, active, previous, visited, changed, selected, onSelect, edgeLabels = "focus", minRadius = 18, maxRadius = 46, highlight }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const [, setTick] = useState(0);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const still = useReducedMotion();
  const fitRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // Build the simulation's own copies, keeping positions of nodes that survive a data change.
  const sim = useMemo(() => {
    const prev = new Map((simRef.current?.nodes() ?? []).map((n) => [n.id, n]));
    const max = Math.max(1, ...nodes.map((n) => n.weight));
    const simNodes: SimNode[] = [...new Map(nodes.map((n) => [n.id, n])).values()].map((n) => {
      const old = prev.get(n.id);
      const r = minRadius + (maxRadius - minRadius) * Math.sqrt(n.weight / max);
      return { ...n, r, x: old?.x, y: old?.y, vx: old?.vx, vy: old?.vy };
    });
    const ids = new Set(simNodes.map((n) => n.id));
    const pairs = new Set(edges.map((e) => `${e.source}>${e.target}`));
    // One link per pair: a model streaming its map can name the same connection twice.
    const seen = new Set<string>();
    const simLinks: SimLink[] = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target && !seen.has(`${e.source}>${e.target}`) && !!seen.add(`${e.source}>${e.target}`))
      .map((e) => ({ source: e.source, target: e.target, label: e.label, verified: e.verified, key: `${e.source}>${e.target}`, bidirectional: pairs.has(`${e.target}>${e.source}`) }) as SimLink);
    return { simNodes, simLinks };
  }, [nodes, edges, minRadius, maxRadius]);

  // Size from the container.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Physics. Groups get their own anchor points on a circle, so modules form visible neighbourhoods.
  useEffect(() => {
    const { simNodes, simLinks } = sim;
    const groups = [...new Set(simNodes.map((n) => n.group).filter((g): g is string => !!g))];
    const ring = Math.min(size.w, size.h) * 0.32;
    const anchor = new Map(groups.map((g, i) => [g, { x: Math.cos((i / groups.length) * Math.PI * 2) * ring, y: Math.sin((i / groups.length) * Math.PI * 2) * ring }]));
    const clustered = groups.length > 1;
    const s = forceSimulation<SimNode, SimLink>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance((l) => ((l.source as SimNode).r + (l.target as SimNode).r) * (clustered ? 1.4 : 2) + (clustered ? 40 : 110)).strength(clustered ? 0.25 : 0.4))
      .force("charge", forceManyBody<SimNode>().strength((d) => (clustered ? -160 : -520) - d.r * 10))
      // Room for the caption pill under each node, not just the circle.
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + (clustered ? 18 : 46)).iterations(3))
      .force("center", forceCenter(0, 0))
      .force("x", forceX<SimNode>((d) => (d.group && anchor.get(d.group)?.x) || 0).strength(clustered ? 0.12 : 0.04))
      .force("y", forceY<SimNode>((d) => (d.group && anchor.get(d.group)?.y) || 0).strength(clustered ? 0.12 : 0.04))
      .alphaDecay(0.035);
    let frame = 0;
    let fitted = false;
    s.on("tick", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
      // Once the layout has mostly settled, frame the whole graph (unless a tour step is steering the view).
      if (!fitted && s.alpha() < 0.12) {
        fitted = true;
        if (!activeRef.current) fitRef.current?.();
      }
    });
    simRef.current = s;
    return () => {
      cancelAnimationFrame(frame);
      s.stop();
    };
  }, [sim, size.w, size.h]);

  // Zoom and pan; start centred.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 3])
      .filter(touchFriendly)
      .on("zoom", (e) => setTransform(e.transform));
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    select(svg).call(z.transform, zoomIdentity.translate(size.w / 2, size.h / 2).scale(0.85));
  }, [size.w, size.h]);

  // Drag nodes (they stay where you drop them until you double-click).
  useEffect(() => {
    const g = gRef.current;
    const s = simRef.current;
    if (!g || !s) return;
    const behaviour = d3drag<SVGGElement, unknown>()
      .on("start", function (e) {
        const n = s.nodes().find((x) => x.id === this.dataset.id);
        if (!n) return;
        if (!e.active) s.alphaTarget(0.25).restart();
        n.fx = n.x;
        n.fy = n.y;
      })
      .on("drag", function (e) {
        const n = s.nodes().find((x) => x.id === this.dataset.id);
        if (!n) return;
        n.fx = e.x;
        n.fy = e.y;
      })
      .on("end", function (e) {
        if (!e.active) s.alphaTarget(0);
      });
    select(g).selectAll<SVGGElement, unknown>("g[data-id]").call(behaviour);
  });

  // Follow the tour: glide to the hop between the previous and the current step.
  useEffect(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z || !active) return;
    const t = setTimeout(() => {
      const list = simRef.current?.nodes() ?? [];
      const a = list.find((n) => n.id === active);
      const p = list.find((n) => n.id === previous) ?? a;
      if (!a || a.x === undefined || a.y === undefined) return;
      const cx = ((a.x ?? 0) + (p?.x ?? 0)) / 2;
      const cy = ((a.y ?? 0) + (p?.y ?? 0)) / 2;
      const k = Math.max(transform.k, 0.75);
      select(svg)
        .transition()
        .duration(700)
        .call(z.transform, zoomIdentity.translate(size.w / 2, size.h / 2).scale(k).translate(-cx, -cy));
    }, 250);
    return () => clearTimeout(t);
    // Only when the step moves, not on every zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, previous]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (svg && z) select(svg).transition().duration(still ? 0 : 250).call(z.scaleBy, factor);
  };
  // Focus that came from a click, not the keyboard: the arrows then keep stepping the tour instead of panning.
  const clicked = useRef(false);
  /** + − 0 zoom and fit; the arrows pan when the graph itself (not a node) has keyboard focus. */
  const onKey = (e: React.KeyboardEvent) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z || e.ctrlKey || e.metaKey || e.altKey) return;
    const onNode = (e.target as Element).closest?.("g[data-id]") || clicked.current;
    const pan = (dx: number, dy: number) => select(svg).call(z.translateBy, dx / transform.k, dy / transform.k);
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.25);
    else if (e.key === "0") fit();
    else if (!onNode && e.key === "ArrowLeft") pan(60, 0);
    else if (!onNode && e.key === "ArrowRight") pan(-60, 0);
    else if (!onNode && e.key === "ArrowUp") pan(0, 60);
    else if (!onNode && e.key === "ArrowDown") pan(0, -60);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const fit = () => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    const list = simRef.current?.nodes() ?? [];
    if (!svg || !z || !list.length) return;
    const xs = list.map((n) => n.x ?? 0), ys = list.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 80;
    const k = Math.min(2, size.w / (maxX - minX), size.h / (maxY - minY));
    select(svg)
      .transition()
      .duration(500)
      .call(z.transform, zoomIdentity.translate(size.w / 2, size.h / 2).scale(k).translate(-(minX + maxX) / 2, -(minY + maxY) / 2));
  };

  fitRef.current = fit;
  const simNodes = simRef.current?.nodes() ?? sim.simNodes;
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const links = sim.simLinks;
  const focus = hover ?? selected;
  const neighbours = new Set<string>();
  if (focus) {
    neighbours.add(focus);
    for (const l of links) {
      const s = (l.source as SimNode).id ?? (l.source as unknown as string);
      const t = (l.target as SimNode).id ?? (l.target as unknown as string);
      if (s === focus) neighbours.add(t);
      if (t === focus) neighbours.add(s);
    }
  }
  const touring = visited.size > 0;
  const hopKey = active && previous && active !== previous ? [`${previous}>${active}`, `${active}>${previous}`] : [];
  const hasHopEdge = links.some((l) => hopKey.includes(l.key));

  // Group labels sit at the centre of each group's nodes.
  // Each group gets a faint ring around its nodes with its name on top, like a region on a trail map.
  const groupLabels = (() => {
    const acc = new Map<string, { nodes: SimNode[]; label: string; color: string }>();
    for (const n of simNodes) {
      if (!n.group || n.x === undefined) continue;
      const g = acc.get(n.group) ?? { nodes: [], label: n.groupLabel ?? n.group, color: n.color };
      g.nodes.push(n);
      acc.set(n.group, g);
    }
    return [...acc.entries()]
      .filter(([, g]) => g.nodes.length > 1)
      .map(([id, g]) => {
        const x = g.nodes.reduce((a, n) => a + (n.x ?? 0), 0) / g.nodes.length;
        const y = g.nodes.reduce((a, n) => a + (n.y ?? 0), 0) / g.nodes.length;
        const r = Math.max(...g.nodes.map((n) => Math.hypot((n.x ?? 0) - x, (n.y ?? 0) - y) + n.r)) + 28;
        return { id, x, y, r, label: g.label, color: g.color };
      });
  })();

  const hoverNode = hover ? byId.get(hover) : undefined;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        className="h-full w-full touch-pan-y select-none lg:touch-none"
        role="group"
        tabIndex={0}
        aria-label="Graph of the repository. Tab through the nodes; Enter selects one. Plus and minus zoom, 0 fits, arrows pan."
        onKeyDown={onKey}
        onPointerDown={() => (clicked.current = true)}
        onBlur={(e) => !svgRef.current?.contains(e.relatedTarget as Node | null) && (clicked.current = false)}
        onClick={(e) => e.target === svgRef.current && onSelect(null)}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#8a88a0" />
          </marker>
          <marker id="arrow-verified" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#3987e5" />
          </marker>
          <marker id="arrow-trail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={TRAIL} style={{ stroke: OUTLINE }} strokeWidth="1" />
          </marker>
        </defs>
        <g ref={gRef} transform={transform.toString()}>
          {/* Group rings behind everything. */}
          {groupLabels.map((g) => (
            <g key={g.id} className="pointer-events-none" opacity={focus ? 0.35 : 1}>
              <circle cx={g.x} cy={g.y} r={g.r} fill={g.color} fillOpacity={0.04} stroke={g.color} strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="3 6" />
              <text x={g.x} y={g.y - g.r - 10} textAnchor="middle" className="font-mono uppercase" fontSize={12} letterSpacing="0.2em" fill={g.color}>
                {g.label}
              </text>
            </g>
          ))}

          {/* Relationships. */}
          {links.map((l) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            if (s.x === undefined || t.x === undefined) return null;
            const bidirectional = (l as SimLink & { bidirectional?: boolean }).bidirectional;
            const c = curve(s, t, bidirectional ? 26 : 10);
            const isHop = hopKey.includes(l.key);
            const lit = !focus || (neighbours.has(s.id) && neighbours.has(t.id));
            const showLabel = l.label && (isHop || edgeLabels === "all" || (focus && (s.id === focus || t.id === focus)));
            const flip = c.angle > 90 || c.angle < -90;
            return (
              <g key={l.key} opacity={lit ? 1 : 0.12}>
                <path
                  id={`edge-${l.key}`}
                  d={c.d}
                  fill="none"
                  stroke={isHop ? TRAIL : l.verified ? "#3987e5" : "#8a88a0"}
                  strokeWidth={isHop ? 4 : l.verified ? 2.2 : 1.8}
                  strokeDasharray={isHop ? "2 9" : l.verified ? undefined : "6 6"}
                  strokeLinecap="round"
                  className={isHop ? "trail-dash" : undefined}
                  markerEnd={`url(#${isHop ? "arrow-trail" : l.verified ? "arrow-verified" : "arrow"})`}
                />
                {isHop && !still && (
                  <circle r={7} fill={TRAIL} style={{ stroke: OUTLINE }} strokeWidth={2.5}>
                    <animateMotion dur="1.4s" repeatCount="indefinite" keyPoints={l.key === hopKey[0] ? "0;1" : "1;0"} keyTimes="0;1" calcMode="linear">
                      <mpath href={`#edge-${l.key}`} />
                    </animateMotion>
                  </circle>
                )}
                {showLabel && (
                  <g transform={`translate(${c.lx},${c.ly}) rotate(${flip ? c.angle + 180 : c.angle})`} className="pointer-events-none">
                    <rect x={-(l.label!.length * 3.3) - 8} y={-9} width={l.label!.length * 6.6 + 16} height={18} rx={9} style={{ fill: "var(--color-ink)", stroke: isHop ? TRAIL : "var(--color-line)" }} strokeWidth={1.5} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={700} letterSpacing="0.06em" style={{ fill: isHop ? TRAIL : "var(--color-fg-2)" }} className="font-mono uppercase">
                      {l.label!.toUpperCase()}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* A hop the map has no edge for: drawn for this step only. */}
          {hopKey.length > 0 && !hasHopEdge && byId.get(previous!)?.x !== undefined && byId.get(active!)?.x !== undefined && (
            <g>
              <path id="edge-hop" d={curve(byId.get(previous!)!, byId.get(active!)!, 30).d} fill="none" stroke={TRAIL} strokeWidth={4} strokeDasharray="2 9" strokeLinecap="round" className="trail-dash" markerEnd="url(#arrow-trail)" />
              {!still && (
                <circle r={7} fill={TRAIL} style={{ stroke: OUTLINE }} strokeWidth={2.5}>
                  <animateMotion dur="1.4s" repeatCount="indefinite">
                    <mpath href="#edge-hop" />
                  </animateMotion>
                </circle>
              )}
            </g>
          )}

          {/* Nodes. */}
          {simNodes.map((n) => {
            if (n.x === undefined || n.y === undefined) return null;
            const isActive = n.id === active;
            const steps = visited.get(n.id);
            const lit = !focus || neighbours.has(n.id);
            const found = highlight?.size ? highlight.has(n.id) : null;
            const dim = found === false || !lit || (touring && !steps && !isActive && !focus);
            const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
            return (
              <g
                key={n.id}
                data-id={n.id}
                transform={`translate(${n.x},${n.y})`}
                className="cursor-pointer"
                opacity={dim ? (found === false ? 0.22 : 0.4) : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(n.id === selected ? null : n.id);
                }}
                onDoubleClick={() => {
                  n.fx = null;
                  n.fy = null;
                  simRef.current?.alpha(0.3).restart();
                }}
                role="button"
                tabIndex={0}
                aria-pressed={n.id === selected}
                aria-label={`${n.label}${found ? ", matches your search" : ""}${n.kind ? `, ${n.kind}` : ""}${changed?.has(n.id) ? ", changed in this pull request" : ""}${steps ? `, tour steps ${steps.join(", ")}` : ""}${isActive ? ", current step" : ""}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(n.id === selected ? null : n.id);
                  }
                }}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover((h) => (h === n.id ? null : h))}
              >
                {isActive && <circle r={n.r} fill="none" stroke="#ffb020" strokeWidth={3} className="pulse-ring" style={{ ["--r0" as string]: `${n.r}px`, ["--r1" as string]: `${n.r + 26}px` }} />}
                                                <circle r={n.r} fill={isActive ? TRAIL : n.color} style={{ stroke: "var(--color-ink)" }} strokeWidth={3} />
                {steps && !isActive && <circle r={n.r + 6} fill="none" stroke={TRAIL} strokeWidth={2.5} strokeDasharray="4 5" />}
                {n.id === selected && <circle r={n.r + 7} fill="none" style={{ stroke: "var(--color-fg)" }} strokeWidth={2} />}
                {/* Initials inside the circle, like a graph database's node caption. */}
                {n.r >= 13 && (
                <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(11, n.r * 0.5)} fontWeight={600} fill={isActive ? "#07080c" : "#ffffff"} className="pointer-events-none font-display" style={{ paintOrder: "stroke" }} stroke={isActive ? "none" : "rgba(7,8,12,0.45)"} strokeWidth={3}>
                  {initials(n.label)}
                </text>
                )}
                {/* Caption pill under the circle. */}
                {(n.r >= CAPTION_MIN_R || isActive || steps || n.id === hover || n.id === selected) && (
                <g transform={`translate(0,${n.r + 16})`} className="pointer-events-none">
                  <rect x={-(label.length * 3.6) - 9} y={-11} width={label.length * 7.2 + 18} height={22} rx={11} style={{ fill: isActive ? TRAIL : "var(--color-panel)", stroke: isActive ? TRAIL : "var(--color-line)" }} strokeWidth={1} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} style={{ fill: isActive ? "#07080c" : "var(--color-fg)" }}>
                    {label}
                  </text>
                </g>
                )}
                {changed?.has(n.id) && (
                  <g transform={`translate(${-n.r * 0.72},${-n.r * 0.72})`} className="pointer-events-none">
                    <circle r={9} fill="#2ea043" style={{ stroke: OUTLINE }} strokeWidth={2} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#ffffff" className="font-mono">
                      ±
                    </text>
                  </g>
                )}
                {steps && (
                  <g transform={`translate(${n.r * 0.72},${-n.r * 0.72})`} className="pointer-events-none">
                    <rect x={-4} y={-11} width={Math.max(22, steps.slice(0, 3).join(",").length * 7.4 + 12)} height={22} rx={11} fill={TRAIL} style={{ stroke: OUTLINE }} strokeWidth={2} />
                    <text x={Math.max(22, steps.slice(0, 3).join(",").length * 7.4 + 12) / 2 - 4} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="#07080c" className="font-mono">
                      {steps.slice(0, 3).join(",")}
                      {steps.length > 3 ? "…" : ""}
                    </text>
                  </g>
                )}
                {isActive && (
                  // The bounce is a CSS transform, so it lives on an inner group; the outer one places the pin.
                  <g className="pointer-events-none" transform={`translate(0,${-n.r - 34})`}>
                    <g className="bob">
                      <path d="M0 26C0 26 -13 11 -13 2a13 13 0 0 1 26 0c0 9-13 24-13 24z" fill={TRAIL} style={{ stroke: "var(--color-ink)" }} strokeWidth={3} />
                      <circle cy={2} r={5} fill="#07080c" />
                    </g>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover card. */}
      {hoverNode && hoverNode.x !== undefined && (
        <div
          className="toon-lg pointer-events-none absolute z-10 max-w-64 rounded-xl bg-panel px-3 py-2"
          style={{ left: Math.min(size.w - 270, transform.applyX(hoverNode.x) + hoverNode.r * transform.k + 12), top: Math.max(8, transform.applyY(hoverNode.y ?? 0) - 30) }}
        >
          <p className="text-sm font-bold text-fg">{hoverNode.label}</p>
          {hoverNode.kind && <p className="text-[11px] text-fg-3">{hoverNode.kind}</p>}
          {hoverNode.detail && <p className="mt-1 text-xs leading-snug text-fg-2">{hoverNode.detail}</p>}
          <p className="mt-1 text-[11px] text-fg-3">{neighbours.size - 1} connected · drag to move · double-click to release</p>
        </div>
      )}

      {/* Controls. */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        {[
          { label: "Zoom in", icon: Plus, run: () => zoomBy(1.3) },
          { label: "Zoom out", icon: Minus, run: () => zoomBy(1 / 1.3) },
          { label: "Fit to screen", icon: Maximize2, run: fit },
        ].map(({ label, icon: Icon, run }) => (
          <button key={label} onClick={run} aria-label={label} title={label} className="toon-sm toon-press grid size-9 place-items-center rounded-[10px] bg-panel text-fg-2 hover:text-fg">
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

function initials(label: string) {
  const words = label
    .replace(/[^A-Za-z0-9\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "·";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
