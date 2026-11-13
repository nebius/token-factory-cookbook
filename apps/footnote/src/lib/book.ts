import { evaluate, FormulaError, parseRef, references } from "@/lib/formula";
import { boxesFor, boxFor, findQuote, matchValue, tokens, type Token } from "@/lib/numbers";
import type { Box, PageText } from "@/lib/pdf";

// The spreadsheet the agent builds, cell by cell, and the deterministic checks run on it.

export type DocKey = "A" | "B";

// doc is "A" (the only document, or the first of two) or "B" (the second, when comparing).
export type Source = { doc?: DocKey; page: number; quote?: string; box?: Box };

export type Format = "number" | "percent" | "currency" | "text";

export type Cell = {
  sheet: string;
  ref: string; // "B4"
  label?: string;
  value?: number | string;
  formula?: string; // "=B3/B2-1"
  format?: Format;
  source?: Source;
  step: number; // agent step that wrote it
  edited?: boolean; // changed by hand on the run page
};

export type Claim = {
  id: string;
  claim: string;
  page: number;
  doc?: DocKey;
  verdict: "supported" | "contradicted" | "not_checkable";
  evidence: string;
  python?: string;
  gap?: string;
  step: number;
};

// ok: found in the PDF's own text. scan: found in the model's transcription of a scanned page, which
// is weaker evidence and always shown as such. info: read from a chart. warn and fail: to check.
export type Status = "ok" | "scan" | "warn" | "fail" | "info";

export type CellCheck = { status: Status; message: string };

export type CheckedCell = Cell & {
  result?: number; // recomputed formula value
  checks: CellCheck[];
  // Where to highlight: the cited page, and a box when the number or quote was found there.
  at?: Place;
};

export type Place = { doc: DocKey; page: number; box?: Box; lines?: Box[] };

export type CheckedClaim = Claim & { at: Place; quoted: boolean };

// matched counts numbers found in PDF text; matchedScan those found only in a model transcription.
export type Summary = { inputs: number; sourced: number; matched: number; matchedScan?: number; formulas: number; recomputed: number; failures: number; warnings: number; edited?: number };

export type Docs = { A: PageText[]; B?: PageText[] };

export function key(sheet: string, ref: string) {
  return `${sheet}!${ref.toUpperCase()}`;
}

export class Book {
  cells = new Map<string, Cell>();
  claims: Claim[] = [];
  sheets: string[] = [];

  write(cell: Cell) {
    const ref = cell.ref.toUpperCase().replace(/\$/g, "");
    parseRef(ref);
    if (!this.sheets.includes(cell.sheet)) this.sheets.push(cell.sheet);
    this.cells.set(key(cell.sheet, ref), { ...cell, ref });
  }

  // Value of a cell for formulas: inputs as written, formulas recomputed. Cycles are an error.
  valueOf(sheet: string, ref: string, seen = new Set<string>()): number | null {
    const k = key(sheet, ref);
    const c = this.cells.get(k);
    if (!c) return null;
    if (c.formula) {
      if (seen.has(k)) throw new FormulaError(`Circular reference through ${k}`);
      seen.add(k);
      const v = evaluate(c.formula, (s, r) => this.valueOf(s ?? sheet, r, seen));
      seen.delete(k);
      return v;
    }
    return typeof c.value === "number" ? c.value : null;
  }

  static from(cells: Cell[], claims: Claim[]) {
    const b = new Book();
    for (const c of cells) b.write(c);
    b.claims = claims;
    return b;
  }

  list(): Cell[] {
    return [...this.cells.values()];
  }
}

function tokenCache() {
  const cache = new Map<string, Token[]>();
  return (doc: DocKey, page: PageText | undefined) => {
    const k = `${doc}:${page?.n}`;
    if (!cache.has(k)) cache.set(k, tokens(page?.text ?? ""));
    return cache.get(k)!;
  };
}

const fmtNum = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+v.toPrecision(6)));

