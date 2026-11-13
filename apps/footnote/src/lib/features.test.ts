import ExcelJS from "exceljs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { firstMessage, runTool, systemPrompt } from "@/lib/agent/agent";
import { parseArgs, toolDefs, ViewPage } from "@/lib/agent/tools";
import { Book, check, type Cell } from "@/lib/book";
import { applyEdit } from "@/lib/edits";
import { findQuote } from "@/lib/numbers";
import { imageCover, pageKind, type PageText } from "@/lib/pdf";
import type { Run } from "@/lib/runs";
import { clampBox, parseTranscription, toPageText } from "@/lib/transcribe";
import { buildXlsx } from "@/lib/xlsx";

function page(n: number, text: string, extra: Partial<PageText> = {}): PageText {
  const words = text.split(" ");
  let x = 0;
  const runs = words.map((s) => {
    const r = { s, box: [x, 0.1, s.length * 0.01, 0.02] as [number, number, number, number] };
    x += (s.length + 1) * 0.01;
    return r;
  });
  return { n, width: 612, height: 792, text: words.join(" "), runs, figures: false, ...extra };
}

const O = pdfjs.OPS;
const pageArea = 612 * 792;
const fullImage = { fnArray: [O.save, O.transform, O.paintImageXObject, O.restore], argsArray: [[], [612, 0, 0, 792, 0, 0], ["img", 2550, 3300], []] };

describe("scanned pages", () => {
  it("tells born-digital, scanned and OCR'd scan pages apart", () => {
    expect(imageCover(fullImage, pageArea).cover).toBeCloseTo(1, 5);
    expect(pageKind(fullImage, "", pageArea)).toBe("scanned");
    const ocr = { fnArray: [...fullImage.fnArray, O.setTextRenderingMode], argsArray: [...fullImage.argsArray, [3]] };
    expect(pageKind(ocr, "U. S. DEPARTMENT OF LABOR Bureau of Labor Statistics Washington, D. C. 20212 employment rose", pageArea)).toBe("ocr");
    const logo = { fnArray: [O.save, O.transform, O.paintImageXObject, O.restore], argsArray: [[], [60, 0, 0, 40, 500, 700], ["logo", 120, 80], []] };
    expect(pageKind(logo, "A born-digital page of text with a small logo in the corner and plenty of words", pageArea)).toBe("text");
    // A cover photo behind real text stays a text page.
    expect(pageKind(fullImage, "Short-Term Energy Outlook, November 2026, with a cover photograph", pageArea)).toBe("text");
  });

  it("parses a transcription from a tool call or from JSON in the text", () => {
    const viaTool = parseTranscription({ text: "", toolCalls: [{ id: "1", name: "submit_page_text", arguments: '{"lines":[{"text":"Total 1,234","box":[0.1,0.2,0.3,0.02]}],"figure":false}' }] });
    expect(viaTool?.lines[0].text).toBe("Total 1,234");
    const viaText = parseTranscription({ text: 'Here it is: {"lines":[{"text":"Unemployment rate 8.3"},],}', toolCalls: [] });
    expect(viaText?.lines).toHaveLength(1);
    expect(parseTranscription({ text: "I cannot read this page.", toolCalls: [] })).toBeNull();
  });

  it("scales boxes given in percent or in pixels of the image sent", () => {
    expect(clampBox([0.1, 0.2, 0.3, 0.05])).toEqual([0.1, 0.2, 0.3, 0.05]);
    expect(clampBox([10, 20, 30, 5])!.map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3, 0.05]);
    expect(clampBox([140, 362, 420, 36], { width: 1400, height: 1812 })!.map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3, 0.02]);
  });

  it("stores the model's reading as the page's text layer, marked as such, keeping the file's OCR", () => {
    const base = page(1, "BUREAU OF LABH STATISTICS 8.3", { kind: "ocr", origin: "pdf" });
    const p = toPageText(base, { lines: [{ text: "Bureau of Labor Statistics", box: [0.1, 0.1, 0.5, 0.02] }, { text: "Unemployment rate  8.3  8.6", box: null }], figure: false });
    expect(p.origin).toBe("model");
    expect(p.text).toBe("Bureau of Labor Statistics Unemployment rate 8.3 8.6");
    expect(p.fileText).toBe("BUREAU OF LABH STATISTICS 8.3");
    expect(p.runs[1].box[2]).toBeGreaterThan(0);
  });

  it("checks against a transcription with its own status, never the PDF-text one", () => {
    const scanned = { ...page(1, "Unemployment rate 8.3 8.6 Total 1,234"), origin: "model" as const, fileText: "Unemployment rate 8.3 8.6 Total 1,284" };
    const book = Book.from(
      [
        { sheet: "S", ref: "B2", label: "Rate", value: 8.6, source: { page: 1, quote: "Unemployment rate 8.3 8.6" }, step: 1 },
        { sheet: "S", ref: "B3", label: "Total", value: 1234, source: { page: 1 }, step: 1 },
        { sheet: "S", ref: "B4", label: "Missing", value: 99, source: { page: 1 }, step: 1 },
      ],
      [],
    );
    const { cells, summary } = check(book, [scanned]);
    const at = (r: string) => cells.find((c) => c.ref === r)!.checks;
    expect(at("B2")[0]).toMatchObject({ status: "scan", message: expect.stringMatching(/model's transcription of scanned page 1; the file's own OCR layer agrees/) });
    expect(at("B3")[0].message).toMatch(/OCR layer does not show it/);
    expect(at("B4")[0]).toMatchObject({ status: "fail", message: expect.stringMatching(/transcription/) });
    expect(summary).toMatchObject({ matched: 0, matchedScan: 2 });
  });

  it("notes scanned pages in the workbook's Sources sheet and cell notes", async () => {
    const scanned = { ...page(1, "Rate 8.6"), origin: "model" as const };
    const { cells, claims } = check(Book.from([{ sheet: "S", ref: "B2", label: "Rate", value: 8.6, source: { page: 1, quote: "Rate 8.6" }, step: 1 }], []), [scanned]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildXlsx({ title: "t", docs: { A: "Scan" }, scanned: { A: [1], B: [] }, cells, claims, model: "m" })) as never);
    const src = wb.getWorksheet("Sources")!;
    const headers = (src.getRow(1).values as string[]).filter(Boolean);
    expect(src.getRow(2).getCell(headers.indexOf("Text source") + 1).value).toBe("Model transcription of a scanned page");
    expect(String(wb.getWorksheet("S")!.getCell("B2").note)).toMatch(/Scanned page/);
  });
});

