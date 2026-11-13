import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { boilerplate, captions, outline, pageSummary, search, squeezeLeaders } from "@/lib/outline";
import { findQuote, matchValue, tokens } from "@/lib/numbers";
import { hasFigure, readText, type PageText } from "@/lib/pdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseArgs, WriteCells } from "@/lib/agent/tools";
import { evaluate } from "@/lib/formula";

function page(n: number, runs: string[], figures = false): PageText {
  let x = 0;
  const rs = runs.map((s, i) => {
    const r = { s, box: [x, 0.05 * (i + 1), s.length * 0.005, 0.02] as [number, number, number, number] };
    x = 0;
    return r;
  });
  return { n, width: 612, height: 792, text: runs.join(" "), runs: rs, figures };
}

describe("page outline for long documents", () => {
  const pages = Array.from({ length: 10 }, (_, i) =>
    page(i + 1, ["November 2026", "U.S. Energy Information Administration | Short-Term Energy Outlook", String(i + 1), i === 6 ? "Q1 Q2 Q3 Q4 2025" : ["Oil", "Gas", "Coal", "Power", "Prices", "Demand", "Supply", "Trade", "Stocks", "Rigs"][i], i === 6 ? "Table 2. Energy Prices U.S. Energy Information Administration" : ["markets tightened", "storage rose", "exports grew", "solar added", "spreads widened", "weather mild", "output fell", "flows shifted", "builds slowed", "counts dipped"][i]]),
  );

  it("drops running heads and footers, and leading axis labels", () => {
    const skip = boilerplate(pages);
    expect(skip.has("november #")).toBe(true);
    expect(pageSummary(pages[2], skip)).toBe("Coal exports grew");
    expect(pageSummary(pages[6], skip)).toMatch(/^Table 2\. Energy Prices/);
  });

  it("pulls figure and table captions, cut where the data starts", () => {
    expect(captions("x Figure 31. Federal receipts and expenditures Annual 12 14 16 Figure 32. Federal debt Percent of GDP")).toEqual(["Figure 31. Federal receipts and expenditures", "Figure 32. Federal debt"]);
    expect(captions("Table 1. U.S. Energy Markets Summary 13.32 13.4 13.5")).toEqual(["Table 1. U.S. Energy Markets Summary"]);
    expect(captions("as shown in (figure 31) above")).toEqual([]);
    expect(outline(pages).split("\n")[6]).toContain("| Table 2. Energy Prices");
  });

  it("squeezes dot leaders", () => {
    expect(squeezeLeaders("Brent Spot Average ............ 75.83 68.01")).toBe("Brent Spot Average … 75.83 68.01");
  });

  it("searches phrases first, then pages with every word", () => {
    const docs = [page(1, ["The Henry Hub spot price fell"]), page(2, ["Henry Hub", "spot", "price table"]), page(3, ["Brent"])];
    const phrase = search(docs, "henry hub spot price");
    expect(phrase.mode).toBe("phrase");
    expect(phrase.hits.map((h) => h.page)).toEqual([1, 2]);
    const words = search(docs, "price henry table");
    expect(words.mode).toBe("words");
    expect(words.hits.map((h) => h.page)).toEqual([2]);
    expect(search(docs, "coal").mode).toBe("none");
  });
});

describe("long-document text quirks", () => {
  it("matches quotes and numbers across dot leaders", () => {
    const p = page(1, ["Brent Spot Average ....................... 75.83 68.01 69.00"]);
    expect(findQuote(p, "Brent Spot Average … 75.83 68.01")).not.toBeNull();
    expect(findQuote(p, "Brent Spot Average 75.83")).not.toBeNull();
    expect(matchValue(75.83, tokens("Average......75.83"))?.how).toBe("exact");
  });

  it("reads decimals a text layer printed with a space before the point", () => {
    expect(tokens("within a range of 1 .3 to 4 .7 percent").map((t) => [t.value, t.percent])).toEqual([
      [1.3, false],
      [4.7, true],
    ]);
    expect(tokens("grew in 2025. 3 firms").map((t) => t.value)).toEqual([2025, 3]);
  });

  it("flags real images and figure captions, not logos or ruled tables", () => {
    const { paintImageXObject: paint, paintInlineImageXObject: inline, constructPath: path } = pdfjs.OPS;
    expect(hasFigure({ fnArray: [paint], argsArray: [["img", 928, 522]] }, "")).toBe(true);
    expect(hasFigure({ fnArray: [paint, paint], argsArray: [["logo", 117, 93], ["bar", 1457, 112]] }, "")).toBe(false);
    expect(hasFigure({ fnArray: [inline], argsArray: [[{ width: 600, height: 400 }]] }, "")).toBe(true);
    expect(hasFigure({ fnArray: Array(900).fill(path), argsArray: [] }, "Table 4. Supply")).toBe(false);
    expect(hasFigure({ fnArray: [], argsArray: [] }, "Figure 31. Federal receipts")).toBe(true);
    expect(hasFigure({ fnArray: [], argsArray: [] }, "prices rose (figure 31)")).toBe(false);
  });

  it("reads the bundled EIA excerpt: outline, search, figures", { timeout: 60_000 }, async () => {
    const pages = await readText(new Uint8Array(fs.readFileSync("fixtures/filings/eia-steo-nov-2026.pdf")));
    expect(pages).toHaveLength(5);
    const o = outline(pages);
    expect(o).toContain("p1: Overview");
    expect(o).toContain("Table 1. Estimated Strait of Hormuz");
    expect(o.length).toBeLessThan(4_000);
    expect(search(pages, "Brent").hits.length).toBe(5);
    // Only the page with the Brent price chart is flagged as a chart.
    expect(pages.map((p) => p.figures)).toEqual([false, false, false, false, true]);
  });
});

describe("sheet names with punctuation", () => {
  it("accepts Excel-valid names with & and spaces, and formulas can reference them quoted", () => {
    expect(parseArgs(WriteCells, '{"sheet":"After-tax MD&A","cells":[{"ref":"B2","value":1}]}').ok).toBe(true);
    expect(parseArgs(WriteCells, '{"sheet":"Q3 [2026]","cells":[{"ref":"B2","value":1}]}').ok).toBe(false);
    expect(evaluate("='After-tax MD&A'!B2*2", (sheet, ref) => (sheet === "After-tax MD&A" && ref === "B2" ? 21 : null))).toBe(42);
  });
});
