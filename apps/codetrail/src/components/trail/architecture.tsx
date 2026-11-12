"use client";

// The architecture diagram: modules as labelled boxes in their layers, laid out top to bottom along the way calls
// flow, with real routed arrows. Solid arrows are confirmed by imports; dashed ones were inferred by the model.
// Double-click a module to open it into its files; click a link to see the import lines behind it.
import { useMemo } from "react";
import { groupsOf } from "@/lib/architecture";
import { architectureSpec, type Layout, type LinkInfo } from "@/lib/diagram";
import type { Atlas, RepoSummary } from "@/lib/schemas";
import { DiagramView } from "./diagram-view";

type Props = {
  atlas: Pick<Atlas, "nodes" | "edges">;
  summary: Pick<RepoSummary, "fileSizes" | "imports" | "importLines">;
  expanded: Set<string>;
  active: string | null;
  previous: string | null;
  visited: Map<string, number[]>;
  changed?: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onEdge: (link: LinkInfo) => void;
  onLayout?: (layout: Layout) => void;
  /** Search matches on the map, and the one to show. */
  highlight?: Set<string> | null;
  focusId?: string | null;
};

export function ArchitectureView({ atlas, summary, expanded, active, previous, visited, changed, selected, onSelect, onToggle, onEdge, onLayout, highlight, focusId }: Props) {
  const spec = useMemo(() => architectureSpec(atlas, { expanded, files: summary }), [atlas, expanded, summary]);
  const { by, groups } = useMemo(() => groupsOf(atlas.nodes), [atlas.nodes]);
  const modules = useMemo(() => new Set(atlas.nodes.map((n) => n.id)), [atlas.nodes]);
  const describe = (id: string) => {
    const box = spec.boxes.find((b) => b.id === id);
    if (!box) return id;
    if (!modules.has(id)) return `${box.label}, file ${box.caption ?? ""}${box.label}, in ${spec.boxes.find((b) => b.id === box.parent)?.label ?? "a module"}`;
    const steps = visited.get(id);
    const layer = groups.find((g) => g.nodes.includes(id))?.title;
    return `${box.label}${layer ? `, ${by === "layer" ? "layer " : ""}${layer}` : ""}, ${box.caption}${expanded.has(id) ? ", opened" : ""}${changed?.has(id) ? ", changed in this pull request" : ""}${steps ? `, tour steps ${steps.join(", ")}` : ""}${id === active ? ", current step" : ""}`;
  };
  return (
    <DiagramView
      spec={spec}
      ariaLabel="Architecture diagram of the repository. Tab through the modules: Enter selects one, O opens it into its files, and the bracket keys step through its links."
      active={active}
      previous={previous}
      visited={visited}
      changed={changed}
      selected={selected}
      // A file box selects its file; a module box its module.
      onSelect={(id) => onSelect(id)}
      onOpen={(id) => modules.has(id) && onToggle(id)}
      onEdge={onEdge}
      onLayout={onLayout}
      describe={describe}
      highlight={highlight}
      focusId={focusId}
    />
  );
}
