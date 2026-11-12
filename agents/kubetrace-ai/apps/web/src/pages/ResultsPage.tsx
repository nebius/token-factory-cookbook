import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ProvenanceBadge } from "@/components/common";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmtDuration } from "@/lib/utils";

interface Row { provenance: string; scenario_id: string; model: string | null; runs: number; first_attempt_success: number; eventual_success: number;
  states: Record<string, number>; elapsed_s: number[]; tokens: number[]; run_ids: string[] }

const ORDER = ["civo-live", "local-live", "fixture"];
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function ResultsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { api<Row[]>("/results").then(setRows); }, []);
  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-6">
      <div><h1 className="text-lg font-semibold">Experiment results</h1>
        <p className="max-w-3xl text-xs text-muted">Built only from recorded runs. Every finished attempt counts. Fixture runs, local live runs and Civo live runs are kept apart;
          repeated runs of one scenario are repetitions, not separate capabilities. These are not SWE-bench or Terminal-Bench results.</p></div>
      {ORDER.map((prov) => {
        const group = rows.filter((r) => r.provenance === prov);
        return (
          <Card key={prov} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5"><ProvenanceBadge provenance={prov} /><span className="text-xs text-faint">{group.reduce((a, r) => a + r.runs, 0)} runs</span></div>
            <table className="w-full text-left text-xs">
              <thead className="text-faint"><tr><th className="px-4 py-2 font-medium">Scenario</th><th className="px-4 py-2 font-medium">Model</th><th className="px-4 py-2 font-medium">Runs</th>
                <th className="px-4 py-2 font-medium">First-attempt success</th><th className="px-4 py-2 font-medium">Eventual success</th><th className="px-4 py-2 font-medium">Outcomes</th>
                <th className="px-4 py-2 font-medium">Median agent time</th><th className="px-4 py-2 font-medium">Median tokens</th></tr></thead>
              <tbody>{group.map((r) => (
                <tr key={r.scenario_id + r.model} className="border-t border-line/60">
                  <td className="px-4 py-2">{r.scenario_id}</td><td className="px-4 py-2 font-mono text-[11px] text-muted">{prov === "fixture" ? "— (scripted)" : r.model}</td>
                  <td className="px-4 py-2">{r.runs}</td><td className="px-4 py-2">{r.first_attempt_success}/{r.runs}</td><td className="px-4 py-2">{r.eventual_success}/{r.runs}</td>
                  <td className="px-4 py-2 text-muted">{Object.entries(r.states).map(([k, v]) => `${k} ${v}`).join(", ")}</td>
                  <td className="px-4 py-2 text-muted">{fmtDuration(median(r.elapsed_s))}</td>
                  <td className="px-4 py-2 text-muted">{median(r.tokens)?.toLocaleString() ?? "unavailable"}</td>
                </tr>))}
                {!group.length && <tr><td colSpan={8} className="px-4 py-4 text-center text-faint">No runs of this kind yet.</td></tr>}</tbody>
            </table>
            {group.length > 0 && <div className="border-t border-line px-4 py-2 text-[11px] text-faint">Runs: {group.flatMap((r) => r.run_ids).slice(0, 12).map((id) =>
              <Link key={id} to={`/runs/${id}/report`} className="mr-2 font-mono hover:text-accent">{id}</Link>)}</div>}
          </Card>);
      })}
    </div>
  );
}
