"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { cellText, fmtValue, worst } from "@/components/format";
import type { CheckedCell, DocKey, Status } from "@/lib/book";
import { colLetters, parseRef } from "@/lib/formula";

const ICON: Record<Status, IconName> = { ok: "ok", scan: "eye", warn: "warn", fail: "no", info: "eye" };

export function Sheet({ cells, sheets, sheet, onSheet, selected, onSelect, scans = false }: { cells: CheckedCell[]; sheets: string[]; sheet: string; onSheet: (s: string) => void; selected: string | null; onSelect: (key: string) => void; scans?: boolean }) {
  const mine = cells.filter((c) => c.sheet === sheet);
  const at = new Map(mine.map((c) => [c.ref, c]));
  let maxCol = 1;
  let maxRow = 1;
  for (const c of mine) {
    const r = parseRef(c.ref);
    maxCol = Math.max(maxCol, r.col);
    maxRow = Math.max(maxRow, r.row);
  }
  maxCol = Math.min(maxCol, 40);
  maxRow = Math.min(maxRow, 400);
  const cols = Array.from({ length: maxCol }, (_, i) => i + 1);
  const rows = Array.from({ length: maxRow }, (_, i) => i + 1);

  return (
    <div>
      {sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((s) => (
            <button key={s} role="tab" className="sheet-tab" aria-selected={s === sheet} onClick={() => onSheet(s)}>
              {s} <span className="faint">{cells.filter((c) => c.sheet === s && (c.formula || typeof c.value === "number")).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="rowh" />
              {cols.map((c) => (
                <th key={c} className={c === 1 ? "stick" : undefined}>
                  {colLetters(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td className="rowh">{r}</td>
                {cols.map((c) => {
                  const ref = `${colLetters(c)}${r}`;
                  const cell = at.get(ref);
                  // Column A holds the row labels: it stays in view when a wide sheet scrolls.
                  const stick = c === 1 ? "stick" : undefined;
                  if (!cell) return <td key={c} className={stick} />;
                  const isText = !cell.formula && typeof cell.value !== "number";
                  const k = `${sheet}!${ref}`;
                  const st = worst(cell.checks);
                  if (isText)
                    return (
                      <td key={c} className={stick}>
                        <span className={`gc text${r === 1 ? " head" : ""}`} title={String(cell.value ?? "")}>
                          {fmtValue(cell.value)}
                        </span>
                      </td>
                    );
                  return (
                    <td key={c} className={stick}>
                      <button
                        className={`gc${cell.formula ? " formula" : ""}${st ? ` ${st}` : ""}${cell.edited ? " edited" : ""}${selected === k ? " sel" : ""}`}
                        onClick={() => onSelect(k)}
                        title={`${ref}${cell.label ? `: ${cell.label}` : ""}${cell.formula ? ` ${cell.formula}` : ""}`}
                        aria-pressed={selected === k}
                      >
                        {/* Header-row integers are labels such as years: no thousands separator. */}
                        {r === 1 && !cell.formula && !cell.format && Number.isInteger(cell.value) ? String(cell.value) : cellText(cell)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: "rgba(141,255,98,0.6)" }} />
          Found on its page
        </span>
        <span>
          <i style={{ background: "var(--lavender)" }} />
          Read from a chart
        </span>
        {scans && (
          <span>
            <i style={{ background: "var(--scan)" }} />
            Matches a scanned page (the model&apos;s reading, not PDF text)
          </span>
        )}
        <span>
          <i style={{ background: "var(--maybe)" }} />
          Check
        </span>
        <span>
          <i style={{ background: "var(--bad)" }} />
          Problem
        </span>
        <span>
          <i style={{ background: "none", border: "1px solid var(--lavender)" }} />
          Formula
        </span>
        {cells.some((c) => c.edited) && (
          <span>
            <i className="edited-dot" />
            Edited by you
          </span>
        )}
      </div>
    </div>
  );
}

export type EditInput = { value?: string; formula?: string; source?: { doc?: DocKey; page: number; quote?: string } | null };

type DetailProps = {
  cell: CheckedCell;
  docs: { key: DocKey; name: string; pages: number }[];
  editable: boolean;
  modelVersion?: CheckedCell | null; // set when the cell was edited: what the model wrote
  onSave: (e: EditInput) => Promise<string | null>; // returns an error message or null
  onReset: () => Promise<string | null>;
};

export function CellDetail({ cell, docs, editable, modelVersion, onSave, onReset }: DetailProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const two = docs.length > 1;
  const isInput = !cell.formula && typeof cell.value === "number";
  const [form, setForm] = useState(() => formOf(cell));

  function formOf(c: CheckedCell) {
    return {
      kind: c.formula ? "formula" : "value",
      value: c.formula ? "" : c.format === "percent" && typeof c.value === "number" ? String(+(c.value * 100).toPrecision(10)) + "%" : String(c.value ?? ""),
      formula: c.formula ?? "",
      doc: (c.source?.doc ?? "A") as DocKey,
      page: c.source?.page ? String(c.source.page) : "",
      quote: c.source?.quote ?? "",
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    const page = Number(form.page);
    const err = await onSave({
      ...(form.kind === "formula" ? { formula: form.formula } : { value: form.value }),
      source: form.page ? { ...(two ? { doc: form.doc } : {}), page, quote: form.quote } : null,
    });
    setBusy(false);
    if (err) setError(err);
    else setEditing(false);
  }

  async function reset() {
    setBusy(true);
    setError(null);
    const err = await onReset();
    setBusy(false);
    if (err) setError(err);
    else setEditing(false);
  }

  const docName = (k: DocKey | undefined) => (two ? `${k ?? "A"}, ` : "");

  return (
    <div className="detail" aria-live="polite">
      <div className="spread">
        <span className="label">{cell.label || `${cell.sheet}!${cell.ref}`}</span>
        <span className="faint caption">
          {cell.sheet}!{cell.ref} · {cell.edited ? <span className="badge edited">Edited by you</span> : `written in step ${cell.step}`}
        </span>
      </div>
      {!editing && (
        <>
          <div className="val">{cell.formula ? `${cell.formula}  →  ${cellText(cell)}` : cellText(cell)}</div>
          {cell.source?.quote && <p className="quote">“{cell.source.quote}”</p>}
          {cell.source && (
            <p className="faint small" style={{ margin: 0 }}>
              {docName(cell.source.doc)}page {cell.source.page}
              {!cell.source.quote && !cell.formula ? (cell.source.box ? ", read from the marked region" : "") : ""}
            </p>
          )}
          {cell.checks.length > 0 ? (
            <ul className="checks">
              {cell.checks.map((k, i) => (
                <li key={i}>
                  <span className={`ic-${k.status}`}>
                    <Icon name={ICON[k.status]} size={14} />
                  </span>
                  {k.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint small" style={{ margin: 0 }}>Checks run when the model finishes.</p>
          )}
          {cell.edited && modelVersion !== undefined && (
            <p className="faint small" style={{ margin: 0 }}>
              The model wrote: {modelVersion ? (modelVersion.formula ?? fmtValue(modelVersion.value, modelVersion.format)) : "nothing here"}
              {modelVersion?.source ? `, ${docName(modelVersion.source.doc)}page ${modelVersion.source.page}` : ""}.
            </p>
          )}
          {editable && (
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  setForm(formOf(cell));
                  setEditing(true);
                }}
              >
                <Icon name="pencil" size={14} /> Edit
              </button>
              {cell.edited && (
                <button className="btn" onClick={reset} disabled={busy}>
                  <Icon name="undo" size={14} /> Reset to the model&apos;s version
                </button>
              )}
            </div>
          )}
        </>
      )}
      {editing && (
        <form
          className="edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="seg" role="radiogroup" aria-label="Cell content">
            {(["value", "formula"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} className="sheet-tab" aria-selected={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>
                {k === "value" ? "Value" : "Formula"}
              </button>
            ))}
          </div>
          {form.kind === "value" ? (
            <label className="field">
              <span>Value{isInput && cell.format === "percent" ? " (type 2.4% or 0.024)" : ""}</span>
              <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} inputMode="decimal" />
            </label>
          ) : (
            <label className="field">
              <span>Formula</span>
              <input value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} placeholder="=C4/B4-1" spellCheck={false} />
            </label>
          )}
          <div className="edit-row">
            {two && (
              <label className="field">
                <span>Document</span>
                <select value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value as DocKey })}>
                  {docs.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.key}: {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field narrow">
              <span>Page</span>
              <input value={form.page} onChange={(e) => setForm({ ...form, page: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" placeholder="none" />
            </label>
          </div>
          <label className="field">
            <span>Quote from the page (contains the number)</span>
            <input value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} spellCheck={false} />
          </label>
          {error && (
            <p className="error-box small" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Checking…" : "Save and recheck"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          <p className="faint caption" style={{ margin: 0 }}>
            Saving reruns Footnote&apos;s checks and every formula in the workbook. The model is not called.
          </p>
        </form>
      )}
    </div>
  );
}
