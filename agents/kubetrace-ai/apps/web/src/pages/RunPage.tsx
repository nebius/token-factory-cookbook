import { Bot, ChevronDown, ChevronRight, CircleStop, Eye, FileText, Hammer, Lightbulb, Pause, Play, ShieldCheck, ShieldX, TestTube2, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckList, CodeBlock, DiffView, ErrorBanner, ProvenanceBadge, STATE_LABEL, StateStepper, TERMINAL } from "@/components/common";
import { TopologyGraph } from "@/components/TopologyGraph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, post } from "@/lib/api";
import { useRunEvents } from "@/lib/useRunEvents";
import { cn, fmtDuration, fmtTime } from "@/lib/utils";
import type { Run, RunEvent, Topology } from "@/lib/types";

export function RunPage() {
  const { runId } = useParams();
  const [params] = useSearchParams();
  const [run, setRun] = useState<Run | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const { events: allEvents, status } = useRunEvents(runId);
  const replay = params.get("replay") === "1" || run?.provenance === "replay";
  const [cursor, setCursor] = useState<number>(Number.MAX_SAFE_INTEGER);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const load = () => api<Run>(`/runs/${runId}`).then(setRun).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [runId]);

  const live = run && !TERMINAL.has(run.state) && run.provenance !== "replay";
  useEffect(() => {
    if (!live) return;
    const load = () => api<Topology>("/cluster/topology").then(setTopology).catch(() => undefined);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [live]);

  // Replay: step through the recorded events at a readable pace.
  useEffect(() => { if (replay) { setCursor(0); setPlaying(true); } }, [replay]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setCursor((c) => (c >= allEvents.length ? (setPlaying(false), c) : c + 1)), 450);
    return () => clearInterval(t);
  }, [playing, allEvents.length]);
  const events = replay ? allEvents.slice(0, cursor) : allEvents;

  const state = useMemo(() => {
    const last = [...events].reverse().find((e) => e.type === "state");
    return (last?.payload.state as string) ?? run?.state ?? "pending";
  }, [events, run]);
  const reached = useMemo(() => new Set(events.filter((e) => e.type === "state").map((e) => e.payload.state as string)), [events]);
  const pending = useMemo(() => {
    const decided = new Set(events.filter((e) => e.type === "approval").map((e) => e.payload.mutation_id));
    return events.filter((e) => e.type === "policy_decision" && e.payload.status === "pending_approval" && !decided.has(e.payload.id));
  }, [events]);

  const touched = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) {
      if (e.type === "tool_call") {
        const a = e.payload.arguments ?? {};
        if (a.service) ids.add(`Service/${a.service}`);
        if (a.deployment) ids.add(`Deployment/${a.deployment}`);
        if (a.pod) ids.add(`Pod/${a.pod}`);
        if (a.kind && a.name) ids.add(`${a.kind}/${a.name}`);
      }
    }
    return [...ids];
  }, [events]);

  const cancel = () => runId && post(`/runs/${runId}/cancel`).catch((e) => setError(e.message));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel/60 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-sm font-semibold">{run?.scenario_id ?? "…"}</h1>
          <span className="font-mono text-[11px] text-faint">{runId}</span>
          {run && <ProvenanceBadge provenance={run.provenance} replayOf={run.replay_of} />}
          {run?.model && <Badge tone="accent" title={run.provider ?? ""}>{run.provider === "fixture" ? "no model" : run.model}</Badge>}
          {run?.policy_mode && <Badge>{run.policy_mode === "review" ? "Review mode" : "Demo auto-fix"}</Badge>}
          <Badge tone={status === "live" ? "ok" : status === "reconnecting" ? "warn" : "neutral"} data-testid="stream-status">
            {status === "live" ? "● streaming" : status === "reconnecting" ? "reconnecting… (will replay missed events)" : status}</Badge>
          <div className="ml-auto flex items-center gap-2">
            {replay && <>
              <Button size="sm" variant="secondary" onClick={() => setPlaying((p) => !p)}>{playing ? <Pause /> : <Play />} {playing ? "Pause" : "Play"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); setCursor(allEvents.length); }}>Show all</Button>
            </>}
            {live && <Button size="sm" variant="danger" onClick={cancel}><CircleStop /> Cancel</Button>}
            <Button size="sm" variant="secondary" asChild><Link to={`/runs/${runId}/report`}><FileText /> Report</Link></Button>
          </div>
        </div>
        <div className="mt-3"><StateStepper state={state} reached={reached} /></div>
        {run?.provenance === "fixture" && <p className="mt-2 text-[11px] text-warn">FIXTURE run: the "model" is a scripted test double. It exercises the pipeline; it says nothing about a model's ability.</p>}
        {error && <div className="mt-2"><ErrorBanner>{error}</ErrorBanner></div>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,0.9fr)_minmax(380px,1.3fr)_minmax(340px,1.1fr)]">
        <section className="flex min-h-0 flex-col border-r border-line">
          <PaneTitle>Topology {live ? "(live)" : ""}</PaneTitle>
          <div className="min-h-[280px] flex-1">
            {live ? <TopologyGraph topology={topology} highlight={touched} /> :
              <div className="grid h-full place-items-center px-6 text-center text-xs text-faint">Topology is shown live while a run is active.
                For a finished run, see the evidence and verification tabs; the report has the full record.</div>}
          </div>
          <div className="border-t border-line p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-faint">Resources the agent looked at</div>
            <div className="flex flex-wrap gap-1.5">{touched.map((t) => <Badge key={t} className="font-mono">{t}</Badge>)}
              {!touched.length && <span className="text-xs text-faint">None yet</span>}</div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-r border-line">
          <PaneTitle>Agent activity <span className="ml-2 text-faint">{events.length} events</span></PaneTitle>
          {pending.map((p) => <ApprovalCard key={p.id} runId={runId!} event={p} />)}
          <Timeline events={events} />
        </section>

        <section className="flex min-h-0 flex-col">
          <SidePanel events={events} run={run} />
        </section>
      </div>
    </div>
  );
}

