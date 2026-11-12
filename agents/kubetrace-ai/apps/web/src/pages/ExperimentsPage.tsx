import { Bug, Code2, FileCog, FlaskConical, Play, RotateCcw, Search, ShieldAlert, Syringe, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErrorBanner, StateBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, post } from "@/lib/api";
import type { Experiment } from "@/lib/types";

const REPAIR_ICON: Record<string, typeof Code2> = { code: Code2, manifest: FileCog, config: Wrench };

export function ExperimentsPage() {
  const [items, setItems] = useState<Experiment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [review, setReview] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const navigate = useNavigate();

  const load = () => api<Experiment[]>("/experiments").then(setItems).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api<{ model_configured: boolean; policy_mode: string }>("/config").then((c) => { setModelReady(c.model_configured); setLive(c.model_configured); setReview(c.policy_mode === "review"); });
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, action: string) => {
    setError(null);
    try {
      const body = action === "investigate" ? { policy_mode: review ? "review" : "auto", model_mode: live ? "live" : "fixture" } : undefined;
      const res = await post<{ run_id?: string }>(`/experiments/${id}/${action}`, body);
      load();
      if (action === "investigate" && res.run_id) navigate(`/runs/${res.run_id}`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Experiment catalog</h1>
          <p className="max-w-2xl text-xs text-muted">Each experiment deploys a healthy baseline, injects one real fault, proves it is visible, and then lets the
            agent investigate from normal operational evidence. Success is decided by hidden checks the agent never sees.</p>
        </div>
        <div className="flex items-center gap-5 rounded-lg border border-line bg-panel px-4 py-2.5">
          <Switch id="live" checked={live} onCheckedChange={setLive} label={live ? "Live model" : "Fixture (scripted, no model)"} />
          <Switch id="review" checked={review} onCheckedChange={setReview} label={review ? "Review each change" : "Demo auto-fix"} />
        </div>
      </div>
      {!modelReady && live && <ErrorBanner>No model is configured on the server (NEBIUS_API_KEY / NEBIUS_MODEL). Live investigations will be refused; switch to fixture mode to exercise the pipeline.</ErrorBanner>}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((x) => {
          const state = x.status?.state ?? "idle";
          const busy = !!x.status?.busy;
          const RepairIcon = REPAIR_ICON[x.repair] ?? (x.expected_outcome === "escalate" ? ShieldAlert : Wrench);
          return (
            <Card key={x.id} className="flex flex-col p-5" data-testid={`experiment-${x.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2"><FlaskConical className="size-4 text-accent" /><h3 className="text-sm font-semibold">{x.title}</h3></div>
                <StateBadge state={state} />
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div><dt className="flex items-center gap-1 text-faint"><Bug className="size-3" /> Fault injected</dt><dd className="text-muted">{x.failure}</dd></div>
                <div><dt className="flex items-center gap-1 text-faint"><Search className="size-3" /> Visible symptom</dt><dd className="text-muted">{x.symptom}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={x.expected_outcome === "escalate" ? "info" : "accent"}><RepairIcon className="size-3" /> Repair: {x.repair}</Badge>
                {x.capabilities.map((c) => <Badge key={c}>{c}</Badge>)}
              </div>
              <div className="mt-auto pt-4">
                <div className="mb-3 text-[11px] text-faint">Budget: {x.budget.max_steps} steps · {Math.round(x.budget.max_seconds / 60)} min</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(x.id, "setup")} data-testid={`setup-${x.id}`}><Play /> Setup</Button>
                  <Button size="sm" variant="secondary" disabled={busy || state !== "baseline_ready"} onClick={() => act(x.id, "inject")} data-testid={`inject-${x.id}`}><Syringe /> Inject</Button>
                  <Button size="sm" disabled={busy || state !== "detected"} onClick={() => act(x.id, "investigate")} data-testid={`investigate-${x.id}`}><Search /> Investigate</Button>
                  <Button size="sm" variant="ghost" disabled={busy && !["investigating", "patch_proposed", "testing", "applying", "verifying"].includes(state)}
                    onClick={() => act(x.id, "reset")} data-testid={`reset-${x.id}`}><RotateCcw /> Reset</Button>
                  {x.status?.run_id && <Button size="sm" variant="ghost" asChild><Link to={`/runs/${x.status.run_id}`}>Open run →</Link></Button>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
