import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Layers, Network, Rocket } from "lucide-react";
import { useMemo } from "react";
import { HealthDot } from "@/components/common";
import { cn } from "@/lib/utils";
import type { Topology, TopoNode } from "@/lib/types";

const COLUMN_X: Record<string, number> = { Deployment: 0, ReplicaSet: 260, Pod: 520, Service: 800 };
const ICON: Record<string, typeof Box> = { Service: Network, Deployment: Rocket, ReplicaSet: Layers, Pod: Box };

function ResourceNode({ data }: NodeProps<Node<{ node: TopoNode; highlighted: boolean }>>) {
  const { node, highlighted } = data;
  const Icon = ICON[node.kind] ?? Box;
  return (
    <div className={cn("w-[210px] rounded-lg border bg-panel px-3 py-2 shadow-sm transition-colors",
      highlighted ? "border-accent" : node.health === "error" ? "border-bad/50" : node.health === "warn" ? "border-warn/40" : "border-line")}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line" />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted" />
        <span className="text-[10px] uppercase tracking-wide text-faint">{node.kind}</span>
        <HealthDot health={node.health} className="ml-auto" />
      </div>
      <div className="mt-1 truncate font-mono text-[11.5px] text-ink" title={node.name}>{node.name}</div>
      <div className="truncate text-[10.5px] text-muted" title={node.detail}>{node.detail}</div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line" />
    </div>
  );
}

const nodeTypes = { resource: ResourceNode };

export function TopologyGraph({ topology, onSelect, highlight = [], className }: {
  topology: Topology | null; onSelect?: (n: TopoNode) => void; highlight?: string[]; className?: string;
}) {
  const { nodes, edges } = useMemo(() => {
    if (!topology) return { nodes: [] as Node[], edges: [] as Edge[] };
    // Four columns, left to right: Deployment → ReplicaSet → Pod ← Service.
    const counts: Record<string, number> = {};
    const nodes: Node[] = topology.nodes.map((n) => {
      const col = COLUMN_X[n.kind] ?? 0;
      const row = (counts[n.kind] = (counts[n.kind] ?? 0) + 1) - 1;
      return { id: n.id, type: "resource", position: { x: col, y: row * 92 },
               data: { node: n, highlighted: highlight.includes(n.id) } };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = topology.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e, i) => ({
      id: `${e.source}-${e.target}-${i}`, source: e.kind === "endpoint" || e.kind === "selects" ? e.target : e.source,
      target: e.kind === "endpoint" || e.kind === "selects" ? e.source : e.target,
      animated: false,
      style: { stroke: e.kind === "endpoint" ? "hsl(152 58% 50%)" : e.observed ? "hsl(220 10% 50%)" : "hsl(38 92% 58%)",
               strokeDasharray: e.observed ? undefined : "5 4", strokeWidth: 1.4 },
      label: e.kind === "owns" ? undefined : e.kind === "endpoint" ? "endpoint" : "selector match (inferred)",
      labelStyle: { fill: "hsl(220 10% 64%)", fontSize: 10 }, labelBgStyle: { fill: "hsl(222 20% 10%)" },
    }));
    return { nodes, edges };
  }, [topology, highlight]);

  return (
    <div className={cn("relative h-full min-h-[320px] w-full", className)} data-testid="topology">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.3}
        nodesDraggable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect?.((n.data as any).node)}>
        <Background color="hsl(222 14% 18%)" gap={22} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <div className="pointer-events-none absolute right-3 top-3 space-y-1 rounded-md border border-line bg-panel/90 px-2.5 py-2 text-[10.5px] text-muted">
        <div className="flex items-center gap-2"><span className="h-0.5 w-5 bg-ok" /> endpoint (API: EndpointSlice)</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-5 bg-faint" /> owner (API: ownerReference)</div>
        <div className="flex items-center gap-2"><span className="h-0.5 w-5 border-t border-dashed border-warn" /> selector match only (inferred)</div>
      </div>
      {topology && topology.nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-xs text-faint">No workloads in {topology.namespace}.</div>
      )}
    </div>
  );
}