function PaneTitle({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center border-b border-line px-4 py-2.5 text-xs font-semibold">{children}</div>;
}

function ApprovalCard({ runId, event }: { runId: string; event: RunEvent }) {
  const [busy, setBusy] = useState(false);
  const decide = async (approved: boolean) => {
    setBusy(true);
    try { await post(`/runs/${runId}/approvals/${event.payload.id}`, { approved, note: approved ? "approved in UI" : "rejected in UI" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="m-3 rounded-lg border border-warn/40 bg-warn/5 p-3 animate-fade-in" data-testid="approval-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-warn"><ShieldCheck className="size-4" /> Approval needed: {event.payload.source} {event.payload.kind}/{event.payload.name}</div>
      <p className="mt-1 text-xs text-muted">{event.payload.reason}</p>
      <p className="mt-1 text-[11px] text-faint">Policy check passed; dry run succeeded. Changed: {(event.payload.decision?.changed_paths ?? []).join(", ")}</p>
      <DiffView diff={event.payload.diff} className="mt-2 max-h-56" />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="success" disabled={busy} onClick={() => decide(true)}>Approve and apply</Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => decide(false)}>Reject</Button>
      </div>
    </div>
  );
}

// Timeline ----------------------------------------------------------------------------------------
type Entry = { key: string; ts: number; kind: string; event: RunEvent; result?: RunEvent };

function Timeline({ events }: { events: RunEvent[] }) {
  const entries = useMemo(() => {
    const out: Entry[] = [];
    const byCall = new Map<string, Entry>();
    for (const e of events) {
      if (e.type === "tool_result" && byCall.has(e.payload.id)) { byCall.get(e.payload.id)!.result = e; continue; }
      if (["model_call", "run_config"].includes(e.type)) continue;
      const entry: Entry = { key: String(e.id), ts: e.ts, kind: e.type, event: e };
      if (e.type === "tool_call") byCall.set(e.payload.id, entry);
      out.push(entry);
    }
    return out;
  }, [events]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries.length]);
  const start = events[0]?.ts;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="timeline">
      <ol className="relative space-y-2 border-l border-line pl-4">
        {entries.map((x) => <TimelineEntry key={x.key} entry={x} start={start} />)}
      </ol>
      <div ref={end} />
    </div>
  );
}

const ICONS: Record<string, typeof Bot> = { decision: Bot, observation: Eye, hypothesis: Lightbulb, tool_call: Wrench, patch_proposed: FileText,
  policy_decision: ShieldX, applied_change: ShieldCheck, test_result: TestTube2, image_built: Hammer };

function TimelineEntry({ entry, start }: { entry: Entry; start?: number }) {
  const [open, setOpen] = useState(false);
  const { event: e, result } = entry;
  const p = e.payload;
  const Icon = ICONS[e.type];
  const rel = start ? `+${fmtDuration(e.ts - start)}` : "";
  const time = <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint" title={fmtTime(e.ts)}>{rel}</span>;

  if (e.type === "state") {
    return <li className="relative -ml-4 flex items-center gap-2 py-1 pl-4 text-[11px] text-faint">
      <span className="absolute -left-[5px] size-2.5 rounded-full border border-line bg-bg" />→ <span className="font-medium text-muted">{STATE_LABEL[p.state] ?? p.state}</span>{time}</li>;
  }
  const card = (tone: string, title: React.ReactNode, body?: React.ReactNode, expandable?: React.ReactNode) => (
    <li className="animate-fade-in">
      <div className={cn("rounded-lg border bg-panel px-3 py-2", tone)}>
        <div className="flex items-center gap-2 text-xs">
          {Icon && <Icon className="size-3.5 shrink-0 text-muted" />}
          <div className="min-w-0 flex-1">{title}</div>
          {expandable && <button onClick={() => setOpen(!open)} className="text-faint hover:text-ink" aria-label="Expand">{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>}
          {time}
        </div>
        {body && <div className="mt-1.5 text-xs text-muted">{body}</div>}
        {open && expandable && <div className="mt-2">{expandable}</div>}
      </div>
    </li>
  );

  switch (e.type) {
    case "setup": return card("border-line", <span className="text-muted">Setup · {p.step}</span>, p.detail ? <span className="font-mono text-[11px]">{p.detail}</span> : undefined);
    case "baseline": return card("border-ok/30", <span className="font-medium text-ok">Healthy baseline confirmed</span>, <CheckList checks={p.checks} />);
    case "fault_injected": return card("border-warn/30", <span className="font-medium text-warn">Fault injected</span>, p.failure);
    case "detected": return card("border-bad/40", <span className="font-medium text-bad">Detected: {p.incident}</span>, <><p>{p.symptom}</p><div className="mt-2"><CheckList checks={p.fault_proof} /></div></>);
    case "decision": return card("border-line", <span className="text-ink">{p.text}</span>);
    case "observation": return card("border-info/30", <span><Badge tone="info">Observation</Badge> <span className="ml-1 text-ink">{p.text}</span></span>,
      p.evidence?.length ? <span>Evidence: {p.evidence.join(" · ")}</span> : undefined);
    case "hypothesis": return card("border-accent/40", <span><Badge tone="accent">Hypothesis</Badge> <span className="ml-1 text-ink">{p.text}</span></span>,
      p.evidence?.length ? <span>Evidence: {p.evidence.join(" · ")}</span> : undefined);
    case "tool_call": {
      const ok = result?.payload.ok;
      return card(result ? (ok ? "border-line" : "border-bad/40") : "border-accent/30",
        <span className="flex items-center gap-2"><span className="font-mono font-medium text-ink">{p.tool}</span>
          <span className="truncate font-mono text-[11px] text-faint">{argSummary(p.arguments)}</span>
          {result ? <Badge tone={ok ? "ok" : "bad"}>{ok ? "ok" : "error"} · {result.payload.duration_ms} ms</Badge> : <Badge tone="accent">running</Badge>}</span>,
        undefined,
        <><div className="mb-1 text-[10.5px] uppercase text-faint">Arguments</div><CodeBlock>{JSON.stringify(p.arguments, null, 2)}</CodeBlock>
          {result && <><div className="mb-1 mt-2 text-[10.5px] uppercase text-faint">Result (redacted, size-limited)</div><CodeBlock>{pretty(result.payload.output)}</CodeBlock></>}</>);
    }
    case "patch_proposed": return card("border-accent/30", <span className="text-ink">Patch proposed · <span className="font-mono">{p.path}</span></span>, p.reason,
      <DiffView diff={p.diff} />);
    case "policy_decision": return card(p.status === "pending_approval" ? "border-warn/40" : "border-bad/40",
      <span className="text-ink">Policy: <span className="font-medium">{p.status.replace("_", " ")}</span> · {p.source} {p.kind}/{p.name}</span>,
      (p.decision?.reasons ?? []).length ? <ul className="list-disc pl-4">{p.decision.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul> : p.error,
      p.diff ? <DiffView diff={p.diff} /> : undefined);
    case "approval": return card(p.approved ? "border-ok/30" : "border-bad/30", <span>{p.approved ? "Approved" : "Rejected"} by reviewer</span>, p.note);
    case "applied_change": return card("border-ok/30", <span className="text-ink">Applied · {p.source} {p.kind}/{p.name} <span className="text-faint">({fmtDuration(p.duration_s)}, dry-run + policy + write)</span></span>,
      p.reason, <DiffView diff={p.diff} />);
    case "test_result": return card(p.passed ? "border-ok/30" : "border-bad/40",
      <span className="text-ink">Tests {p.passed ? "passed" : "failed"} · <span className="font-mono text-[11px]">{p.command}</span> <span className="text-faint">({p.duration_s} s)</span></span>,
      <span className="text-[11px]">{p.isolation}</span>, <CodeBlock>{p.output}</CodeBlock>);
    case "image_built": return card("border-line", <span className="text-ink">Image built · <span className="font-mono text-[11px]">{p.image}</span></span>,
      <span>from commit {String(p.source_commit).slice(0, 10)} in {p.duration_s} s</span>);
    case "rollout": return card(p.complete ? "border-ok/30" : "border-warn/40", <span className="text-ink">Rollout {p.deployment}: {p.complete ? "complete" : "not complete"} · {p.ready}/{p.replicas} ready after {p.waited_s} s</span>);
    case "verification": return card(p.ok ? "border-ok/50" : "border-bad/50",
      <span className={cn("font-medium", p.ok ? "text-ok" : "text-bad")}>Independent verification {p.ok ? "passed" : "failed"} (attempt {p.attempt})</span>,
      <CheckList checks={p.checks} />);
    case "retry": return card("border-warn/40", <span className="text-warn">Retry</span>, p.reason);
    case "escalation": return card("border-info/40", <span className="font-medium text-info">Escalation</span>, <><p className="text-ink">{p.root_cause}</p><p>{p.summary}</p></>);
    case "drift": return card("border-warn/40", <span className="text-warn">Source and live state differ</span>, <CodeBlock>{JSON.stringify(p.differences, null, 2)}</CodeBlock>);
    case "error": return card("border-bad/50", <span className="text-bad">Error · {p.where}</span>, p.message);
    case "final": return card("border-line", <span className="font-medium">Run finished: {STATE_LABEL[p.state] ?? p.state}</span>, p.reason);
    case "cancel_requested": return card("border-line", <span>Cancellation requested</span>);
    default: return card("border-line", <span className="text-muted">{e.type}</span>, <CodeBlock>{JSON.stringify(p, null, 2)}</CodeBlock>);
  }
}

function argSummary(args: Record<string, any> = {}) {
  return Object.entries(args).filter(([k]) => !["content", "new_text", "old_text", "json_body", "patch"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ").slice(0, 120);
}

function pretty(text: string) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// Right panel -------------------------------------------------------------------------------------
function SidePanel({ events, run }: { events: RunEvent[]; run: Run | null }) {
  const of = (t: string) => events.filter((e) => e.type === t).map((e) => e.payload);
  const patches = of("patch_proposed");
  const changes: Record<string, any>[] = events.filter((e) => ["applied_change", "policy_decision"].includes(e.type)).map((e) => ({ ...e.payload, type: e.type }));
  const tests = of("test_result");
  const verifications = of("verification");
  const m = run?.metrics;
  return (
    <Tabs defaultValue="evidence" className="flex min-h-0 flex-1 flex-col">
      <TabsList><TabsTrigger value="evidence">Evidence</TabsTrigger><TabsTrigger value="patch">Patch ({changes.length})</TabsTrigger>
        <TabsTrigger value="tests">Tests ({tests.length})</TabsTrigger><TabsTrigger value="verify">Verification</TabsTrigger></TabsList>
      <TabsContent value="evidence" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <Section title="Fault proof (before the agent started)">{of("detected")[0] ? <CheckList checks={of("detected")[0].fault_proof} /> : <Empty />}</Section>
        <Section title="Observations">{of("observation").map((o, i) => <p key={i} className="text-ink">• {o.text}</p>)}{!of("observation").length && <Empty />}</Section>
        <Section title="Hypotheses">{of("hypothesis").map((o, i) => <p key={i} className="text-ink">• {o.text}</p>)}{!of("hypothesis").length && <Empty />}</Section>
        {of("escalation")[0] && <Section title="Escalation"><p className="text-ink">{of("escalation")[0].root_cause}</p><p className="text-muted">{of("escalation")[0].summary}</p></Section>}
        {m && <Section title="Measurements"><div className="grid grid-cols-2 gap-2 text-muted">
          <span>Model calls: {m.model_calls}</span><span>Model time: {fmtDuration(m.model_latency_s)}</span>
          <span>Tokens: {m.token_usage === "unavailable" ? "unavailable" : m.total_tokens?.toLocaleString()}</span><span>Tool calls: {m.tool_calls}</span>
          <span>Tool time: {fmtDuration(m.tool_time_s)}</span><span>Rejected actions: {m.rejected_actions}</span></div></Section>}
      </TabsContent>
      <TabsContent value="patch" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {patches.length > 0 && <Section title="Latest workspace diff (source of truth)"><DiffView diff={patches[patches.length - 1].diff} /></Section>}
        <Section title="Cluster changes">
          {changes.map((c, i) => <div key={i} className="mb-3 space-y-1.5">
            <div className="flex items-center gap-2"><Badge tone={c.status === "applied" ? "ok" : c.status === "pending_approval" ? "warn" : "bad"}>{c.status}</Badge>
              <span className="font-mono">{c.source} {c.kind}/{c.name}</span></div>
            {(c.decision?.reasons ?? []).map((r: string) => <p key={r} className="text-bad">{r}</p>)}
            {c.diff && <DiffView diff={c.diff} />}</div>)}
          {!changes.length && <Empty />}
        </Section>
      </TabsContent>
      <TabsContent value="tests" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
        {tests.map((t, i) => <div key={i} className="space-y-1.5"><div className="flex items-center gap-2"><Badge tone={t.passed ? "ok" : "bad"}>exit {t.exit_code}</Badge>
          <span className="font-mono">{t.command}</span><span className="text-faint">{t.duration_s} s</span></div>
          <p className="text-faint">{t.isolation}</p><CodeBlock>{t.output}</CodeBlock></div>)}
        {!tests.length && <Empty />}
      </TabsContent>
      <TabsContent value="verify" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
        <p className="text-faint">Hidden checks run by the experiment harness, independent of the agent. Only these can mark a run resolved.</p>
        {verifications.map((v, i) => <Section key={i} title={`Attempt ${v.attempt}: ${v.ok ? "passed" : "failed"} (agent said ${v.agent_outcome})`}><CheckList checks={v.checks} /></Section>)}
        {of("rollout").map((r, i) => <p key={i} className="text-muted">Rollout {r.deployment}: {r.complete ? "complete" : "incomplete"} after {r.waited_s} s</p>)}
        {!verifications.length && <Empty text="Not reached yet." />}
      </TabsContent>
    </Tabs>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h4>{children}</section>;
}
function Empty({ text = "Nothing yet." }: { text?: string }) { return <p className="text-faint">{text}</p>; }
