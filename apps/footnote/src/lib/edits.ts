import { z } from "zod";
import { key, type Cell } from "@/lib/book";
import { evaluate, references } from "@/lib/formula";
import type { Run } from "@/lib/runs";

// Hand edits on the run page. An edit changes one cell's value or formula and its source; saving reruns
// only the deterministic checks and the recompute (pipeline.finish), never the model. The model's own
// version of every edited cell is kept so it can be restored, and every change is logged in run.edits.

export const CellEdit = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    sheet: z.string().min(1).max(31),
    ref: z.string().regex(/^[A-Za-z]{1,3}\d{1,5}$/),
    value: z.union([z.number(), z.string().max(500)]).optional().nullable(),
    formula: z.string().max(500).optional().nullable(),
    source: z
      .object({
        doc: z.enum(["A", "B"]).optional().nullable(),
        page: z.coerce.number().int().min(1),
        quote: z.string().max(400).optional().nullable(),
      })
      .optional()
      .nullable(),
  }),
  z.object({ action: z.literal("reset"), sheet: z.string().min(1).max(31), ref: z.string().regex(/^[A-Za-z]{1,3}\d{1,5}$/) }),
]);

export type CellEdit = z.infer<typeof CellEdit>;

type Result = { ok: true; cell: Cell | null } | { ok: false; error: string };

const clone = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function applyEdit(run: Run, e: CellEdit, now = new Date()): Result {
  const ref = e.ref.toUpperCase();
  const k = key(e.sheet, ref);
  const i = run.cells.findIndex((c) => key(c.sheet, c.ref) === k);
  const before = i >= 0 ? run.cells[i] : null;

  if (e.action === "reset") {
    if (!run.original || !(k in run.original)) return { ok: false, error: "This cell has not been edited." };
    const model = run.original[k];
    if (model) {
      if (i >= 0) run.cells[i] = clone(model);
      else run.cells.push(clone(model));
    } else if (i >= 0) run.cells.splice(i, 1);
    delete run.original[k];
    (run.edits ??= []).push({ at: now.toISOString(), sheet: e.sheet, ref, kind: "reset", before: clone(before), after: clone(model) });
    return { ok: true, cell: model };
  }

  if (!before) return { ok: false, error: `${k} does not exist.` };
  const formula = e.formula?.trim() ? (e.formula.trim().startsWith("=") ? e.formula.trim() : `=${e.formula.trim()}`) : undefined;
  if (formula) {
    try {
      references(formula, e.sheet);
      // Parse it for real: every reference reads as 1, so only syntax or unsupported functions can fail.
      evaluate(formula, () => 1);
    } catch (err) {
      return { ok: false, error: `Formula: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  let value: number | string | undefined;
  if (!formula) {
    if (e.value === undefined || e.value === null || e.value === "") return { ok: false, error: "Give a value or a formula." };
    const n = typeof e.value === "string" ? Number(e.value.replace(/[,$%\s]/g, "")) : e.value;
    value = typeof e.value === "number" || (/^[-+]?[\d,]*\.?\d+%?$/.test(String(e.value).replace(/[$\s]/g, "")) && Number.isFinite(n)) ? n : String(e.value);
    // "2.4%" typed into a percent cell means 0.024.
    if (typeof e.value === "string" && e.value.trim().endsWith("%") && typeof value === "number") value = value / 100;
  }
  if (e.source) {
    if (e.source.doc === "B" && !run.docB) return { ok: false, error: "This run has one document." };
    const pages = e.source.doc === "B" ? run.docB!.pages : run.doc.pages;
    if (e.source.page > pages) return { ok: false, error: `Page ${e.source.page} does not exist; the document has ${pages} pages.` };
  }

  const after: Cell = {
    ...before,
    value,
    formula,
    source: e.source ? { ...(run.docB ? { doc: e.source.doc === "B" ? "B" : "A" } : {}), page: e.source.page, ...(e.source.quote?.trim() ? { quote: e.source.quote.trim() } : {}) } : undefined,
    edited: true,
  };
  if (!after.formula) delete after.formula;
  if (after.value === undefined) delete after.value;
  if (!after.source) delete after.source;

  run.original ??= {};
  if (!(k in run.original)) run.original[k] = clone({ ...before, edited: undefined });
  run.cells[i] = after;
  (run.edits ??= []).push({ at: now.toISOString(), sheet: e.sheet, ref, kind: "edit", before: clone(before), after: clone(after) });
  return { ok: true, cell: after };
}
