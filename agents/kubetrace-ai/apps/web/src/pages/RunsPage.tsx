import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErrorBanner, ProvenanceBadge, StateBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, post } from "@/lib/api";
import { fmtDuration } from "@/lib/utils";
import type { Run } from "@/lib/types";

export function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useEffect(() => { const load = () => api<Run[]>("/runs").then(setRuns).catch((e) => setError(e.message)); load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  const importRun = async (f: File) => {
    try { const res = await post<{ run_id: string }>("/runs/import", JSON.parse(await f.text())); navigate(`/runs/${res.run_id}?replay=1`); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-6">
      <div className="flex items-end justify-between">
        <div><h1 className="text-lg font-semibold">Runs</h1><p className="text-xs text-muted">Every attempt, including failed and cancelled ones.</p></div>
        <div><input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importRun(e.target.files[0])} />
          <Button size="sm" variant="secondary" onClick={() => file.current?.click()}><Upload /> Import export for replay</Button></div>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Card className="overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line bg-raised/40 text-faint"><tr>
            <th className="px-4 py-2 font-medium">Run</th><th className="px-4 py-2 font-medium">Scenario</th><th className="px-4 py-2 font-medium">Provenance</th>
            <th className="px-4 py-2 font-medium">Model</th><th className="px-4 py-2 font-medium">State</th><th className="px-4 py-2 font-medium">First / eventual</th>
            <th className="px-4 py-2 font-medium">Duration</th><th className="px-4 py-2" /></tr></thead>
          <tbody>{runs.map((r) => (
            <tr key={r.id} className="border-b border-line/60 hover:bg-raised/40">
              <td className="px-4 py-2 font-mono text-[11px]"><Link to={`/runs/${r.id}`} className="hover:text-accent">{r.id}</Link></td>
              <td className="px-4 py-2">{r.scenario_id}</td>
              <td className="px-4 py-2"><ProvenanceBadge provenance={r.provenance} replayOf={r.replay_of} /></td>
              <td className="px-4 py-2 font-mono text-[11px] text-muted">{r.provider === "fixture" ? "—" : r.model ?? "—"}</td>
              <td className="px-4 py-2"><StateBadge state={r.state} /></td>
              <td className="px-4 py-2 text-muted">{r.first_attempt_success == null ? "—" : r.first_attempt_success ? "yes" : "no"} / {r.eventual_success == null ? "—" : r.eventual_success ? "yes" : "no"}</td>
              <td className="px-4 py-2 text-muted">{r.ended_at && r.started_at ? fmtDuration(r.ended_at - r.started_at) : "—"}</td>
              <td className="px-4 py-2 text-right"><Link to={`/runs/${r.id}/report`} className="text-accent">Report</Link></td>
            </tr>))}
            {!runs.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-faint">No runs yet. Start one from the experiment catalog.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
