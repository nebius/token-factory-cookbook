import fs from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { Book, check } from "@/lib/book";
import { evaluate, references } from "@/lib/formula";
import { findQuote, matchValue, tokens } from "@/lib/numbers";
import { readText, type PageText } from "@/lib/pdf";
import { parseArgs, SubmitClaims, ViewPage, WriteCells } from "@/lib/agent/tools";
import { buildXlsx } from "@/lib/xlsx";
import { costOf, settings, toUsage } from "@/lib/model/client";

function page(n: number, text: string, figures = false): PageText {
  // One run per word, laid out left to right on one line, enough for offsets and boxes.
  const words = text.split(" ");
  let x = 0;
  const runs = words.map((s) => {
    const r = { s, box: [x, 0.1 * n, s.length * 0.01, 0.02] as [number, number, number, number] };
    x += (s.length + 1) * 0.01;
    return r;
  });
  return { n, width: 612, height: 792, text: words.join(" "), runs, figures };
}

describe("formulas", () => {
  const cells: Record<string, number> = { "Model!B2": 15, "Model!C2": 19, "Model!B3": 2, "Model!B4": 3, "Other!A1": 10 };
  const lookup = (sheet: string | null, ref: string) => cells[`${sheet ?? "Model"}!${ref}`] ?? null;

  it("evaluates arithmetic, functions and ranges", () => {
    expect(evaluate("=C2/B2-1", lookup)).toBeCloseTo(0.2667, 4);
    expect(evaluate("=SUM(B2:B4)", lookup)).toBe(20);
    expect(evaluate("=ROUND(AVERAGE(B2:C2), 1)", lookup)).toBe(17);
    // Excel applies unary minus before ^: -2^2 is 4.
    expect(evaluate("=-B3^2+Other!A1", lookup)).toBe(14);
    expect(evaluate("=50%*B2", lookup)).toBe(7.5);
  });

  it("refuses what it cannot evaluate", () => {
    expect(() => evaluate("=VLOOKUP(B2, A1:C3, 2)", lookup)).toThrow(/Unsupported function/);
    expect(() => evaluate("=B2/0", lookup)).toThrow(/Division by zero/);
    expect(() => evaluate('="text"', lookup)).toThrow();
  });

  it("lists the cells a formula reads", () => {
    expect(references("=SUM(B2:B4)/Other!A1", "Model")).toEqual(["Model!B2", "Model!B3", "Model!B4", "Other!A1"]);
  });
});

describe("numbers on the page", () => {
  const text = "Brent crude oil spot price (dollars per barrel) $69 $97 $86 Total 25,200 7,490 GDP 2.4% (1.5)";

  it("reads printed numbers", () => {
    expect(tokens(text).map((t) => t.value)).toEqual([69, 97, 86, 25200, 7490, 2.4, -1.5]);
  });

  it("matches exact, rounded, percent and scaled values", () => {
    const t = tokens(text);
    expect(matchValue(97, t)?.how).toBe("exact");
    expect(matchValue(2.43, t)?.how).toBe("rounded");
    expect(matchValue(0.024, t)?.how).toBe("percent");
    expect(matchValue(25.2, t)?.how).toBe("scaled");
    expect(matchValue(91, t)).toBeNull();
  });

  it("reads spaced decimals and the word percent, and never rounds to a lone digit", () => {
    const t = tokens("PCE prices rose 4 . 1 percent, up from 2 . 5; axis 0 2 4 6");
    expect(t.slice(0, 2).map((x) => [x.value, x.percent])).toEqual([
      [4.1, true],
      [2.5, false],
    ]);
    expect(matchValue(0.041, t)?.how).toBe("percent");
    expect(matchValue(0.025, t, true)?.how).toBe("percent");
    expect(matchValue(0.21, t)).toBeNull();
    expect(matchValue(2.4, tokens("axis 0 2 4 6"))).toBeNull();
    expect(matchValue(4, tokens("axis 0 2 4 6"))?.how).toBe("exact");
  });

  it("finds quotes despite spacing and dash differences", () => {
    const p = page(1, "LNG exports will rise to 19 billion cubic feet per day in 2027, up 26% from 2025");
    expect(findQuote(p, "rise to 19 billion  cubic feet")).not.toBeNull();
    expect(findQuote(p, "up 27% from 2025")).toBeNull();
  });
});

