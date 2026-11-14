import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import type { Tool } from "@/lib/model/client";

// The four tools the model works with, as JSON schemas for the API and zod schemas for checking
// what comes back. Names follow MCP style (verb_noun) so they port to an MCP server unchanged.

const RESERVED = ["sources", "claims", "about"];

const SheetName = z
  .string()
  .trim()
  // Excel's own rule: up to 31 characters, none of [ ] : * ? / \ and no leading or trailing apostrophe.
  .regex(/^(?!')[^[\]:*?/\\]{1,31}(?<!')$/, "Sheet names: up to 31 characters, without [ ] : * ? / \\ or a leading or trailing apostrophe")
  .refine((s) => !RESERVED.includes(s.toLowerCase()), "Sources, Claims and About are reserved sheet names");

const Box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const DocArg = z.enum(["A", "B"]).optional().nullable();

export const ListPages = z.object({ doc: DocArg });

export const ViewPage = z.object({
  doc: DocArg,
  page: z.coerce.number().int().min(1),
  crop: Box.optional().nullable(),
});

export const RunPython = z.object({ code: z.string().min(1).max(20_000) });

export const SearchPages = z.object({ query: z.string().trim().min(2).max(200), doc: DocArg });

const CellIn = z
  .object({
    ref: z.string().trim().regex(/^\$?[A-Za-z]{1,3}\$?\d{1,5}$/, "ref must look like B4"),
    label: z.string().max(200).optional().nullable(),
    value: z.union([z.number(), z.string().max(500)]).optional().nullable(),
    formula: z.string().max(500).optional().nullable(),
    format: z.enum(["number", "percent", "currency", "text"]).optional().nullable().catch(undefined),
    source: z
      .object({
        doc: DocArg,
        page: z.coerce.number().int().min(1),
        quote: z.string().max(400).optional().nullable(),
        box: Box.optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .refine((c) => c.formula || (c.value !== undefined && c.value !== null), "each cell needs a value or a formula");

export const WriteCells = z.object({ sheet: SheetName, cells: z.array(CellIn).min(1).max(200) });

export const Verdict = z.enum(["supported", "contradicted", "not_checkable"]);

export const SubmitClaims = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().min(3).max(1500),
        doc: DocArg,
        page: z.coerce.number().int().min(1),
        verdict: Verdict,
        evidence: z.string().max(1500),
        python: z.string().max(8000).optional().nullable(),
        gap: z.string().max(400).optional().nullable(),
      }),
    )
    .max(40),
  note: z.string().max(2000).optional().nullable(),
});

// Model arguments arrive as a JSON string; repair the usual small faults before validating.
export function parseArgs<T>(schema: z.ZodType<T>, raw: string): { ok: true; value: T } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    try {
      data = JSON.parse(jsonrepair(raw));
    } catch {
      return { ok: false, error: "Arguments are not valid JSON." };
    }
  }
  // Numbers sent as strings ("1,231" or "2.4") inside cells.
  if (data && typeof data === "object" && Array.isArray((data as { cells?: unknown[] }).cells)) {
    for (const c of (data as { cells: Record<string, unknown>[] }).cells) {
      if (typeof c.value === "string" && /^-?[\d,]*\.?\d+$/.test(c.value.trim()) && !c.format?.toString().startsWith("text")) c.value = Number(c.value.replace(/,/g, ""));
      if (typeof c.formula === "string" && c.formula && !c.formula.startsWith("=")) c.formula = `=${c.formula}`;
    }
  }
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ") };
}

const box = { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "[x, y, width, height] as fractions of the page (0 to 1), top-left origin" };

// When comparing two documents every tool that touches pages takes doc: "A" or "B".
const docProp = { type: "string", enum: ["A", "B"], description: "Which document: A or B" };

