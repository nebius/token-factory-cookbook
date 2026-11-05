"use client";

// What the model read, as a squarified treemap: area = tokens, colour = top-level folder (the six biggest get
// the validated palette in order, the rest share grey). Hover a tile for its path and size.
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { useMemo, useState } from "react";
import { formatTokens } from "@/lib/format";
import { PALETTE, SUPPORT } from "@/lib/palette";
import type { RepoSummary } from "@/lib/schemas";

type Leaf = { name: string; path: string; tokens: number; top: string };
type Node = { name: string; children?: Node[]; leaf?: Leaf };

export function Treemap({ summary, height = 280 }: { summary: RepoSummary; height?: number }) {
  const [hover, setHover] = useState<Leaf | null>(null);
  const W = 1000;
  const { tiles, legend } = useMemo(() => {
    const groups = new Map<string, Leaf[]>();
    for (const [path, , tokens] of summary.fileSizes) {
      const parts = path.split("/");
      const top = parts.length > 1 ? `${parts[0]}/` : "(root files)";
      groups.set(top, [...(groups.get(top) ?? []), { name: parts.at(-1)!, path, tokens, top }]);
    }
    const ranked = [...groups.entries()].map(([top, files]) => ({ top, total: files.reduce((a, f) => a + f.tokens, 0), files })).sort((a, b) => b.total - a.total);
    const color = new Map(ranked.map((g, i) => [g.top, i < PALETTE.length ? PALETTE[i] : SUPPORT]));
    const root: Node = { name: "repo", children: ranked.map((g) => ({ name: g.top, children: g.files.map((f) => ({ name: f.name, leaf: f })) })) };
    const h = hierarchy(root)
      .sum((d) => d.leaf?.tokens ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const laid = treemap<Node>().tile(treemapSquarify).size([W, height]).paddingInner(1.5).paddingTop((d) => (d.depth === 1 && (d.y1 - d.y0) > 40 ? 16 : 0)).round(true)(h);
    const tiles = laid.leaves().map((l) => ({ x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0, leaf: l.data.leaf!, color: color.get(l.data.leaf!.top) ?? SUPPORT }));
    const legend = ranked.slice(0, 7).map((g) => ({ name: g.top, tokens: g.total, color: color.get(g.top)! }));
    return { tiles, legend };
  }, [summary, height]);

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full" role="img" aria-label="Treemap of the files read, sized by tokens">
          {tiles.map((t) => (
            <g key={t.leaf.path} onMouseEnter={() => setHover(t.leaf)} onMouseLeave={() => setHover(null)}>
              <rect x={t.x} y={t.y} width={Math.max(0, t.w)} height={Math.max(0, t.h)} rx={3} fill={t.color} fillOpacity={hover && hover.path !== t.leaf.path ? 0.45 : 0.9} />
              {t.w > 70 && t.h > 22 && (
                <text x={t.x + 6} y={t.y + 15} fontSize={11} fill="#ffffff" className="pointer-events-none font-mono">
                  {t.leaf.name.length > t.w / 7 ? `${t.leaf.name.slice(0, Math.floor(t.w / 7) - 1)}…` : t.leaf.name}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <p className="mt-2 h-5 truncate font-mono text-[11.5px] text-fg-2">{hover ? `${hover.path} · ≈${formatTokens(hover.tokens)} tokens` : "Hover a tile for its path · area = tokens"}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] text-fg-2">
        {legend.map((g) => (
          <span key={g.name} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: g.color }} />
            {g.name} <span className="text-fg-3">{formatTokens(g.tokens)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
