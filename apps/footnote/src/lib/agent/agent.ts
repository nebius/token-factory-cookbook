import { Book, check, type Cell, type Claim, type DocKey, type Docs } from "@/lib/book";
import { FormulaError } from "@/lib/formula";
import { ask, imagePart, type Message, type Reply } from "@/lib/model/client";
import { outline, search, squeezeLeaders } from "@/lib/outline";
import { pageImage, validCrop, viewImage } from "@/lib/pages";
import { runPython } from "@/lib/python";
import type { Run, Step, TraceCall } from "@/lib/runs";
import { writeRunFile } from "@/lib/runs";
import { ListPages, parseArgs, RunPython, SearchPages, SubmitClaims, toolDefs, ViewPage, WriteCells } from "./tools";

const MAX_STEPS = 30;
const MAX_STEPS_LONG = 45;
// Output budget per call. Reasoning models think before every tool call; too small a budget cuts
// the reply off mid-tool-call.
const MAX_TOKENS = 32_000;

// Long documents need more steps just to find things.
function stepCap(pages: number) {
  return pages > 20 ? MAX_STEPS_LONG : MAX_STEPS;
}

export const DEFAULT_FOCUS = "Model the headline figures and forecasts, and check every quantitative claim the text makes against the document's own tables and charts.";

export const DEFAULT_COMPARE_FOCUS = "Put the two documents side by side: the main figures each one reports, with the change from A to B as a formula. Then check the statements about what changed against both documents.";

const COMPARE = `

Two documents: this run compares document A with document B (usually an earlier and a later issue of the same report).
- Every tool that touches pages takes doc: "A" or "B". Page numbers are per document.
- Build a sheet named Comparison with columns: A label, B the value in A, C the value in B, D the change as a formula (=C2-B2, or =C2/B2-1 for a growth rate). Each value cites its own document in source.doc.
- Claims are about what changed: statements in either document about revisions or changes, checked against the other document's numbers. Give each claim's doc and page where it is printed.`;

const SCANNED = `

Some pages are scans. Their text layer was transcribed by a model from the page image, so it can contain reading errors: use it, but compare important numbers with the image, and prefer printed tables to transcribed prose. These pages are marked [scanned] in the page list.`;

export function systemPrompt(python: boolean, compare = false, scanned = false) {
  return basePrompt(python) + (compare ? COMPARE : "") + (scanned ? SCANNED : "");
}

function basePrompt(python: boolean) {
  return `You are Footnote, a financial analyst who builds spreadsheet models from documents. Every number you put in the model is footnoted to the page it came from, and you check the document's own claims against its tables and charts.

How to work:
1. Read first. Use view_page on the pages you need (start with the ones listed as having tables or the overview). The text layer it returns is exact: copy printed numbers from it. The page image shows charts; for a chart, view it again with crop to zoom in.
   - In a long document, use search_pages to find the table, figure or phrase you need instead of paging through, and view several pages in one turn when you know you need them. Every page you view stays in the conversation, so view what you need, not everything.
2. Build the model with write_cells.
   - One sheet per topic (for example Overview, Oil, Forecast changes). Row 1 holds column headers as text. Column A holds row labels as text. Values go to the right.
   - Every numeric input carries source.page and source.quote: a short phrase or table row copied exactly from that page's text that contains the number, e.g. "LNG exports will rise to 19 billion cubic feet per day in 2027".
   - A number read from a chart has no quote: give source.box, the [x, y, width, height] region of the page (fractions, top-left origin) where you read it, and say "read from chart" in the label.
   - Write numbers in the document's units (19 for "19 Bcf/d", 124 for "$124"). Percentages are fractions with format percent (2.4% is 0.024).
   - Anything derived (change, growth, share, total, average) is a formula, e.g. =C4/B4-1, so the sheet recomputes. Formulas support + - * / ^, SUM, AVERAGE, MIN, MAX, COUNT, ABS, ROUND and references like B4 or Overview!B4.
   - write_cells answers with a check of each cell. If a quote is not found or a number does not match, fix the cell.
3. Check claims. Find the quantitative claims in the text (growth rates, changes from last month or last year, "highest since", totals, shares) and test each one against the numbers on the page${python ? " with run_python. Print the numbers you compare." : " by working through the arithmetic step by step."}
   - supported: matches within the document's rounding.
   - contradicted: the numbers disagree beyond rounding. Say by how much in gap.
   - not_checkable: the document does not contain the data to test it.
   - In submit_claims, copy each claim sentence exactly as printed (Footnote highlights it on the page). For a check you ran on a table rather than a sentence, start the claim with "Table:" and say what you checked.
4. Finish by calling submit_claims once, with every claim you checked and a short note for the reader.

Keep the model focused: roughly 15 to 60 input cells and up to 12 claims. Do not invent numbers or pages. Sheet names Sources, Claims and About are reserved.`;
}

