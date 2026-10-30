import { Cloud, PlugZap, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CodeBlock, ErrorBanner, HealthDot, Stat } from "@/components/common";
import { TopologyGraph } from "@/components/TopologyGraph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, post } from "@/lib/api";
import { ago, cn } from "@/lib/utils";
import type { ClusterStatus, Overview, Topology, TopoNode } from "@/lib/types";

interface ResourceDetail {
  kind: string; name: string; namespace: string; object: any; logs?: string;
  events: { type: string; reason: string; message: string; count: number; last_seen: string }[];
  conditions: { type: string; status: string; reason?: string; message?: string }[];
  relationships: { kind: string; name: string; relation: string; observed: boolean }[];
}

export function ClusterPage() {
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [namespace, setNamespace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TopoNode | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api<ClusterStatus>("/cluster");
      setStatus(s);
      if (!s.connected) { setError(s.error ?? "Not connected"); return; }
      const q = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
      const [o, t] = await Promise.all([api<Overview>(`/cluster/overview${q}`), api<Topology>(`/cluster/topology${q}`)]);
      setOverview(o); setTopology(t); setError(t.error ?? null);
      if (!namespace) setNamespace(o.namespace);
    } catch (e) {
      setError((e as Error).message); // keep the last data on screen, marked stale below
    }
  }, [namespace]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const stale = overview && Date.now() / 1000 - overview.fetched_at > 15;
  const unhealthy = (overview?.pods.filter((p) => p.health !== "ok").length ?? 0) + (overview?.services.filter((s) => s.health !== "ok").length ?? 0);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Cluster overview</h1>
          <p className="text-xs text-muted">Live from the Kubernetes API. Refreshes every 5 s.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor="ns">Namespace</label>
          <select id="ns" value={namespace} onChange={(e) => setNamespace(e.target.value)}
            className="h-8 rounded-md border border-line bg-raised px-2 text-xs text-ink">
            {(overview?.namespaces ?? [namespace]).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={refresh}><RefreshCw /> Refresh</Button>
          <Button size="sm" variant="secondary" onClick={() => setConnectOpen(true)}><PlugZap /> Connection</Button>
        </div>
      </div>

      {error && <ErrorBanner>{error}{overview && " Showing the last data received."}</ErrorBanner>}

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><Server className="size-4 text-muted" /> Connection</CardTitle>
            {status?.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="bad">Disconnected</Badge>}</CardHeader>
          <CardBody className="space-y-1.5 text-xs">
            <Row label="Source">{status?.source === "civo" ? <span className="inline-flex items-center gap-1"><Cloud className="size-3" /> Civo API</span> : "kubeconfig"}</Row>
            <Row label="Context"><span className="font-mono">{status?.context ?? "—"}</span></Row>
            {status?.civo_cluster && <Row label="Civo cluster">{status.civo_cluster.name} ({status.civo_cluster.region})</Row>}
            <Row label="Kubernetes">{status?.kubernetes_version ?? "—"}</Row>
            <Row label="Data">{overview ? <span className={cn(stale && "text-warn")}>{stale ? "stale · " : ""}{ago(overview.fetched_at)}</span> : "—"}</Row>
          </CardBody>
        </Card>
        <div className="grid grid-cols-2 gap-3 md:col-span-3 md:grid-cols-4">
          <Stat label="Nodes" value={overview?.nodes.length ?? "—"} sub={overview ? `${overview.nodes.filter((n) => n.ready).length} ready` : undefined} />
          <Stat label="Deployments" value={overview?.deployments.length ?? "—"} sub={overview ? `${overview.deployments.filter((d) => d.health === "ok").length} healthy` : undefined} />
          <Stat label="Pods" value={overview?.pods.length ?? "—"} sub={overview ? `${overview.pods.filter((p) => p.ready).length} ready` : undefined} />
          <Stat label="Needs attention" value={<span className={unhealthy ? "text-bad" : "text-ok"}>{overview ? unhealthy : "—"}</span>} sub="pods and services" />
        </div>
      </div>

      {overview?.warning && <p className="text-xs text-warn">{overview.warning}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Topology · {topology?.namespace ?? namespace}</CardTitle>
            <span className="text-[11px] text-faint">Click a resource for events, logs and relationships</span></CardHeader>
          <div className="h-[460px] border-t border-line"><TopologyGraph topology={topology} onSelect={setSelected} /></div>
        </Card>
        <div className="space-y-4">
          <ResourceList title="Services" rows={(overview?.services ?? []).map((s) => ({ key: s.name, kind: "Service", health: s.health,
            name: s.name, detail: `${s.ready_endpoints} endpoints · ${Object.entries(s.selector).map(([k, v]) => `${k}=${v}`).join(", ")}` }))} onPick={setSelected} />
          <ResourceList title="Deployments" rows={(overview?.deployments ?? []).map((d) => ({ key: d.name, kind: "Deployment", health: d.health,
            name: d.name, detail: `${d.ready}/${d.replicas} ready · ${d.updated} updated` }))} onPick={setSelected} />
          <ResourceList title="Pods" rows={(overview?.pods ?? []).map((p) => ({ key: p.name, kind: "Pod", health: p.health,
            name: p.name, detail: `${p.status}${p.restarts ? ` · ${p.restarts} restarts` : ""}${p.last_termination ? ` · last: ${p.last_termination}` : ""}` }))} onPick={setSelected} />
          <ResourceList title="Nodes" rows={(overview?.nodes ?? []).map((n) => ({ key: n.name, kind: "Node", health: n.ready ? "ok" : "error",
            name: n.name, detail: `${n.version} · ${n.cpu} CPU · ${n.memory}` }))} />
        </div>
      </div>

      <ResourceDrawer node={selected} namespace={topology?.namespace ?? namespace} onClose={() => setSelected(null)} />
      <ConnectSheet open={connectOpen} onOpenChange={setConnectOpen} onConnected={() => { setConnectOpen(false); refresh(); }} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-faint">{label}</span><span className="truncate text-right text-ink">{children}</span></div>;
}

function ResourceList({ title, rows, onPick }: { title: string; rows: { key: string; kind: string; name: string; detail: string; health: any }[]; onPick?: (n: TopoNode) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{title}</CardTitle><span className="text-[11px] text-faint">{rows.length}</span></CardHeader>
      <ul className="max-h-48 overflow-y-auto border-t border-line">
        {rows.map((r) => (
          <li key={r.key}>
            <button disabled={!onPick} onClick={() => onPick?.({ id: `${r.kind}/${r.name}`, kind: r.kind, name: r.name, health: r.health, detail: r.detail })}
              className="flex w-full items-center gap-2.5 px-5 py-2 text-left text-xs hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent">
              <HealthDot health={r.health} />
              <span className="min-w-0 flex-1"><span className="block truncate font-mono text-ink">{r.name}</span>
                <span className="block truncate text-muted">{r.detail}</span></span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="px-5 py-3 text-xs text-faint">None</li>}
      </ul>
    </Card>
  );
}

function ResourceDrawer({ node, namespace, onClose }: { node: TopoNode | null; namespace: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDetail(null); setError(null);
    if (!node || node.kind === "Node") return;
    api<ResourceDetail>(`/cluster/resource/${node.kind}/${namespace}/${node.name}`).then(setDetail).catch((e) => setError(e.message));
  }, [node, namespace]);
  return (
    <Sheet open={!!node} onOpenChange={(o) => !o && onClose()} title={<span className="font-mono">{node?.kind}/{node?.name}</span>} subtitle={namespace}>
      {error && <div className="p-5"><ErrorBanner>{error}</ErrorBanner></div>}
      {detail && (
        <Tabs defaultValue="events">
          <TabsList><TabsTrigger value="events">Events ({detail.events.length})</TabsTrigger>
            {detail.logs !== undefined && <TabsTrigger value="logs">Logs</TabsTrigger>}
            <TabsTrigger value="conditions">Conditions</TabsTrigger><TabsTrigger value="relations">Relationships</TabsTrigger>
            <TabsTrigger value="spec">Spec</TabsTrigger></TabsList>
          <TabsContent value="events" className="space-y-2 p-5">
            {detail.events.map((e, i) => (
              <div key={i} className="rounded-md border border-line bg-raised/40 px-3 py-2 text-xs">
                <div className="flex items-center gap-2"><Badge tone={e.type === "Warning" ? "warn" : "neutral"}>{e.reason}</Badge>
                  <span className="text-faint">×{e.count ?? 1}</span><span className="ml-auto text-faint">{String(e.last_seen ?? "").slice(11, 19)}</span></div>
                <p className="mt-1 text-muted">{e.message}</p>
              </div>))}
            {!detail.events.length && <p className="text-xs text-faint">No recent events.</p>}
          </TabsContent>
          <TabsContent value="logs" className="p-5"><CodeBlock className="max-h-[70vh]">{detail.logs || "(empty)"}</CodeBlock></TabsContent>
          <TabsContent value="conditions" className="space-y-1.5 p-5 text-xs">
            {detail.conditions.map((c, i) => <div key={i} className="flex gap-2"><HealthDot health={c.status === "True" ? "ok" : "warn"} className="mt-1" />
              <div><span className="font-medium">{c.type}</span> <span className="text-muted">{c.status}{c.reason ? ` · ${c.reason}` : ""}</span>
                {c.message && <p className="text-faint">{c.message}</p>}</div></div>)}
            {!detail.conditions.length && <p className="text-faint">No conditions reported.</p>}
          </TabsContent>
          <TabsContent value="relations" className="space-y-1.5 p-5 text-xs">
            {detail.relationships.map((r, i) => <div key={i}>{r.relation} <span className="font-mono">{r.kind}/{r.name}</span> <Badge>{r.observed ? "API-observed" : "inferred"}</Badge></div>)}
            {detail.object?.spec?.selector && <div>selects Pods with <span className="font-mono">{JSON.stringify(detail.object.spec.selector.matchLabels ?? detail.object.spec.selector)}</span> <Badge>from spec</Badge></div>}
            {!detail.relationships.length && !detail.object?.spec?.selector && <p className="text-faint">No owner references.</p>}
          </TabsContent>
          <TabsContent value="spec" className="p-5"><CodeBlock className="max-h-[70vh]">{JSON.stringify(detail.object, null, 2)}</CodeBlock></TabsContent>
        </Tabs>
      )}
    </Sheet>
  );
}

function ConnectSheet({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; onConnected: () => void }) {
  const [clusters, setClusters] = useState<{ id: string; name: string; status: string; kubernetes_version: string; nodes: number; region: string }[]>([]);
  const [region, setRegion] = useState("LON1");
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadCivo = () => { setError(null); api<{ clusters: typeof clusters }>(`/civo/clusters?region=${region}`).then((r) => setClusters(r.clusters)).catch((e) => setError(e.message)); };
  const connect = async (body: object) => {
    setBusy(true); setError(null);
    try { await post("/cluster/connect", body); onConnected(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Connect a cluster" subtitle="Credentials stay on the server; nothing here is sent to the model.">
      <div className="space-y-6 p-5 text-xs">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <section className="space-y-2">
          <h4 className="font-semibold">Civo</h4>
          <p className="text-muted">Lists clusters with the server's CIVO_API_KEY and fetches the kubeconfig server-side. Never creates infrastructure.</p>
          <div className="flex gap-2">
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="h-8 rounded-md border border-line bg-raised px-2">
              {["LON1", "FRA1", "NYC1", "MUM1"].map((r) => <option key={r}>{r}</option>)}</select>
            <Button size="sm" variant="secondary" onClick={loadCivo}><Cloud /> List clusters</Button>
          </div>
          {clusters.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
              <div className="flex-1"><div className="font-medium">{c.name}</div><div className="text-muted">{c.status} · {c.kubernetes_version} · {c.nodes} nodes</div></div>
              <Button size="sm" disabled={busy || c.status !== "ACTIVE"} onClick={() => connect({ source: "civo", cluster_id: c.id, region })}>Connect</Button>
            </div>))}
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">Kubeconfig</h4>
          <p className="text-muted">Uses the server's KUBECONFIG. Leave the context empty for the current context.</p>
          <div className="flex gap-2"><input value={context} onChange={(e) => setContext(e.target.value)} placeholder="context (optional)"
            className="h-8 flex-1 rounded-md border border-line bg-bg px-2 font-mono" />
            <Button size="sm" disabled={busy} onClick={() => connect({ source: "kubeconfig", context })}>Connect</Button></div>
        </section>
      </div>
    </Sheet>
  );
}
