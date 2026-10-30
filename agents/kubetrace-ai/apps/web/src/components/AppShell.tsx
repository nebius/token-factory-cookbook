import { Activity, Boxes, FlaskConical, ListChecks, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { api, ApiError, setApiToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ClusterStatus } from "@/lib/types";

interface PublicConfig { model: string | null; model_configured: boolean; cluster_kind: string; policy_mode: string; demo_namespace: string }

const NAV = [
  { to: "/", label: "Cluster", icon: Boxes, end: true },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/runs", label: "Runs", icon: ListChecks },
  { to: "/results", label: "Results", icon: Table2 },
];

export function AppShell() {
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [authVersion, setAuthVersion] = useState(0); // remounts pages after a token is entered

  useEffect(() => {
    const load = () => {
      api<ClusterStatus>("/cluster").then(setCluster).catch((e) => e instanceof ApiError && e.status === 401 && setNeedsToken(true));
      api<PublicConfig>("/config").then(setConfig).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-panel/80 px-5 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-md bg-accent/15 text-accent"><Activity className="size-4" /></div>
          <span className="text-sm font-semibold tracking-tight">KubeTrace <span className="text-accent">AI</span></span>
        </div>
        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isActive ? "bg-raised text-ink" : "text-muted hover:text-ink")}>
              <Icon className="size-3.5" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2" data-testid="header-status">
          {cluster && (cluster.connected ?
            <Badge tone="ok" title={cluster.server}>{cluster.cluster_kind === "civo" ? "Civo" : "kind"} · {cluster.context || cluster.civo_cluster?.name} · {cluster.kubernetes_version}</Badge> :
            <Badge tone="bad">Cluster disconnected</Badge>)}
          {config && <Badge tone={config.model_configured ? "accent" : "warn"} title="Inference via Nebius Token Factory">
            {config.model_configured ? `Token Factory · ${config.model}` : "Model not configured (fixture runs only)"}</Badge>}
          {config && <Badge>{config.policy_mode === "review" ? "Review mode" : "Demo auto-fix"}</Badge>}
        </div>
      </header>
      {needsToken && (
        <form className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-5 py-2 text-xs text-warn"
          onSubmit={(e) => { e.preventDefault(); setApiToken(new FormData(e.currentTarget).get("t") as string); setNeedsToken(false); setAuthVersion((v) => v + 1); }}>
          This server requires an access token (kept in memory for this tab only):
          <input name="t" type="password" className="rounded border border-line bg-bg px-2 py-1 text-ink" autoFocus />
        </form>
      )}
      <main key={authVersion} className="min-h-0 flex-1 overflow-auto"><Outlet /></main>
    </div>
  );
}