function firstLine(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 150);
}

// The page outline the model starts from (and list_pages returns).
const pageList = outline;

function short(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

type Ctx = {
  run: Run;
  docs: Docs;
  save: (stage: string, chars?: number) => Promise<void>;
};

export function firstMessage(run: Pick<Run, "doc" | "docB" | "options">, docs: Docs) {
  if (!docs.B || !run.docB) return `Document: ${run.doc.name} (${docs.A.length} pages)\n\nPages:\n${pageList(docs.A)}\n\nTask: ${run.options.focus}`;
  return [
    `Document A: ${run.doc.name} (${docs.A.length} pages)\n\nPages of A:\n${pageList(docs.A)}`,
    `Document B: ${run.docB.name} (${docs.B.length} pages)\n\nPages of B:\n${pageList(docs.B)}`,
    `Task: ${run.options.focus}`,
  ].join("\n\n");
}

export async function runAgent({ run, docs, save }: Ctx) {
  const python = run.options.python;
  const compare = !!docs.B;
  const scanned = [...docs.A, ...(docs.B ?? [])].some((p) => p.origin === "model");
  const tools = toolDefs(python, compare);
  const book = Book.from(run.cells, run.claims);
  const messages: Message[] = [
    { role: "system", content: systemPrompt(python, compare, scanned) },
    { role: "user", content: firstMessage(run, docs) },
  ];
  // Single-document keys are unchanged, so earlier recordings still replay.
  const replayBase = `agent-${run.doc.hash}${compare && run.docB ? `-${run.docB.hash}` : ""}-${python ? "py" : "nopy"}-${hashText(run.options.focus)}`;
  let nudges = 0;
  let submitted = false;
  const cap = stepCap(docs.A.length + (docs.B?.length ?? 0));
  run.limits = { steps: cap, maxTokens: MAX_TOKENS };

  for (let n = 1; n <= cap && !submitted; n++) {
    run.progress = { stage: `Step ${n}: thinking`, step: n, chars: 0 };
    await save(run.progress.stage);
    if (n === cap - 2) messages.push({ role: "user", content: "You have 3 steps left. Write any remaining cells, then call submit_claims." });

    let reply: Reply;
    try {
      const r = await ask({
        step: n,
        replayKey: `${replayBase}-${n}`,
        messages,
        tools,
        maxTokens: MAX_TOKENS,
        onProgress: (chars) => {
          run.progress.chars = chars;
          void save(run.progress.stage, chars);
        },
      });
      reply = r.reply;
      run.calls.push(r.log);
    } catch (e) {
      const log = (e as { log?: Run["calls"][number] }).log;
      if (log) run.calls.push(log);
      throw e;
    }

    const cut = reply.finishReason === "length";
    const step: Step = { n, at: new Date().toISOString(), text: reply.text, reasoning: short(reply.reasoning, 6000), calls: [] };
    run.steps.push(step);

    if (cut && (!reply.toolCalls.length || reply.toolCalls.some((c) => !isJson(c.arguments)))) {
      // The reply ran out of output tokens, usually mid-reasoning or mid-tool-call. Drop the broken
      // turn and tell the model, instead of executing half a tool call.
      step.cutOff = true;
      messages.push({ role: "assistant", content: reply.text || "(reply cut off)" });
      if (++nudges > 2) throw new Error(`The model's replies were cut off at the ${MAX_TOKENS.toLocaleString("en-US")}-token output limit three times.`);
      messages.push({ role: "user", content: `Your last reply was cut off at the ${MAX_TOKENS.toLocaleString("en-US")}-token output limit before the tool call was complete. Think more briefly, and write fewer cells per write_cells call.` });
      continue;
    }

    if (!reply.toolCalls.length) {
      messages.push({ role: "assistant", content: reply.text || "(no reply)" });
      if (++nudges > 2) break;
      messages.push({ role: "user", content: "Keep going with the tools. When the model and the claim checks are done, call submit_claims." });
      continue;
    }

    messages.push({
      role: "assistant",
      content: reply.text || null,
      tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments || "{}" } })),
      // Reasoning models expect their reasoning back inside a tool-calling turn.
      ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
    } as Message);

    const images: Image[] = [];
    for (const call of reply.toolCalls) {
      run.progress.stage = `Step ${n}: ${describe(call.name, call.arguments)}`;
      await save(run.progress.stage);
      const t = await runTool(call.name, call.arguments, { run, docs, book, n, images, python });
      step.calls.push({ id: call.id, ...t.trace });
      messages.push({ role: "tool", tool_call_id: call.id, content: t.output });
      if (t.submitted) submitted = true;
    }
    if (images.length) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: images.map((i) => `Image of ${compare ? `${i.doc} ` : ""}page ${i.page}${i.crop ? `, crop [${i.crop.map((v) => v.toFixed(2)).join(", ")}]` : ""}.`).join(" ") },
          ...images.map((i) => imagePart(i.dataUrl)),
        ],
      });
    }
    run.cells = book.list();
    run.claims = book.claims;
    await save(run.progress.stage);
  }
  if (!submitted && !run.claims.length) run.note = run.note ?? "The model stopped before submitting its claim checks.";
}