export function check(book: Book, input: PageText[] | Docs): { cells: CheckedCell[]; claims: CheckedClaim[]; summary: Summary } {
  const docs: Docs = Array.isArray(input) ? { A: input } : input;
  const two = !!docs.B;
  const pagesOf = (d: DocKey | undefined) => (d === "B" ? docs.B : docs.A);
  // "page 4", or "page 4 of B" when there are two documents.
  const where = (d: DocKey, n: number) => (two ? `page ${n} of ${d}` : `page ${n}`);
  const toksOf = tokenCache();
  const out: CheckedCell[] = [];

  for (const c of book.list()) {
    const checks: CellCheck[] = [];
    let at: CheckedCell["at"];
    let result: number | undefined;
    const d: DocKey = c.source?.doc === "B" ? "B" : "A";
    const pages = pagesOf(d);

    if (c.formula) {
      try {
        result = book.valueOf(c.sheet, c.ref) ?? undefined;
        const empty = references(c.formula, c.sheet).filter((r) => !book.cells.has(r));
        if (empty.length) checks.push({ status: "warn", message: `Reads empty ${empty.length === 1 ? "cell" : "cells"} ${empty.slice(0, 4).join(", ")}${empty.length > 4 ? "…" : ""}` });
        checks.push({ status: "ok", message: `Recomputed: ${fmtNum(result ?? 0)}` });
      } catch (e) {
        checks.push({ status: "fail", message: e instanceof Error ? e.message : String(e) });
      }
      if (c.source && pages) {
        at = { doc: d, page: c.source.page, box: c.source.box };
        // A formula can cite the line it reproduces; mark that line too.
        const page = pages[c.source.page - 1];
        const hit = page && c.source.quote ? findQuote(page, c.source.quote) : null;
        if (page && hit) {
          at.lines = boxesFor(page, hit.start, hit.end);
          at.box = at.lines[0] ?? at.box;
        }
      }
    } else if (typeof c.value === "number") {
      const src = c.source;
      if (!src || !(src.page >= 1)) {
        checks.push({ status: "fail", message: "No source page" });
      } else if (!pages) {
        checks.push({ status: "fail", message: `Cites document ${d}, but this run has one document` });
      } else if (src.page > pages.length) {
        checks.push({ status: "fail", message: `Cites ${where(d, src.page)}, but the document has ${pages.length} pages` });
      } else {
        const page = pages[src.page - 1];
        const scanned = page.origin === "model";
        const toks = toksOf(d, page);
        at = { doc: d, page: src.page, box: src.box };
        let quoteHit: { start: number; end: number } | null = null;
        if (src.quote) {
          quoteHit = findQuote(page, src.quote);
          if (quoteHit) {
            at.lines = boxesFor(page, quoteHit.start, quoteHit.end);
            at.box = at.lines[0] ?? at.box;
          } else checks.push({ status: "warn", message: `Quote not found on ${where(d, src.page)}${scanned ? " (in the model's transcription of the scan)" : ""}` });
        }
        const inQuote = quoteHit ? toks.filter((t) => t.start >= quoteHit!.start && t.end <= quoteHit!.end) : [];
        const pct = c.format === "percent";
        const inQuoteMatch = matchValue(c.value, inQuote, pct);
        const m = inQuoteMatch ?? matchValue(c.value, toks, pct);
        const how = (x: NonNullable<typeof m>) => (x.how === "exact" ? "" : x.how === "rounded" ? " (rounded)" : x.how === "percent" ? " (as a fraction)" : ` (scaled ×${x.scale})`);
        if (!src.quote && src.box) {
          // The model says it read this off a chart: printed tick labels nearby prove nothing.
          checks.push({ status: "info", message: `Read from a chart on ${where(d, src.page)} (region marked); not a printed number` });
        } else if (quoteHit && !inQuoteMatch) {
          // The quote is on the page but does not contain the number: the citation points at the wrong line.
          if (m) at.box = boxFor(page, m.token.start, m.token.end) ?? at.box;
          checks.push({ status: "warn", message: m ? `Quote found, but ${fmtNum(c.value)} is not in it; “${m.token.raw}” appears elsewhere on ${where(d, src.page)}` : `Quote found on ${where(d, src.page)}, but ${fmtNum(c.value)} is not in it` });
        } else if (m) {
          at.box = boxFor(page, m.token.start, m.token.end) ?? at.box;
          if (m.how === "scaled") checks.push({ status: "warn", message: `Matches “${m.token.raw}” on ${where(d, src.page)}${how(m)}` });
          else if (scanned) {
            // Never the same green as PDF text: this is the model agreeing with its own reading of an image.
            const ocr = page.fileText ? (tokens(page.fileText).some((t) => t.value === m.token.value) ? "; the file's own OCR layer agrees" : "; the file's own OCR layer does not show it") : "";
            checks.push({ status: "scan", message: `Matches “${m.token.raw}” in the model's transcription of scanned ${where(d, src.page)}${how(m)}${ocr}` });
          } else checks.push({ status: "ok", message: `Matches “${m.token.raw}” on ${where(d, src.page)}${how(m)}` });
        } else {
          const elsewhere = pages.find((p) => p.n !== src.page && matchValue(c.value as number, toksOf(d, p))?.how === "exact");
          if (elsewhere) checks.push({ status: "warn", message: `Not on ${where(d, src.page)}; printed on ${where(d, elsewhere.n)}` });
          else if (page.figures && !scanned) checks.push({ status: "info", message: `Not in the text of ${where(d, src.page)}; read from a chart or image` });
          else checks.push({ status: "fail", message: scanned ? `Not found in the model's transcription of scanned ${where(d, src.page)}` : `Not found in the text of ${where(d, src.page)}` });
        }
      }
    }
    out.push({ ...c, result, checks, at });
  }

  // Totals: an input labelled "total" should equal the inputs directly above it in the same column.
  const byKey = new Map(out.map((c) => [key(c.sheet, c.ref), c]));
  for (const c of out) {
    if (c.formula || typeof c.value !== "number" || !/\btotal\b/i.test(c.label ?? "")) continue;
    const r = parseRef(c.ref);
    const col = c.ref.match(/^[A-Z]+/)![0];
    const parts: number[] = [];
    for (let row = r.row - 1; row >= 1; row--) {
      const above = byKey.get(key(c.sheet, `${col}${row}`));
      if (!above || /\btotal\b/i.test(above.label ?? "")) break;
      const v = above.formula ? above.result : typeof above.value === "number" ? above.value : undefined;
      if (v === undefined) break;
      parts.push(v);
    }
    if (parts.length < 2) continue;
    const sum = parts.reduce((a, b) => a + b, 0);
    const tol = Math.max(Math.abs(c.value) * 0.005, 0.51 * parts.length * (Number.isInteger(c.value) ? 1 : 0.1));
    c.checks.push(
      Math.abs(sum - c.value) <= tol
        ? { status: "ok", message: `Total matches the ${parts.length} rows above (${fmtNum(sum)})` }
        : { status: "fail", message: `The ${parts.length} rows above add up to ${fmtNum(sum)}, not ${fmtNum(c.value)}` },
    );
  }

  const claims: CheckedClaim[] = book.claims.map((cl) => {
    // The claim as printed, else its first sentence or clause; on the cited page first, then any page
    // of the cited document, then the other document.
    const whole = cl.claim.trim().replace(/[.;:,]+$/, "");
    // Sentence ends: "2014. U.S." splits, the dots inside "U.S." do not.
    const first = whole.split(/(?<=[a-z0-9%)]{2})[.;] (?=[A-Z])/)[0].replace(/[.;:,]+$/, "");
    const d: DocKey = cl.doc === "B" && docs.B ? "B" : "A";
    const own = pagesOf(d) ?? [];
    const other: [DocKey, PageText[]][] = two ? [[d === "A" ? "B" : "A", pagesOf(d === "A" ? "B" : "A") ?? []]] : [];
    const order: [DocKey, PageText][] = [
      ...[own[cl.page - 1], ...own.filter((p) => p.n !== cl.page)].filter(Boolean).map((p) => [d, p] as [DocKey, PageText]),
      ...other.flatMap(([k, ps]) => ps.map((p) => [k, p] as [DocKey, PageText])),
    ];
    for (const [text, quoted] of [
      [whole, true],
      [first, false],
    ] as const) {
      if (text.length < 12) continue;
      for (const [k, p] of order) {
        const hit = findQuote(p, text);
        if (hit) {
          const lines = boxesFor(p, hit.start, hit.end);
          return { ...cl, quoted, at: { doc: k, page: p.n, box: lines[0], lines } };
        }
      }
    }
    return { ...cl, quoted: false, at: { doc: d, page: cl.page } };
  });

  const inputs = out.filter((c) => !c.formula && typeof c.value === "number");
  const formulas = out.filter((c) => c.formula);
  const summary: Summary = {
    inputs: inputs.length,
    sourced: inputs.filter((c) => c.source && c.source.page >= 1 && c.source.page <= (pagesOf(c.source.doc)?.length ?? 0)).length,
    matched: inputs.filter((c) => c.checks.some((k) => k.status === "ok" && k.message.startsWith("Matches"))).length,
    matchedScan: inputs.filter((c) => c.checks.some((k) => k.status === "scan")).length,
    formulas: formulas.length,
    recomputed: formulas.filter((c) => c.result !== undefined && !c.checks.some((k) => k.status === "fail")).length,
    failures: out.reduce((n, c) => n + c.checks.filter((k) => k.status === "fail").length, 0),
    warnings: out.reduce((n, c) => n + c.checks.filter((k) => k.status === "warn").length, 0),
    edited: out.filter((c) => c.edited).length,
  };
  return { cells: out, claims, summary };
}
