"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtValue } from "@/components/format";
import type { Hit } from "@/lib/db";
import type { Format } from "@/lib/book";

const STATUS: Record<string, { word: string; cls: string }> = {
  ok: { word: "Found on its page", cls: "ok" },
  scan: { word: "Matches a scanned page", cls: "scan" },
  info: { word: "Read from a chart", cls: "info" },
  warn: { word: "Check", cls: "warn" },
  fail: { word: "Problem", cls: "fail" },
};

// Every cell the model has written, in every run on this machine, searchable by label or value.
export function SearchRuns() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(text)}`).then((x) => x.json());
        if (mine === seq.current) setHits(r.hits ?? []);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <section className="stack search-runs" aria-label="Search your runs">
      <div className="field">
        <label htmlFor="search-runs">Search your runs</label>
        <input id="search-runs" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A label or a number, e.g. unemployment rate, 77,549 or 3.6%" autoComplete="off" spellCheck={false} />
      </div>
      {hits && (
        <div className="hits" aria-live="polite">
          {hits.length === 0 ? (
            <p className="faint small" style={{ margin: 0 }}>
              {busy ? "Searching…" : `No cells match “${q.trim()}”.`}
            </p>
          ) : (
            hits.map((h) => {
              const st = h.status ? STATUS[h.status] : undefined;
              const value = h.formula ? (h.result === null ? h.formula : fmtValue(h.result, (h.format as Format) ?? undefined)) : h.value !== null ? fmtValue(h.value, (h.format as Format) ?? undefined) : (h.valueText ?? "");
              return (
                <Link key={`${h.runId}-${h.sheet}-${h.ref}`} href={`/run/${h.runId}?cell=${encodeURIComponent(`${h.sheet}!${h.ref}`)}`} className="hit">
                  <span className="hit-value">{value}</span>
                  <span className="hit-main">
                    <span className="hit-label">{h.label || `${h.sheet}!${h.ref}`}</span>
                    <span className="faint caption">
                      {h.runName}
                      {h.page ? ` · ${h.docName && / vs /.test(h.runName) ? `${h.doc}, ` : ""}page ${h.page}` : h.formula ? " · formula" : ""} · {h.sheet}!{h.ref}
                      {h.edited ? " · edited by you" : ""}
                    </span>
                  </span>
                  {st && <span className={`badge ${st.cls}`}>{st.word}</span>}
                </Link>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
