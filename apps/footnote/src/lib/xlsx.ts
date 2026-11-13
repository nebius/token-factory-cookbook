import ExcelJS from "exceljs";
import type { CheckedCell, CheckedClaim, DocKey } from "@/lib/book";
import { parseRef } from "@/lib/formula";
import type { Edit } from "@/lib/runs";

// The deliverable: the model's sheets with live formulas (and their recomputed results cached, so
// the file shows numbers before Excel recalculates), a note on every sourced cell, a Sources sheet
// that names the document and says where each page's text came from, and a Claims sheet.

const FORMATS: Record<string, string> = {
  number: "#,##0.00",
  percent: "0.0%",
  currency: "$#,##0.00",
};

const verdictText = { supported: "Supported", contradicted: "Contradicted", not_checkable: "Not checkable" } as const;

type Opts = {
  title: string;
  docs: { A: string; B?: string };
  scanned?: { A: number[]; B: number[] };
  cells: CheckedCell[];
  claims: CheckedClaim[];
  model: string;
  edits?: Edit[];
};

export async function buildXlsx(o: Opts): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Footnote";
  wb.created = new Date();
  wb.title = o.title;
  const two = !!o.docs.B;
  const docOf = (d: DocKey | undefined) => (d === "B" ? "B" : "A");
  const isScan = (d: DocKey | undefined, page: number | undefined) => !!page && (o.scanned?.[docOf(d)] ?? []).includes(page);

  const sheets = [...new Set(o.cells.map((c) => c.sheet))];
  for (const name of sheets) {
    const ws = wb.addWorksheet(safeName(name));
    const cells = o.cells.filter((c) => c.sheet === name);
    const widths = new Map<number, number>();
    for (const c of cells) {
      const cell = ws.getCell(c.ref);
      if (c.formula) cell.value = { formula: c.formula.replace(/^=/, ""), result: c.result };
      else if (c.value !== undefined) cell.value = c.value;
      if (c.format && FORMATS[c.format]) cell.numFmt = FORMATS[c.format];
      if (typeof c.value === "string" && /^[A-Z]1$/.test(c.ref)) cell.font = { bold: true };
      const notes: string[] = [];
      if (c.source) {
        notes.push(`${two ? `Document ${docOf(c.source.doc)}, page` : "Page"} ${c.source.page}${c.source.quote ? `: “${c.source.quote}”` : ""}`);
        if (isScan(c.source.doc, c.source.page)) notes.push("Scanned page: checked against the model's transcription of the image, not PDF text.");
      }
      if (c.edited) notes.push("Edited by you on the Footnote run page.");
      if (notes.length) cell.note = notes.join("\n");
      const col = parseRef(c.ref).col;
      const len = String(c.formula ? (c.result ?? "") : (c.value ?? "")).length;
      widths.set(col, Math.max(widths.get(col) ?? 10, Math.min(60, len + 2)));
    }
    for (const [col, w] of widths) ws.getColumn(col).width = w;
  }

  const src = wb.addWorksheet("Sources");
  src.columns = [
    { header: "Sheet", key: "sheet", width: 14 },
    { header: "Cell", key: "ref", width: 8 },
    { header: "Label", key: "label", width: 36 },
    { header: "Value", key: "value", width: 14 },
    { header: "Formula", key: "formula", width: 24 },
    { header: "Document", key: "doc", width: 40 },
    { header: "Page", key: "page", width: 7 },
    { header: "Text source", key: "origin", width: 30 },
    { header: "Quote", key: "quote", width: 60 },
    { header: "Check", key: "check", width: 48 },
    { header: "Edited", key: "edited", width: 9 },
  ];
  for (const c of o.cells) {
    if (typeof c.value === "string" && !c.formula) continue;
    const d = docOf(c.source?.doc);
    src.addRow({
      sheet: c.sheet,
      ref: c.ref,
      label: c.label ?? "",
      value: c.formula ? c.result : c.value,
      formula: c.formula ?? "",
      doc: c.source ? `${two ? `${d}: ` : ""}${o.docs[d] ?? ""}` : "",
      page: c.source?.page ?? "",
      origin: !c.source ? "" : c.source.box && !c.source.quote ? "Read from a chart" : isScan(c.source.doc, c.source.page) ? "Model transcription of a scanned page" : "PDF text",
      quote: c.source?.quote ?? "",
      check: c.checks.map((k) => `${k.status === "scan" ? "scanned page" : k.status}: ${k.message}`).join("; "),
      edited: c.edited ? "Yes" : "",
    });
  }
  src.getRow(1).font = { bold: true };

  const cl = wb.addWorksheet("Claims");
  cl.columns = [
    { header: "Claim", key: "claim", width: 70 },
    ...(two ? [{ header: "Document", key: "doc", width: 10 }] : []),
    { header: "Page", key: "page", width: 7 },
    { header: "Verdict", key: "verdict", width: 15 },
    { header: "Evidence", key: "evidence", width: 60 },
    { header: "Gap", key: "gap", width: 30 },
    { header: "Python", key: "python", width: 60 },
  ];
  for (const c of o.claims) cl.addRow({ claim: c.claim, doc: docOf(c.at?.doc ?? c.doc), page: c.at?.page ?? c.page, verdict: verdictText[c.verdict], evidence: c.evidence, gap: c.gap ?? "", python: c.python ?? "" });
  cl.getRow(1).font = { bold: true };

  const about = wb.addWorksheet("About");
  const rows: string[][] = [["Built by Footnote from"], [two ? `A: ${o.docs.A}` : o.docs.A]];
  if (two) rows.push([`B: ${o.docs.B}`]);
  rows.push([""], ["Model"], [o.model], [""], ["Every input cell carries a note with its page. The Sources sheet lists each check and where the page's text came from."]);
  const scans = (["A", "B"] as const).filter((k) => o.scanned?.[k]?.length);
  if (scans.length) rows.push([""], [`Scanned pages, read by the model from the image: ${scans.map((k) => `${two ? `${k} ` : ""}${o.scanned![k].join(", ")}`).join("; ")}.`]);
  if (o.edits?.length) rows.push([""], [`${o.edits.length} hand edit${o.edits.length === 1 ? "" : "s"} on the run page; edited cells are marked in the Sources sheet.`]);
  about.addRows(rows);
  about.getColumn(1).width = 100;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function safeName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
}
