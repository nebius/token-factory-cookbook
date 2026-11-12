import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Health } from "@/lib/types";

export const STATE_LABEL: Record<string, string> = {
  idle: "Idle", pending: "Pending", setting_up: "Setting up", baseline_ready: "Baseline healthy", injecting: "Injecting fault",
  detected: "Detected", investigating: "Investigating", patch_proposed: "Patch proposed", testing: "Testing",
  applying: "Applying", verifying: "Verifying", resolved: "Resolved", escalated: "Escalated", unresolved: "Unresolved",
  blocked: "Blocked", cancelled: "Cancelled", error: "Error",
};

const TONE: Record<string, "ok" | "warn" | "bad" | "info" | "accent" | "neutral"> = {
  resolved: "ok", escalated: "info", baseline_ready: "ok", unresolved: "bad", blocked: "warn", cancelled: "neutral",
  error: "bad", detected: "bad", setting_up: "accent", injecting: "warn", investigating: "accent", patch_proposed: "accent",
  testing: "accent", applying: "warn", verifying: "info",
};

export const TERMINAL = new Set(["resolved", "escalated", "unresolved", "blocked", "cancelled", "error"]);

export function StateBadge({ state, className }: { state: string; className?: string }) {
  const running = !TERMINAL.has(state) && !["idle", "baseline_ready", "detected", "pending"].includes(state);
  return (
    <Badge tone={TONE[state] ?? "neutral"} className={className} data-testid="state-badge">
      {running ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      {STATE_LABEL[state] ?? state}
    </Badge>
  );
}

export function HealthDot({ health, className }: { health: Health; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full",
    health === "ok" ? "bg-ok" : health === "warn" ? "bg-warn" : "bg-bad", className)} aria-label={health} />;
}

export function ProvenanceBadge({ provenance, replayOf }: { provenance: string; replayOf?: string | null }) {
  const label: Record<string, [string, "warn" | "ok" | "info" | "neutral" | "accent"]> = {
    fixture: ["FIXTURE · scripted, no model", "warn"],
    "local-live": ["Live · kind", "accent"],
    "civo-live": ["Live · Civo", "ok"],
    replay: [`Replay${replayOf ? ` of ${replayOf}` : ""}`, "info"],
    pending: ["Not investigated yet", "neutral"],
  };
  const [text, tone] = label[provenance] ?? [provenance, "neutral"];
  return <Badge tone={tone} data-testid="provenance">{text}</Badge>;
}

const STEPS = ["detected", "investigating", "patch_proposed", "testing", "applying", "verifying"];

export function StateStepper({ state, reached }: { state: string; reached: Set<string> }) {
  const terminal = TERMINAL.has(state);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" data-testid="state-stepper">
      {STEPS.map((s, i) => {
        const active = s === state;
        const done = reached.has(s) && !active;
        return (
          <React.Fragment key={s}>
            <li className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active ? "border-accent/50 bg-accent/10 text-accent" : done ? "border-line bg-raised text-ink" : "border-line/60 text-faint")}>
              {active ? <Loader2 className="size-3 animate-spin" /> : done ? <CheckCircle2 className="size-3 text-ok" /> : <CircleDashed className="size-3" />}
              {STATE_LABEL[s]}
            </li>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-line" />}
          </React.Fragment>
        );
      })}
      <span className="h-px w-3 bg-line" />
      <li>{terminal ? <StateBadge state={state} className="px-2.5 py-1" /> :
        <span className="rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-faint">Outcome</span>}</li>
    </ol>
  );
}

export function DiffView({ diff, className }: { diff: string; className?: string }) {
  if (!diff?.trim()) return <p className="text-xs text-faint">No changes.</p>;
  return (
    <pre className={cn("overflow-x-auto rounded-lg border border-line bg-bg/60 p-3 font-mono text-[11.5px] leading-[1.55]", className)} data-testid="diff">
      {diff.split("\n").map((line, i) => (
        <div key={i} className={cn("whitespace-pre",
          line.startsWith("+++") || line.startsWith("---") ? "text-faint" :
          line.startsWith("+") ? "bg-ok/10 text-ok" : line.startsWith("-") ? "bg-bad/10 text-bad" :
          line.startsWith("@@") ? "text-info" : line.startsWith("diff ") ? "mt-2 font-semibold text-ink" : "text-muted")}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

export function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  return <pre className={cn("max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-bg/60 p-3 font-mono text-[11.5px] leading-relaxed text-muted", className)}>{children}</pre>;
}

export function CheckList({ checks }: { checks: { name: string; ok: boolean; detail?: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c, i) => (
        <li key={i} className="flex gap-2 text-xs">
          {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-bad" />}
          <span><span className="font-medium text-ink">{c.name}</span>{c.detail && <span className="text-muted"> · {c.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad" role="alert">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <div>{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-raised/40 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