describe("comparing two documents", () => {
  const A = [page(1, "Real GDP 2026 median 2.4 March projection"), page(2, "Unemployment 4.4")];
  const B = [page(1, "Real GDP 2026 median 2.2 March projection 2.4"), page(2, "PCE inflation was revised up to 3.6 from 2.7")];

  it("checks each cell against the document it cites", () => {
    const cells: Cell[] = [
      { sheet: "Comparison", ref: "B2", label: "GDP 2026, A", value: 2.4, source: { doc: "A", page: 1 }, step: 1 },
      { sheet: "Comparison", ref: "C2", label: "GDP 2026, B", value: 2.2, source: { doc: "B", page: 1 }, step: 1 },
      { sheet: "Comparison", ref: "D2", label: "Change", formula: "=C2-B2", step: 1 },
      { sheet: "Comparison", ref: "C3", label: "Wrong document", value: 4.4, source: { doc: "B", page: 2 }, step: 1 },
    ];
    const r = check(Book.from(cells, [{ id: "c1", claim: "PCE inflation was revised up to 3.6 from 2.7", doc: "B", page: 2, verdict: "supported", evidence: "", step: 2 }]), { A, B });
    const at = (ref: string) => r.cells.find((c) => c.ref === ref)!;
    expect(at("B2").checks[0].message).toBe("Matches “2.4” on page 1 of A");
    expect(at("C2").at).toMatchObject({ doc: "B", page: 1 });
    expect(at("D2").result).toBeCloseTo(-0.2, 10);
    expect(at("C3").checks[0].status).toBe("fail");
    expect(r.claims[0].at).toMatchObject({ doc: "B", page: 2 });
    // One document: citing B is an error, not a silent fallback.
    expect(check(Book.from([cells[1]], []), A).cells[0].checks[0].message).toMatch(/Cites document B/);
  });

  it("gives the model both outlines and the doc argument on every page tool", () => {
    const run = { doc: { name: "SEP March", pages: 2, sizes: [], hash: "a" }, docB: { name: "SEP June", pages: 2, sizes: [], hash: "b" }, options: { python: true, focus: "Compare" } } as unknown as Run;
    const msg = firstMessage(run, { A, B });
    expect(msg).toContain("Document A: SEP March");
    expect(msg).toContain("Pages of B:");
    expect(systemPrompt(true, true)).toContain("sheet named Comparison");
    const view = toolDefs(true, true).find((t) => t.function.name === "view_page")!.function.parameters as { required: string[] };
    expect(view.required).toEqual(["doc", "page"]);
    expect((toolDefs(true, false).find((t) => t.function.name === "view_page")!.function.parameters as { required: string[] }).required).toEqual(["page"]);
    expect(parseArgs(ViewPage, '{"doc":"B","page":2}').ok).toBe(true);
    expect(parseArgs(ViewPage, '{"doc":"C","page":2}').ok).toBe(false);
  });

  it("searches both documents and labels each hit", async () => {
    const ctx = { run: {} as Run, docs: { A, B }, book: new Book(), n: 1, images: [], python: true };
    const out = await runTool("search_pages", '{"query":"March projection"}', ctx);
    expect(out.output).toContain("A p1:");
    expect(out.output).toContain("B p1:");
    const one = await runTool("search_pages", '{"query":"revised up","doc":"B"}', ctx);
    expect(one.output).toContain("B p2:");
    const single = await runTool("view_page", '{"doc":"B","page":1}', { ...ctx, docs: { A } });
    expect(single.output).toMatch(/one document/);
  });

  it("names the document in the workbook", async () => {
    const r = check(Book.from([{ sheet: "Comparison", ref: "C2", label: "GDP, B", value: 2.2, source: { doc: "B", page: 1 }, step: 1 }], []), { A, B });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildXlsx({ title: "t", docs: { A: "SEP March", B: "SEP June" }, cells: r.cells, claims: r.claims, model: "m" })) as never);
    const src = wb.getWorksheet("Sources")!;
    const headers = (src.getRow(1).values as string[]).filter(Boolean);
    expect(src.getRow(2).getCell(headers.indexOf("Document") + 1).value).toBe("B: SEP June");
    expect(String(wb.getWorksheet("Comparison")!.getCell("C2").note)).toMatch(/^Document B, page 1/);
  });
});