export function toolDefs(python: boolean, compare = false): Tool[] {
  const withDoc = <T extends Record<string, unknown>>(props: T) => (compare ? { doc: docProp, ...props } : props);
  const tools: Tool[] = [
    {
      type: "function",
      function: {
        name: "list_pages",
        description: "List every page with its first line of text and whether it has charts or images.",
        parameters: { type: "object", properties: withDoc({}) },
      },
    },
    {
      type: "function",
      function: {
        name: "search_pages",
        description: "Search the text of every page for a phrase (case-insensitive), e.g. a table title, a line item or a figure number. Returns the pages and a snippet around each match. Use it to find things in long documents.",
        parameters: {
          type: "object",
          properties: withDoc({ query: { type: "string", description: "A phrase as printed, e.g. \"Table 2\" or \"net earnings attributable\"" } }),
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "view_page",
        description:
          "Look at one page. Returns the page's exact text layer, and the page image arrives in the next message. Pass crop to zoom into a chart or table region; the crop is enlarged so small labels are readable.",
        parameters: {
          type: "object",
          properties: withDoc({ page: { type: "integer", minimum: 1 }, crop: box }),
          required: compare ? ["doc", "page"] : ["page"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_cells",
        description:
          "Write cells into one sheet of the workbook. Each numeric input needs source.page and source.quote (copied exactly from the page text, containing the number). Values read from a chart get source.box instead of a quote. Derived numbers are formulas. Returns a check of every cell you wrote: fix any that fail.",
        parameters: {
          type: "object",
          properties: {
            sheet: { type: "string", description: "Sheet name, e.g. Overview" },
            cells: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ref: { type: "string", description: "A1-style reference, e.g. B4" },
                  label: { type: "string", description: "What the number is, with units and period, e.g. Brent price 2026 ($/b)" },
                  value: { anyOf: [{ type: "number" }, { type: "string" }], description: "A number in the document's units, or text for headers and labels" },
                  formula: { type: "string", description: "Excel formula starting with =, e.g. =C4/B4-1. Supports + - * / ^, SUM, AVERAGE, MIN, MAX, COUNT, ABS, ROUND and refs like B4 or Overview!B4" },
                  format: { type: "string", enum: ["number", "percent", "currency", "text"], description: "percent cells hold fractions (0.026 shows as 2.6%)" },
                  source: {
                    type: "object",
                    properties: withDoc({
                      page: { type: "integer", minimum: 1 },
                      quote: { type: "string", description: "Short exact phrase or table row from the page text that contains the number" },
                      box: box,
                    }),
                    required: compare ? ["doc", "page"] : ["page"],
                  },
                },
                required: ["ref"],
              },
            },
          },
          required: ["sheet", "cells"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_claims",
        description: "Finish: report each quantitative claim you checked and a short note. Call once, at the end.",
        parameters: {
          type: "object",
          properties: {
            claims: {
              type: "array",
              items: {
                type: "object",
                properties: withDoc({
                  claim: { type: "string", description: "The claim sentence copied exactly as printed, or \"Table: ...\" for a check of a table" },
                  page: { type: "integer", minimum: 1 },
                  verdict: { type: "string", enum: ["supported", "contradicted", "not_checkable"] },
                  evidence: { type: "string", description: "The numbers you compared and where they come from (page, table, chart, cell)" },
                  python: { type: "string", description: "The Python you ran for this claim, if any" },
                  gap: { type: "string", description: "For contradicted claims: by how much the claim is off" },
                }),
                required: ["claim", "page", "verdict", "evidence"],
              },
            },
            note: { type: "string", description: "Two or three sentences for the reader: what the model covers and anything to watch" },
          },
          required: ["claims"],
        },
      },
    },
  ];
  if (python)
    tools.splice(3, 0, {
      type: "function",
      function: {
        name: "run_python",
        description:
          "Run Python 3 (pandas and numpy available, no network, no files from the document, 20 s limit). Print what you need. Use it to recompute growth rates, shares and totals, and to turn chart pixel positions into values.",
        parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      },
    });
  return tools;
}