function describe(name: string, raw: string) {
  try {
    const a = JSON.parse(raw || "{}");
    if (name === "view_page") return `viewing ${a.doc ? `${a.doc} ` : ""}page ${a.page}${a.crop ? " (zoomed)" : ""}`;
    if (name === "search_pages") return `searching for “${String(a.query ?? "").slice(0, 40)}”`;
    if (name === "write_cells") return `writing ${a.cells?.length ?? ""} cells to ${a.sheet}`;
    if (name === "run_python") return "running Python";
    if (name === "submit_claims") return "submitting claim checks";
  } catch {}
  return name.replace(/_/g, " ");
}

type Image = { doc: DocKey; page: number; crop?: number[]; dataUrl: string };
type ToolCtx = { run: Run; docs: Docs; book: Book; n: number; images: Image[]; python: boolean };
type ToolResult = { output: string; trace: Omit<TraceCall, "id">; submitted?: boolean };

export async function runTool(name: string, raw: string, ctx: ToolCtx): Promise<ToolResult> {
  const fail = (error: string, args: unknown = raw): ToolResult => ({ output: `Error: ${error}`, trace: { name, args, ok: false, summary: error } });

  const compare = !!ctx.docs.B;
  const keys: DocKey[] = compare ? ["A", "B"] : ["A"];
  // In a two-document run the model must say which; alone, A is the only choice.
  const pick = (d: DocKey | null | undefined): DocKey | string => {
    if (d === "B" && !compare) return "This run has one document; leave doc out or use A.";
    if (!d && compare) return 'Say which document: doc "A" or "B".';
    return d ?? "A";
  };
  const pagesOf = (d: DocKey) => (d === "B" ? ctx.docs.B! : ctx.docs.A);
  const label = (d: DocKey, page: number) => (compare ? `${d} page ${page}` : `Page ${page}`);

  if (name === "list_pages") {
    const a = parseArgs(ListPages, raw || "{}");
    const only = a.ok && a.value.doc ? [a.value.doc as DocKey].filter((k) => keys.includes(k)) : keys;
    const out = only.map((k) => (compare ? `Pages of ${k}:\n${pageList(pagesOf(k))}` : pageList(pagesOf(k)))).join("\n\n");
    const total = only.reduce((n, k) => n + pagesOf(k).length, 0);
    return { output: out, trace: { name, args: a.ok ? a.value : {}, ok: true, summary: `${total} pages listed`, output: short(out, 2000) } };
  }

  if (name === "search_pages") {
    const a = parseArgs(SearchPages, raw);
    if (!a.ok) return fail(a.error);
    const only = a.value.doc ? [a.value.doc as DocKey].filter((k) => keys.includes(k)) : keys;
    const parts = only.map((k) => ({ k, r: search(pagesOf(k), a.value.query) }));
    const r = {
      mode: parts.some((x) => x.r.mode === "phrase") ? "phrase" : parts.some((x) => x.r.mode === "words") ? "words" : "none",
      total: parts.reduce((n, x) => n + x.r.total, 0),
      hits: parts.flatMap((x) => x.r.hits.map((h) => ({ ...h, doc: x.k }))),
    };
    const head =
      r.mode === "phrase"
        ? `“${a.value.query}” appears ${r.total} time${r.total === 1 ? "" : "s"}${r.total > r.hits.length ? `; first ${r.hits.length} shown` : ""}.`
        : r.mode === "words"
          ? `The exact phrase is not printed; ${r.total} page${r.total === 1 ? " has" : "s have"} all of its words.`
          : `Nothing found for “${a.value.query}”. Try a shorter phrase or another wording.`;
    const out = [head, ...r.hits.map((h) => `${compare ? `${h.doc} ` : ""}p${h.page}: ${h.snippet}`)].join("\n");
    const pagesHit = [...new Set(r.hits.map((h) => (compare ? `${h.doc}${h.page}` : String(h.page))))];
    return { output: out, trace: { name, args: a.value, ok: true, summary: r.hits.length ? `“${a.value.query}”: pages ${pagesHit.slice(0, 12).join(", ")}${pagesHit.length > 12 ? "…" : ""}` : `“${a.value.query}”: no match`, output: short(out, 2500) } };
  }

  if (name === "view_page") {
    const a = parseArgs(ViewPage, raw);
    if (!a.ok) return fail(a.error);
    const { page } = a.value;
    const d = pick(a.value.doc);
    if (d !== "A" && d !== "B") return fail(d, a.value);
    const pages = pagesOf(d);
    if (page > pages.length) return fail(`Page ${page} does not exist; ${compare ? `document ${d}` : "the document"} has ${pages.length} pages.`, a.value);
    const crop = a.value.crop ? validCrop(a.value.crop) : null;
    if (a.value.crop && !crop) return fail("crop must be [x, y, width, height] fractions between 0 and 1, at least 0.02 wide and tall.", a.value);
    const png = await pageImage(ctx.run.id, page, d);
    const jpg = await viewImage(png, crop);
    const file = `view-${ctx.n}-${ctx.images.length + 1}.jpg`;
    await writeRunFile(ctx.run.id, file, jpg);
    ctx.images.push({ doc: d, page, crop: crop ?? undefined, dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}` });
    const p = pages[page - 1];
    let text = squeezeLeaders(p.text);
    if (crop) {
      const [x, y, w, h] = crop;
      text = p.runs
        .filter((r) => r.box[0] + r.box[2] / 2 >= x && r.box[0] + r.box[2] / 2 <= x + w && r.box[1] + r.box[3] / 2 >= y && r.box[1] + r.box[3] / 2 <= y + h)
        .map((r) => r.s)
        .join(" ");
      text = squeezeLeaders(text);
    }
    const layer = p.origin === "model" ? "Text layer (scanned page: transcribed by a model from the image, may contain reading errors)" : "Text layer";
    const out = `${label(d, page)} of ${pages.length}${crop ? " (crop)" : ""}${p.figures ? ", has charts or images" : ""}. ${layer}:\n${text || "(no text here; read the image)"}\n\nThe image follows in the next message.`;
    return { output: out, trace: { name, args: a.value, ok: true, summary: `${label(d, page)}${crop ? " zoomed" : ""}`, output: short(text, 1500), images: [{ file, page, crop: crop ?? undefined, ...(compare ? { doc: d } : {}) }] } };
  }

  if (name === "run_python") {
    if (!ctx.python) return fail("run_python is turned off for this run.");
    const a = parseArgs(RunPython, raw);
    if (!a.ok) return fail(a.error);
    const r = await runPython(a.value.code);
    const out = `${r.ok ? "Exit 0" : r.timedOut ? "Timed out" : "Failed"} in ${r.ms} ms.\nstdout:\n${r.stdout || "(empty)"}${r.stderr ? `\nstderr:\n${short(r.stderr, 3000)}` : ""}`;
    return {
      output: out,
      trace: { name, args: { code: a.value.code }, ok: r.ok, summary: r.ok ? firstLine(r.stdout.trim().split("\n").pop() || "No output") : firstLine(r.stderr.trim().split("\n").pop() || "Failed"), python: { code: a.value.code, stdout: r.stdout, stderr: r.stderr, ms: r.ms } },
    };
  }

  if (name === "write_cells") {
    const a = parseArgs(WriteCells, raw);
    if (!a.ok) return fail(a.error);
    const written: Cell[] = [];
    const errors: string[] = [];
    for (const c of a.value.cells) {
      const isNumber = !c.formula && typeof c.value === "number";
      const d = c.source ? pick(c.source.doc) : "A";
      if (c.source && d !== "A" && d !== "B" && (isNumber || c.source.quote)) {
        errors.push(`${c.ref}: ${d}`);
        continue;
      }
      const cell: Cell = {
        sheet: a.value.sheet,
        ref: c.ref.replace(/\$/g, "").toUpperCase(),
        label: c.label ?? undefined,
        value: c.formula ? undefined : (c.value ?? undefined),
        formula: c.formula ?? undefined,
        format: c.format ?? undefined,
        source: c.source ? { ...(compare ? { doc: (d === "B" ? "B" : "A") as DocKey } : {}), page: c.source.page, quote: c.source.quote ?? undefined, box: validCrop(c.source.box) ?? undefined } : undefined,
        step: ctx.n,
      };
      try {
        ctx.book.write(cell);
        written.push(cell);
      } catch (e) {
        errors.push(`${c.ref}: ${e instanceof FormulaError || e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Check the whole book (formulas may read other sheets) and report on the cells just written.
    const checked = check(ctx.book, ctx.docs).cells;
    const lines: string[] = [];
    let bad = 0;
    for (const w of written) {
      const c = checked.find((x) => x.sheet === w.sheet && x.ref === w.ref);
      if (!c || !c.checks.length) continue;
      const worst = c.checks.find((k) => k.status === "fail") ?? c.checks.find((k) => k.status === "warn") ?? c.checks[0];
      if (worst.status === "fail" || worst.status === "warn") bad++;
      lines.push(`${w.ref} ${worst.status}: ${worst.message}`);
    }
    const out = `Wrote ${written.length} cells to ${a.value.sheet}.${errors.length ? `\nRejected: ${errors.join("; ")}` : ""}\n${lines.join("\n")}`;
    return { output: out, trace: { name, args: a.value, ok: errors.length === 0, summary: `${written.length} cells in ${a.value.sheet}${bad ? `, ${bad} to fix` : ""}${errors.length ? `, ${errors.length} rejected` : ""}`, output: short(out, 3000) } };
  }

  if (name === "submit_claims") {
    const a = parseArgs(SubmitClaims, raw);
    if (!a.ok) return fail(a.error);
    const claims: Claim[] = a.value.claims.map((c, i) => ({
      id: `c${i + 1}`,
      claim: c.claim,
      ...(compare && c.doc ? { doc: c.doc as DocKey } : {}),
      page: c.page,
      verdict: c.verdict,
      evidence: c.evidence,
      python: c.python ?? undefined,
      gap: c.gap ?? undefined,
      step: ctx.n,
    }));
    ctx.book.claims = claims;
    ctx.run.note = a.value.note ?? undefined;
    const counts = { supported: 0, contradicted: 0, not_checkable: 0 };
    for (const c of claims) counts[c.verdict]++;
    return {
      output: "Received. The run is finished.",
      submitted: true,
      trace: { name, args: { claims: claims.length, note: a.value.note }, ok: true, summary: `${claims.length} claims: ${counts.supported} supported, ${counts.contradicted} contradicted, ${counts.not_checkable} not checkable` },
    };
  }

  return fail(`Unknown tool ${name}.`);
}

function isJson(s: string) {
  try {
    JSON.parse(s || "{}");
    return true;
  } catch {
    return false;
  }
}

function hashText(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
