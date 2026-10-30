import { Download, EyeOff, Presentation } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckList, CodeBlock, DiffView, ErrorBanner, ProvenanceBadge, StateBadge, Stat } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { fmtDuration } from "@/lib/utils";

export function ReportPage() {
  const { runId } = useParams();
  const [presentation, setPresentation] = useState(false);
  const [r, setR] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<any>(`/runs/${runId}/report.json${presentation ? "?presentation=true" : ""}`).then(setR).catch((e) => setError(e.message));
  }, [runId, presentation]);

  const download = async (kind: "md" | "json") => {
    const body = kind === "md" ? await api<string>(`/runs/${runId}/report.md${presentation ? "?presentation=true" : ""}`)
      : JSON.stringify(await api(`/runs/${runId}/export`), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: kind === "md" ? "text/markdown" : "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: kind === "md" ? `kubetrace-${runId}.md` : `kubetrace-${runId}.json` });
    a.click(); URL.revokeObjectURL(url);
  };

  if (error) return <div className="p-6"><ErrorBanner>{error}</ErrorBanner></div>;
  if (!r) return <div className="p-6 text-xs text-faint">Loading report…</div>;
  const m = r.metrics ?? {};
  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-6" data-testid="report">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">Run report · {r.scenario_id}</h1>
            <StateBadge state={r.final_state} /><ProvenanceBadge provenance={r.provenance} replayOf={r.replay_of} /></div>
          <p className="mt-1 text-xs text-muted">{r.provenance_label}. {r.reason}</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="pres" checked={presentation} onCheckedChange={setPresentation} label={presentation ? "Presentation mode (values hidden)" : "Presentation mode"} />
          <Button size="sm" variant="secondary" onClick={() => download("md")}><Download /> Markdown</Button>
          <Button size="sm" variant="secondary" onClick={() => download("json")}><Download /> JSON export</Button>
          <Button size="sm" variant="ghost" asChild><Link to={`/runs/${runId}`}>Timeline</Link></Button>
          <Button size="sm" variant="ghost" asChild><Link to={`/runs/${runId}?replay=1`}><Presentation /> Replay</Link></Button>
        </div>
      </div>
      {r.is_fixture && <ErrorBanner>This is a FIXTURE run. No model was called; a scripted test double produced the actions. Do not present it as model evidence.</ErrorBanner>}
      {presentation && <p className="flex items-center gap-1 text-[11px] text-faint"><EyeOff className="size-3" /> Addresses, contexts, cluster ids and registry hosts are hidden.</p>}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="First attempt" value={r.first_attempt_success == null ? "—" : r.first_attempt_success ? "success" : "fail"} />
        <Stat label="Eventual" value={r.eventual_success == null ? "—" : r.eventual_success ? "success" : "fail"} />
        <Stat label="Agent time" value={fmtDuration(r.timing?.agent_elapsed_s)} />
        <Stat label="Model time" value={fmtDuration(m.model_latency_s)} sub={`${m.model_calls ?? "—"} calls`} />
        <Stat label="Tokens" value={m.token_usage === "reported by provider" ? Number(m.total_tokens).toLocaleString() : "unavailable"} sub={m.token_usage} />
        <Stat label="Cost" value={r.cost ? `$${r.cost.usd}` : "—"} sub={r.cost ? `estimate · rates ${r.cost.rate_date}` : "no verified pricing"} />
      </div>

      <Card><CardHeader><CardTitle>Provenance and settings</CardTitle></CardHeader><CardBody className="grid gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
        <KV k="Provider">{r.provider}</KV><KV k="Model id"><span className="font-mono">{r.model}</span></KV>
        <KV k="Generation settings"><span className="font-mono">{JSON.stringify(r.settings?.generation_settings)}</span></KV>
        <KV k="Prompt / tool schema">{r.settings?.prompt_version} / {r.settings?.tool_schema_version}</KV>
        <KV k="Policy mode">{r.policy_mode}</KV><KV k="Repository commit"><span className="font-mono">{r.repo_commit}</span></KV>
        <KV k="Cluster">{r.cluster?.kind} · Kubernetes {r.cluster?.kubernetes_version} · {r.cluster?.context}</KV>
        <KV k="Tool calls">{m.tool_calls} ({m.tool_errors} errors) · tool time {fmtDuration(m.tool_time_s)} · rejected actions {m.rejected_actions}</KV>
      </CardBody></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Issue and baseline</CardTitle></CardHeader><CardBody className="space-y-3 text-xs">
          <p className="text-ink">{r.issue?.incident}</p><p className="text-muted">{r.issue?.symptom}</p>
          <div><div className="mb-1 text-[11px] uppercase text-faint">Healthy baseline</div><CheckList checks={r.baseline ?? []} /></div>
          <div><div className="mb-1 text-[11px] uppercase text-faint">Fault confirmed before investigation</div><CheckList checks={r.issue?.fault_proof ?? []} /></div>
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Root cause evidence</CardTitle></CardHeader><CardBody className="space-y-2 text-xs">
          {[...(r.observations ?? []).map((o: any) => ["Observation", o]), ...(r.hypotheses ?? []).map((o: any) => ["Hypothesis", o])].map(([k, o]: any, i: number) =>
            <p key={i}><Badge tone={k === "Hypothesis" ? "accent" : "info"}>{k}</Badge> <span className="text-ink">{o.text}</span>
              {o.evidence?.length ? <span className="text-faint"> ({o.evidence.join(", ")})</span> : null}</p>)}
          {r.agent_conclusion && <div className="rounded-md border border-line p-2"><div className="text-[11px] uppercase text-faint">Agent conclusion ({r.agent_conclusion.outcome})</div>
            <p className="text-ink">{r.agent_conclusion.root_cause}</p><p className="text-muted">{r.agent_conclusion.summary}</p></div>}
        </CardBody></Card>
      </div>

      <Card><CardHeader><CardTitle>All attempted changes ({r.attempted_changes?.length ?? 0})</CardTitle></CardHeader><CardBody className="space-y-4 text-xs">
        {(r.attempted_changes ?? []).map((c: any) => <div key={c.id} className="space-y-1.5">
          <div className="flex items-center gap-2"><Badge tone={c.status === "applied" ? "ok" : "bad"}>{c.status}</Badge><span className="font-mono">{c.source} {c.kind}/{c.name}</span><span className="text-muted">{c.reason}</span></div>
          {(c.decision?.reasons ?? []).map((x: string) => <p key={x} className="text-bad">Policy: {x}</p>)}{c.error && <p className="text-bad">{c.error}</p>}
          {c.diff && <DiffView diff={c.diff} />}</div>)}
        {!r.attempted_changes?.length && <p className="text-faint">No cluster changes.</p>}
        {r.source_diff && <div><div className="mb-1 text-[11px] uppercase text-faint">Source diff since the incident commit</div><DiffView diff={r.source_diff} /></div>}
      </CardBody></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Tests</CardTitle></CardHeader><CardBody className="space-y-3 text-xs">
          {(r.tests ?? []).map((t: any, i: number) => <div key={i}><div className="flex items-center gap-2"><Badge tone={t.passed ? "ok" : "bad"}>exit {t.exit_code}</Badge><span className="font-mono">{t.command}</span></div>
            <p className="my-1 text-faint">{t.isolation}</p><CodeBlock>{t.output}</CodeBlock></div>)}
          {!r.tests?.length && <p className="text-faint">No tests run.</p>}
          {(r.builds ?? []).map((b: any) => <p key={b.image} className="text-muted">Image <span className="font-mono">{b.image}</span> from {String(b.source_commit).slice(0, 10)}</p>)}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Independent verification</CardTitle></CardHeader><CardBody className="space-y-3 text-xs">
          {(r.verifications ?? []).map((v: any) => <div key={v.attempt}><p className="mb-1 font-medium">Attempt {v.attempt}: {v.ok ? "passed" : "failed"} (agent said {v.agent_outcome})</p><CheckList checks={v.checks} /></div>)}
          {(r.rollouts ?? []).map((x: any, i: number) => <p key={i} className="text-muted">Rollout {x.deployment}: {x.complete ? "complete" : "incomplete"} after {x.waited_s} s ({x.ready}/{x.replicas})</p>)}
          {!r.verifications?.length && <p className="text-faint">Not reached.</p>}
        </CardBody></Card>
      </div>

      <Card><CardHeader><CardTitle>Failures, drift and limitations</CardTitle></CardHeader><CardBody className="space-y-1.5 text-xs">
        {(r.limitations ?? []).map((l: string) => <p key={l} className="text-muted">• {l}</p>)}
        {(r.errors ?? []).map((e: any, i: number) => <p key={i} className="text-bad">• {e.where}: {e.message}</p>)}
        {!r.limitations?.length && !r.errors?.length && <p className="text-faint">None recorded.</p>}
      </CardBody></Card>
    </div>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-4 border-b border-line/50 py-1"><span className="text-faint">{k}</span><span className="truncate text-right text-ink">{children ?? "—"}</span></div>;
}
