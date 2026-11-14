"use client";

import { pairTitle } from "@/lib/doc-names";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Claims } from "@/components/Claims";
import { Icon } from "@/components/Icon";
import { PageViewer, type Highlight, type ViewerDoc } from "@/components/PageViewer";
import { RunLog } from "@/components/RunLog";
import { CellDetail, Sheet, type EditInput } from "@/components/Sheet";
import { Trace } from "@/components/Trace";
import { cellText, money, secs } from "@/components/format";
import type { CheckedCell, CheckedClaim, DocKey, Place } from "@/lib/book";
import { references } from "@/lib/formula";
import { modelName } from "@/lib/model-name";
import type { Run } from "@/lib/runs";

type Tab = "model" | "claims" | "trace" | "log";

const STAGES = [
  { key: "reading", label: "Read the pages" },
  { key: "transcribing", label: "Read scanned pages" },
  { key: "working", label: "Build the model" },
  { key: "checking", label: "Check every cell" },
  { key: "done", label: "Done" },
] as const;

function useRun(initial: Run) {
  const [run, setRun] = useState(initial);
  useEffect(() => {
    if (run.status === "done" || run.status === "failed") return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${initial.id}`, { cache: "no-store" });
        if (res.ok && !stop) setRun((await res.json()) as Run);
      } catch {}
    };
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [initial.id, run.status]);
  return [run, setRun] as const;
}

// Results stored before documents had keys have no doc on their places: they are all A.
const placeDoc = (p: { doc?: DocKey } | undefined): DocKey => (p?.doc === "B" ? "B" : "A");

export function RunView({ initial, initialCell }: { initial: Run; initialCell?: string }) {
  const [run, setRun] = useRun(initial);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("model");
  const [sheet, setSheet] = useState<string | null>(null);
  const [cellKey, setCellKey] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [view, setView] = useState<{ doc: DocKey; page: number }>({ doc: "A", page: 1 });
  const [again, setAgain] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  const two = !!run.docB;

  // Opened from "Search your runs": select that cell, show its sheet and its page.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialCell) return;
    const c = (run.result?.cells ?? []).find((x) => `${x.sheet}!${x.ref}` === initialCell);
    if (!c) return;
    opened.current = true;
    setSheet(c.sheet);
    setCellKey(initialCell);
    if (c.at) setView({ doc: c.at.doc === "B" ? "B" : "A", page: c.at.page });
  }, [initialCell, run.result]);

  // Before the checks run, show the cells as written.
  const cells: CheckedCell[] = useMemo(
    () => run.result?.cells ?? run.cells.map((c) => ({ ...c, checks: [], at: c.source ? { doc: placeDoc(c.source), page: c.source.page, box: c.source.box } : undefined })),
    [run.result, run.cells],
  );
  const claims: CheckedClaim[] = useMemo(() => run.result?.claims ?? run.claims.map((c) => ({ ...c, quoted: false, at: { doc: placeDoc(c), page: c.page } })), [run.result, run.claims]);
  const sheets = useMemo(() => [...new Set(cells.map((c) => c.sheet))], [cells]);

  // Each document's pages, and the pages the model opened or cited: the short list worth jumping between.
  const docs: ViewerDoc[] = useMemo(() => {
    const list = [{ key: "A" as DocKey, info: run.doc }, ...(run.docB ? [{ key: "B" as DocKey, info: run.docB }] : [])];
    return list.map(({ key, info }) => {
      const set = new Set<number>();
      for (const st of run.steps) for (const c of st.calls) for (const im of c.images ?? []) if ((im.doc ?? "A") === key) set.add(im.page);
      for (const c of cells) if (c.source?.page && placeDoc(c.source) === key) set.add(c.source.page);
      for (const c of claims) if (placeDoc(c.at) === key) set.add(c.at.page);
      return { key, name: info.name, pages: info.pages, sizes: info.sizes, scanned: info.scanned ?? [], used: [...set].filter((n) => n >= 1 && n <= info.pages).sort((a, b) => a - b) };
    });
  }, [run.doc, run.docB, run.steps, cells, claims]);

  // Open on the first sheet that holds numbers, not a text-only cover sheet.
  const firstNumeric = sheets.find((n) => cells.some((c) => c.sheet === n && (c.formula || typeof c.value === "number"))) ?? sheets[0];
  const activeSheet = sheet && sheets.includes(sheet) ? sheet : firstNumeric;
  const cell = cells.find((c) => `${c.sheet}!${c.ref}` === cellKey);
  const claim = claims.find((c) => c.id === claimId);

  const running = run.status !== "done" && run.status !== "failed";
  const numbers = cells.filter((c) => c.formula || typeof c.value === "number").length;
  const scannedPages = docs.reduce((n, d) => n + d.scanned.length, 0);
  const stages = STAGES.filter((st) => st.key !== "transcribing" || scannedPages > 0 || run.status === "transcribing");
  const stageIndex = stages.findIndex((st) => st.key === run.status);
  const s = run.result?.summary;
  const totals = run.calls.reduce((a, c) => ({ ms: a.ms + c.ms, cost: a.cost === null || c.cost === null ? null : a.cost + c.cost }), { ms: 0, cost: 0 as number | null });
  // Elapsed time from the first model call to the end of the last: scanned pages are read several at a
  // time, so adding up call times would overstate it.
  const replayed = run.calls.length > 0 && run.calls.every((c) => c.provider === "replay");
  const span = run.calls.length ? Math.max(...run.calls.map((c) => Date.parse(c.startedAt) + c.ms)) - Math.min(...run.calls.map((c) => Date.parse(c.startedAt))) : 0;
  const verdicts = { supported: 0, contradicted: 0, not_checkable: 0 };
  for (const c of claims) verdicts[c.verdict]++;

  function show(at: { doc?: DocKey; page: number } | undefined) {
    if (!at?.page) return;
    setView({ doc: placeDoc(at), page: at.page });
    if (window.matchMedia("(max-width: 1040px)").matches) setTimeout(() => viewer.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  // Where a cell points on the page: its own source, or for a formula without one, the first sourced input it reads.
  function placeOf(c: CheckedCell | undefined): { at: Place; via?: CheckedCell } | null {
    if (!c) return null;
    if (c.at) return { at: { ...c.at, doc: placeDoc(c.at) } };
    if (!c.formula) return null;
    try {
      for (const r of references(c.formula, c.sheet)) {
        const input = cells.find((x) => `${x.sheet}!${x.ref}` === r);
        if (input?.at && !input.formula) return { at: { ...input.at, doc: placeDoc(input.at) }, via: input };
      }
    } catch {}
    return null;
  }

  function selectCell(k: string) {
    setCellKey(k);
    show(placeOf(cells.find((x) => `${x.sheet}!${x.ref}` === k))?.at);
  }

  function selectClaim(id: string) {
    setClaimId(id);
    show(claims.find((c) => c.id === id)?.at);
  }

  let highlight: Highlight | undefined;
  const place = tab === "model" ? placeOf(cell) : null;
  if (cell && place && place.at.page === view.page && place.at.doc === view.doc) {
    const shown = place.via ?? cell;
    const chart = !shown.source?.quote && shown.checks.some((k) => k.status === "info");
    highlight = {
      box: place.at.box,
      lines: place.at.lines,
      chart,
      caption: place.via
        ? `${cell.label ?? cell.ref} is a formula; this is the first number it reads, ${shown.sheet}!${shown.ref} (${shown.label ?? ""}: ${cellText(shown)}).`
        : `${cell.label ?? cell.ref}: ${cellText(cell)}${chart ? " (read from the chart region marked)" : ""}`,
    };
  } else if (tab === "claims" && claim && claim.at.page === view.page && placeDoc(claim.at) === view.doc) {
    highlight = {
      lines: claim.at.lines,
      caption: !claim.at.lines?.length ? (/^(table|figure)\b/i.test(claim.claim) ? "A check the model ran on a table or figure on this page." : "The model paraphrased this claim, so it is not marked on the page.") : claim.quoted ? "The claim, as printed." : "The start of the claim, as printed. The model shortened or combined the rest.",
    };
    if (claim.at.lines?.length) highlight.box = claim.at.lines[0];
  }

  async function runAgain(python: boolean) {
    setAgain(true);
    const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ again: run.id, python }) });
    const data = (await res.json()) as { id?: string };
    if (data.id) router.push(`/run/${data.id}`);
    else setAgain(false);
  }

  // Hand edits: the server reruns the deterministic checks and recompute and returns the updated run.
  async function edit(body: object): Promise<string | null> {
    if (!cell) return "Pick a cell first.";
    try {
      const res = await fetch(`/api/runs/${run.id}/cells`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheet: cell.sheet, ref: cell.ref, ...body }) });
      const data = (await res.json()) as Run & { error?: string };
      if (!res.ok) return data.error ?? `Save failed (${res.status})`;
      setRun(data);
      const updated = data.result?.cells.find((c) => c.sheet === cell.sheet && c.ref === cell.ref);
      if (updated?.at) setView({ doc: placeDoc(updated.at), page: updated.at.page });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  const modelVersion = cell && run.original && `${cell.sheet}!${cell.ref}` in run.original ? (run.original[`${cell.sheet}!${cell.ref}`] as CheckedCell | null) : undefined;
  const showViewer = tab === "model" || tab === "claims";
  const title = two ? pairTitle(run.doc.name, run.docB!.name) : run.doc.name;

  return (
    <>
      <section className="run-head">
        <Link href="/" className="back">
          <Icon name="back" size={14} /> All runs
        </Link>
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <h2 style={{ overflowWrap: "anywhere" }}>{title}</h2>
            <span className="faint small">
              {two ? `A ${run.doc.pages || "?"} pages, B ${run.docB!.pages || "?"} pages` : run.doc.pages ? `${run.doc.pages} pages` : "Reading"}
              {scannedPages ? ` · ${scannedPages} scanned ${scannedPages === 1 ? "page" : "pages"} read by the model` : ""} · {modelName(run.model)} · Python {run.options.python ? "on" : "off"}
              {run.doc.source?.author ? ` · ${run.doc.source.author}` : ""}
            </span>
          </div>
          {!running && (
            <div className="row">
              {run.result && (
                <a className="btn btn-primary" href={`/api/runs/${run.id}/files/model.xlsx`} download>
                  <Icon name="download" size={14} /> Download .xlsx
                </a>
              )}
              <button className="btn" disabled={again} onClick={() => runAgain(!run.options.python)} title="Same documents and task, with run_python switched">
                <Icon name="undo" size={14} /> Run again with Python {run.options.python ? "off" : "on"}
              </button>
            </div>
          )}
        </div>

        <div className="steps" aria-label="Progress">
          {stages.map((st, i) => (
            <span key={st.key} className={`step${run.status === "failed" && i === Math.max(stageIndex, 1) ? " failed" : run.status === "done" ? (st.key === "done" ? " now" : " done") : i < stageIndex ? " done" : i === stageIndex ? " now" : ""}`}>
              {st.label}
            </span>
          ))}
        </div>

        {running && (
          <div className="live" role="status">
            <span className="pulse" />
            <span>
              {run.progress.stage}
              <span className="faint">
                {run.progress.chars > 0 ? ` · ${run.progress.chars.toLocaleString("en-US")} characters streamed` : ""} · {numbers} numbers so far
              </span>
            </span>
          </div>
        )}

        {run.status === "failed" && (
          <div className="error-box small" role="alert">
            <strong>The run stopped.</strong> {run.error}
            {run.cells.length > 0 && " The cells written before it stopped are checked below."}
          </div>
        )}

        {s && (
          <div className="stats">
            <div className="stat">
              <span className="n">
                {s.matched + (s.matchedScan ?? 0)}
                <span className="faint" style={{ fontSize: 16 }}> / {s.inputs}</span>
              </span>
              <span className="l">
                inputs found on their cited page
                {s.matchedScan ? `: ${s.matched} in PDF text, ${s.matchedScan} in the model's reading of scanned pages` : ""}
              </span>
            </div>
            <div className="stat">
              <span className="n">
                {s.recomputed}
                <span className="faint" style={{ fontSize: 16 }}> / {s.formulas}</span>
              </span>
              <span className="l">formulas recomputed{s.edited ? ` · ${s.edited} ${s.edited === 1 ? "cell" : "cells"} edited by you` : ""}</span>
            </div>
            <div className="stat">
              <span className="n">{claims.length}</span>
              <span className="l">
                claims: {verdicts.supported} supported, {verdicts.contradicted} contradicted, {verdicts.not_checkable} not checkable
              </span>
            </div>
            <div className="stat">
              {/* A replay runs in seconds; show the recorded calls' own time instead of the replay's. */}
              <span className="n">{secs(replayed ? totals.ms : span || totals.ms)}</span>
              <span className="l">
                {run.calls.length} model calls · {money(totals.cost)}
                {replayed && " · model time of the recorded calls, summed"}
              </span>
            </div>
          </div>
        )}
        {run.note && <p className="note">{run.note}</p>}
      </section>

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "model"} onClick={() => setTab("model")}>
          <Icon name="layers" size={14} /> Model <span className="count">{numbers}</span>
        </button>
        <button className="tab" role="tab" aria-selected={tab === "claims"} onClick={() => setTab("claims")}>
          <Icon name="list" size={14} /> Claims <span className="count">{claims.length}</span>
        </button>
        <button className="tab" role="tab" aria-selected={tab === "trace"} onClick={() => setTab("trace")}>
          <Icon name="code" size={14} /> Agent trace <span className="count">{run.steps.length}</span>
        </button>
        <button className="tab" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")}>
          <Icon name="clock" size={14} /> Run log
        </button>
      </div>

      <div className={showViewer ? "split" : "full"}>
        <div style={{ minWidth: 0 }}>
          {tab === "model" &&
            (cells.length ? (
              <>
                <Sheet cells={cells} sheets={sheets} sheet={activeSheet!} onSheet={setSheet} selected={cellKey} onSelect={selectCell} scans={scannedPages > 0} />
                {cell ? (
                  <CellDetail
                    key={`${cell.sheet}!${cell.ref}`}
                    cell={cell}
                    docs={docs.map((d) => ({ key: d.key, name: d.name, pages: d.pages }))}
                    editable={!running && (!!cell.formula || typeof cell.value === "number")}
                    modelVersion={modelVersion}
                    onSave={(e: EditInput) => edit({ action: "edit", ...e })}
                    onReset={() => edit({ action: "reset" })}
                  />
                ) : (
                  <p className="faint small">Click a number to see where it came from{running ? "" : ", or to edit it"}.</p>
                )}
              </>
            ) : (
              <p className="muted">{running ? (run.status === "transcribing" ? "The model is reading the scanned pages first." : "The model is reading. Cells appear here as it writes them.") : "The model wrote no cells."}</p>
            ))}
          {tab === "claims" && <Claims claims={claims} selected={claimId} onSelect={selectClaim} two={two} />}
          {tab === "trace" && <Trace runId={run.id} steps={run.steps} calls={run.calls} docs={docs} />}
          {tab === "log" && <RunLog run={run} />}
        </div>
        {showViewer && (
          <div ref={viewer}>
            <PageViewer runId={run.id} docs={docs} doc={view.doc} page={Math.min(view.page, Math.max(1, (view.doc === "B" ? run.docB?.pages : run.doc.pages) ?? 1))} onPage={(doc, page) => setView({ doc, page })} highlight={highlight} />
          </div>
        )}
      </div>
    </>
  );
}