describe("editing a cell and rechecking", () => {
  const pages = [page(1, "Brent $69 $97 $86 Henry Hub 3.53 Growth 2.4%")];
  const fresh = (): Run =>
    ({
      id: "x",
      status: "done",
      doc: { name: "EIA", pages: 1, sizes: [], hash: "h" },
      cells: [
        { sheet: "S", ref: "B2", label: "Brent 2025", value: 68, source: { page: 1, quote: "Brent $69" }, step: 3 },
        { sheet: "S", ref: "C2", label: "Brent 2026", value: 97, source: { page: 1 }, step: 3 },
        { sheet: "S", ref: "D2", label: "Change", formula: "=C2-B2", step: 3 },
        { sheet: "S", ref: "B3", label: "Growth", value: 0.024, format: "percent", source: { page: 1 }, step: 3 },
      ],
      claims: [],
    }) as unknown as Run;

  it("fixes a wrong number, rechecks deterministically and keeps the history", () => {
    const run = fresh();
    expect(check(Book.from(run.cells, []), pages).cells.find((c) => c.ref === "B2")!.checks.some((k) => k.status === "warn" || k.status === "fail")).toBe(true);
    const r = applyEdit(run, { action: "edit", sheet: "S", ref: "B2", value: "69", source: { page: 1, quote: "Brent $69" } }, new Date("2026-11-13T10:00:00Z"));
    expect(r.ok).toBe(true);
    const after = check(Book.from(run.cells, []), pages);
    const b2 = after.cells.find((c) => c.ref === "B2")!;
    expect(b2).toMatchObject({ value: 69, edited: true });
    expect(b2.checks[0].status).toBe("ok");
    expect(after.cells.find((c) => c.ref === "D2")!.result).toBe(28);
    expect(after.summary.edited).toBe(1);
    expect(run.edits).toHaveLength(1);
    expect(run.edits![0]).toMatchObject({ kind: "edit", before: { value: 68 }, after: { value: 69 } });
    expect(run.original!["S!B2"]).toMatchObject({ value: 68 });
  });

  it("resets to the model's version, even after several edits", () => {
    const run = fresh();
    applyEdit(run, { action: "edit", sheet: "S", ref: "B2", value: 69, source: { page: 1 } });
    applyEdit(run, { action: "edit", sheet: "S", ref: "B2", formula: "C2-28", source: null });
    expect(run.cells.find((c) => c.ref === "B2")).toMatchObject({ formula: "=C2-28", edited: true });
    expect(applyEdit(run, { action: "reset", sheet: "S", ref: "B2" }).ok).toBe(true);
    expect(run.cells.find((c) => c.ref === "B2")).toMatchObject({ value: 68, source: { quote: "Brent $69" } });
    expect(run.cells.find((c) => c.ref === "B2")!.edited).toBeUndefined();
    expect(run.edits!.map((e) => e.kind)).toEqual(["edit", "edit", "reset"]);
    expect(applyEdit(run, { action: "reset", sheet: "S", ref: "B2" }).ok).toBe(false);
  });

  it("reads typed percentages and rejects bad formulas, pages and documents", () => {
    const run = fresh();
    applyEdit(run, { action: "edit", sheet: "S", ref: "B3", value: "2.4%", source: { page: 1 } });
    expect(run.cells.find((c) => c.ref === "B3")!.value).toBeCloseTo(0.024, 10);
    expect(applyEdit(run, { action: "edit", sheet: "S", ref: "D2", formula: "=C2-" })).toMatchObject({ ok: false });
    expect(applyEdit(run, { action: "edit", sheet: "S", ref: "C2", value: 97, source: { page: 4 } })).toMatchObject({ ok: false, error: expect.stringMatching(/does not exist/) });
    expect(applyEdit(run, { action: "edit", sheet: "S", ref: "C2", value: 97, source: { doc: "B", page: 1 } })).toMatchObject({ ok: false, error: expect.stringMatching(/one document/) });
    expect(applyEdit(run, { action: "edit", sheet: "S", ref: "Z9", value: 1 })).toMatchObject({ ok: false });
  });
});

