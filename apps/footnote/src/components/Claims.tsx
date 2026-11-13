"use client";

import { useState } from "react";
import type { CheckedClaim } from "@/lib/book";

const VERDICT = {
  supported: { word: "Supported", cls: "ok" },
  contradicted: { word: "Contradicted", cls: "fail" },
  not_checkable: { word: "Not checkable", cls: "info" },
} as const;

type Filter = "all" | keyof typeof VERDICT;

export function Claims({ claims, selected, onSelect, two = false }: { claims: CheckedClaim[]; selected: string | null; onSelect: (id: string) => void; two?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  if (!claims.length) return <p className="muted">No claims yet. The model reports them at the end of the run.</p>;
  const shown = filter === "all" ? claims : claims.filter((c) => c.verdict === filter);
  const count = (v: Filter) => (v === "all" ? claims.length : claims.filter((c) => c.verdict === v).length);
  return (
    <div>
      <div className="filters" role="group" aria-label="Filter claims">
        {(["all", "supported", "contradicted", "not_checkable"] as Filter[]).map((f) => (
          <button key={f} className="sheet-tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : VERDICT[f].word} <span className="faint">{count(f)}</span>
          </button>
        ))}
      </div>
      <div className="claims">
        {shown.map((c) => (
          <div key={c.id} className={`claim${selected === c.id ? " sel" : ""}`} onClick={() => onSelect(c.id)}>
            <span className="spread">
              <span className={`badge ${VERDICT[c.verdict].cls}`}>{VERDICT[c.verdict].word}</span>
              <button className="page-link" onClick={(e) => (e.stopPropagation(), onSelect(c.id))} aria-pressed={selected === c.id}>
                Show on {two ? `${c.at?.doc ?? c.doc ?? "A"} ` : ""}page {c.at?.page ?? c.page}
                {c.at.lines?.length ? "" : /^(table|figure)\b/i.test(c.claim) ? " (table or figure check)" : " (paraphrased)"}
              </button>
            </span>
            <span className="text">{/^table:/i.test(c.claim) ? c.claim.replace(/^table:\s*/i, "Table check: ") : `“${c.claim}”`}</span>
            <span className="ev">{c.evidence}</span>
            {c.gap && (
              <span className="ev">
                <strong style={{ color: "var(--bad)" }}>Gap:</strong> {c.gap}
              </span>
            )}
            {c.python && (
              <details onClick={(e) => e.stopPropagation()}>
                <summary>Python the model ran</summary>
                <pre className="code" style={{ marginTop: 8 }}>
                  {c.python}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