describe("checks", () => {
  const pages = [page(1, "Overview LNG exports 15 18 19 Brent $69 $97 $86"), page(2, "Chart of Brent prices", true)];

  it("ties inputs to their page and recomputes formulas", () => {
    const book = Book.from(
      [
        { sheet: "Overview", ref: "B2", label: "LNG 2025", value: 15, source: { page: 1, quote: "LNG exports 15" }, step: 1 },
        { sheet: "Overview", ref: "C2", label: "LNG 2027", value: 19, source: { page: 1 }, step: 1 },
        { sheet: "Overview", ref: "D2", label: "Growth", formula: "=C2/B2-1", step: 1 },
        { sheet: "Overview", ref: "B3", label: "Brent Q4 (read from chart)", value: 110, source: { page: 2, box: [0.5, 0.2, 0.05, 0.05] }, step: 1 },
        { sheet: "Overview", ref: "B4", label: "Made up", value: 123, source: { page: 1 }, step: 1 },
        { sheet: "Overview", ref: "B5", label: "No source", value: 5, step: 1 },
        { sheet: "Overview", ref: "B6", label: "Wrong page", value: 86, source: { page: 2 }, step: 1 },
      ],
      [],
    );
    const { cells, summary } = check(book, pages);
    const at = (ref: string) => cells.find((c) => c.ref === ref)!;
    expect(at("B2").checks[0].status).toBe("ok");
    expect(at("B2").at?.box).toBeDefined();
    expect(at("D2").result).toBeCloseTo(0.2667, 4);
    expect(at("B3").checks[0]).toMatchObject({ status: "info", message: expect.stringMatching(/Read from a chart/) });
    expect(at("B4").checks[0].status).toBe("fail");
    expect(at("B5").checks[0].message).toBe("No source page");
    expect(at("B6").checks[0].message).toMatch(/printed on page 1/);
    expect(summary).toMatchObject({ inputs: 6, sourced: 5, matched: 2, formulas: 1, recomputed: 1 });
  });

  it("checks that totals add up", () => {
    const p = [page(1, "Kuwait 1,231 UAE 529 Iran 606 Total 2,366 2,400")];
    const rows = (total: number) =>
      Book.from(
        [
          { sheet: "S", ref: "B2", label: "Kuwait", value: 1231, source: { page: 1 }, step: 1 },
          { sheet: "S", ref: "B3", label: "UAE", value: 529, source: { page: 1 }, step: 1 },
          { sheet: "S", ref: "B4", label: "Iran", value: 606, source: { page: 1 }, step: 1 },
          { sheet: "S", ref: "B5", label: "Total", value: total, source: { page: 1 }, step: 1 },
        ],
        [],
      );
    expect(check(rows(2366), p).cells.find((c) => c.ref === "B5")!.checks.at(-1)!.status).toBe("ok");
    expect(check(rows(2400), p).cells.find((c) => c.ref === "B5")!.checks.at(-1)!.status).toBe("fail");
  });

  it("flags circular formulas", () => {
    const book = Book.from(
      [
        { sheet: "S", ref: "A1", formula: "=B1+1", step: 1 },
        { sheet: "S", ref: "B1", formula: "=A1+1", step: 1 },
      ],
      [],
    );
    expect(check(book, pages).cells[0].checks[0]).toMatchObject({ status: "fail" });
  });
});