describe("text-layer quirks", () => {
  it("matches quotes across ligatures", () => {
    const p = page(1, "PCE inﬂation 3.6 2.3 2.0");
    expect(findQuote(p, "PCE inflation 3.6 2.3")).not.toBeNull();
    expect(findQuote(p, "PCE inﬂation 3.6")).not.toBeNull();
  });
});

describe("document names in the viewer", () => {
  it("shows what differs between two issues of the same report", async () => {
    const { distinctNames } = await import("@/components/PageViewer");
    expect(distinctNames(["Summary of Economic Projections, March 2026", "Summary of Economic Projections, June 2026"])).toEqual(["March 2026", "June 2026"]);
    expect(distinctNames(["Short-Term Energy Outlook, November 2026", "Monetary Policy Report, July 2026"])).toEqual(["Short-Term Energy Outlook, November 2026", "Monetary Policy Report, July 2026"]);
    const { pairTitle } = await import("@/lib/doc-names");
    expect(pairTitle("Summary of Economic Projections, March 2026", "Summary of Economic Projections, June 2026")).toBe("Summary of Economic Projections: March 2026 vs June 2026");
    expect(pairTitle("Short-Term Energy Outlook, November 2026", "Monetary Policy Report, July 2026")).toBe("Short-Term Energy Outlook, November 2026 vs Monetary Policy Report, July 2026");
  });
});

describe("rendering pages", () => {
  it("renders a page with ink on it (pdf.js with its image decoders)", { timeout: 60_000 }, async () => {
    const fs = await import("node:fs");
    const sharp = (await import("sharp")).default;
    const { readText, renderPage } = await import("@/lib/pdf");
    const data = new Uint8Array(fs.readFileSync("fixtures/filings/eia-steo-nov-2026.pdf"));
    const pages = await readText(data);
    expect(pages.every((p) => p.kind === "text")).toBe(true);
    const png = await renderPage(data, 1, 600);
    // A blank render is almost pure white; this page is a page of text and tables.
    expect((await sharp(png).greyscale().stats()).channels[0].mean).toBeLessThan(245);
  });
});