describe("tool arguments", () => {
  it("repairs and validates write_cells", () => {
    const r = parseArgs(WriteCells, '{"sheet":"Overview","cells":[{"ref":"b2","value":"1,231","source":{"page":"1"}},{"ref":"C2","formula":"B2*2"},]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cells[0].value).toBe(1231);
      expect(r.value.cells[0].source?.page).toBe(1);
      expect(r.value.cells[1].formula).toBe("=B2*2");
    }
  });

  it("rejects reserved sheet names and empty cells", () => {
    expect(parseArgs(WriteCells, '{"sheet":"Sources","cells":[{"ref":"A1","value":1}]}').ok).toBe(false);
    expect(parseArgs(WriteCells, '{"sheet":"S","cells":[{"ref":"A1"}]}').ok).toBe(false);
    expect(parseArgs(ViewPage, '{"page":0}').ok).toBe(false);
  });

  it("validates claim verdicts", () => {
    expect(parseArgs(SubmitClaims, '{"claims":[{"claim":"up 26%","page":1,"verdict":"supported","evidence":"15 to 19"}]}').ok).toBe(true);
    expect(parseArgs(SubmitClaims, '{"claims":[{"claim":"up 26%","page":1,"verdict":"true","evidence":"x"}]}').ok).toBe(false);
  });
});

describe("workbook", () => {
  it("writes live formulas with cached results, notes, Sources and Claims", async () => {
    const pages = [page(1, "LNG exports 15 18 19")];
    const book = Book.from(
      [
        { sheet: "Overview", ref: "A1", value: "Measure", step: 1 },
        { sheet: "Overview", ref: "B2", label: "LNG 2025", value: 15, source: { page: 1, quote: "LNG exports 15" }, step: 1 },
        { sheet: "Overview", ref: "C2", label: "LNG 2027", value: 19, source: { page: 1 }, step: 1 },
        { sheet: "Overview", ref: "D2", label: "Growth", formula: "=C2/B2-1", format: "percent", step: 1 },
      ],
      [{ id: "c1", claim: "up 26% from 2025", page: 1, verdict: "supported", evidence: "19/15-1 = 26.7%", step: 2 }],
    );
    const { cells, claims } = check(book, pages);
    const buf = await buildXlsx({ title: "t", docs: { A: "t.pdf" }, cells, claims, model: "Inkling 2 Small" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Overview", "Sources", "Claims", "About"]);
    const d2 = wb.getWorksheet("Overview")!.getCell("D2").value as { formula: string; result: number };
    expect(d2.formula).toBe("C2/B2-1");
    expect(d2.result).toBeCloseTo(0.2667, 4);
    expect(wb.getWorksheet("Overview")!.getCell("B2").note).toBe("Page 1: “LNG exports 15”");
    expect(wb.getWorksheet("Claims")!.getCell("C2").value).toBe("Supported");
  });
});

describe("model client", () => {
  it("keeps the last streamed usage and prices cached tokens", () => {
    const u = toUsage({ prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_tokens_details: { cached_tokens: 400_000 } });
    const s = settings({ INKLING_PROVIDER: "nebius", NEBIUS_API_KEY: "x", INKLING_PRICE_INPUT: "2", INKLING_PRICE_CACHED: "0.2", INKLING_PRICE_OUTPUT: "10" } as unknown as NodeJS.ProcessEnv);
    expect(costOf(s, u)).toBeCloseTo(0.6 * 2 + 0.4 * 0.2 + 0.1 * 10, 6);
    expect(costOf(settings({ INKLING_PROVIDER: "nebius" } as unknown as NodeJS.ProcessEnv), u)).toBeNull();
  });
});

describe("pdf text layer", () => {
  it("reads the bundled EIA excerpt with boxes for every run", async () => {
    const pages = await readText(new Uint8Array(fs.readFileSync("fixtures/filings/eia-steo-nov-2026.pdf")));
    expect(pages).toHaveLength(5);
    expect(pages[0].text).toContain("Brent crude oil spot price");
    expect(pages[4].figures).toBe(true);
    const hit = findQuote(pages[1], "LNG exports will rise to 19 billion cubic feet per day in 2027");
    expect(hit).not.toBeNull();
    const t = tokens(pages[3].text);
    expect(matchValue(7490, t)?.how).toBe("exact");
    for (const r of pages[0].runs) for (const v of r.box) expect(v).toBeGreaterThanOrEqual(-0.01);
  });
});
