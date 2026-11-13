import { pairTitle } from "@/lib/doc-names";
import crypto from "node:crypto";
import { DEFAULT_COMPARE_FOCUS, DEFAULT_FOCUS, runAgent } from "@/lib/agent/agent";
import { Book, check, type Docs } from "@/lib/book";
import { settings } from "@/lib/model/client";
import { modelName } from "@/lib/model-name";
import { docTitle, readText, type PageText } from "@/lib/pdf";
import { docFile, loadPages, newId, saveRun, writeRunFile, type DocInfo, type DocKey, type Run, type Source } from "@/lib/runs";
import { needsTranscription, transcribe } from "@/lib/transcribe";
import { buildXlsx } from "@/lib/xlsx";

export const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PAGES = 120;

type Options = { python?: boolean; focus?: string };

export type Input = { pdf: Buffer; source: Source };

function info(pdf: Buffer, source: Source): DocInfo {
  return { name: source.name, pages: 0, sizes: [], hash: crypto.createHash("sha256").update(pdf).digest("hex").slice(0, 16), source };
}

function validate(pdf: Buffer) {
  if (pdf.length > MAX_PDF_BYTES) throw new Error("PDF is larger than 40 MB.");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file is not a PDF.");
}

// Starts a run and returns its id at once; the work continues in the background and the page polls
// run.json. Pass a second document to compare the two.
export async function startRun(pdf: Buffer, source: Source, options: Options = {}, second?: Input): Promise<string> {
  validate(pdf);
  if (second) validate(second.pdf);
  const id = newId();
  const run: Run = {
    id,
    createdAt: new Date().toISOString(),
    status: "reading",
    progress: { stage: "Reading the text layer", step: 0, chars: 0 },
    doc: info(pdf, source),
    ...(second ? { docB: info(second.pdf, second.source) } : {}),
    options: { python: options.python !== false, focus: options.focus?.trim().slice(0, 600) || (second ? DEFAULT_COMPARE_FOCUS : DEFAULT_FOCUS) },
    model: settings().model,
    steps: [],
    cells: [],
    claims: [],
    calls: [],
  };
  await saveRun(run);
  await writeRunFile(id, "document.pdf", pdf);
  if (second) await writeRunFile(id, docFile("B", "document.pdf"), second.pdf);
  void execute(run, pdf, second?.pdf);
  return id;
}

async function execute(run: Run, pdf: Buffer, pdfB?: Buffer) {
  let saving = Promise.resolve();
  let last = 0;
  // Progress saves are throttled; stage changes always save.
  const save = async (_stage?: string, chars?: number) => {
    if (chars !== undefined && Date.now() - last < 700) return;
    last = Date.now();
    saving = saving.then(() => saveRun(run)).catch(() => {});
    await saving;
  };
  try {
    const A = await readDoc(run, "A", pdf);
    const B = pdfB && run.docB ? await readDoc(run, "B", pdfB) : undefined;
    await save("read");

    const docs: Docs = { A: await readScans(run, "A", A, save), ...(B ? { B: await readScans(run, "B", B, save) } : {}) };

    run.status = "working";
    await save("start");
    await runAgent({ run, docs, save });

    run.status = "checking";
    run.progress = { stage: "Checking every cell against the pages", step: run.steps.length, chars: 0 };
    await save("check");
    await finish(run);
    run.status = "done";
    run.progress.stage = "Done";
  } catch (e) {
    run.status = "failed";
    run.error = e instanceof Error ? e.message : String(e);
    // Keep whatever the model wrote before the failure, checked.
    if (run.cells.length) await finish(run).catch(() => {});
  }
  await saving;
  await saveRun(run);
}

async function readDoc(run: Run, key: DocKey, pdf: Buffer): Promise<PageText[]> {
  const doc = key === "B" ? run.docB! : run.doc;
  const pages = await readText(new Uint8Array(pdf), MAX_PAGES);
  await writeRunFile(run.id, docFile(key, "pages.json"), JSON.stringify(pages));
  doc.pages = pages.length;
  // An upload named like a file ("nov26", "q3-10q") reads better under the PDF's own title.
  if (!doc.source?.url && /^[\w.-]{1,24}$/.test(doc.name)) {
    const title = await docTitle(new Uint8Array(pdf));
    if (title) doc.name = title;
  }
  doc.sizes = pages.map((p) => [Math.round(p.width), Math.round(p.height)]);
  return pages;
}

// Scanned pages get their text from the model before the agent starts (stage "transcribe" in the run log).
async function readScans(run: Run, key: DocKey, pages: PageText[], save: (stage: string) => Promise<void>): Promise<PageText[]> {
  if (!pages.some(needsTranscription)) return pages;
  const doc = key === "B" ? run.docB! : run.doc;
  run.status = "transcribing";
  const two = !!run.docB;
  const r = await transcribe({
    runId: run.id,
    doc: key,
    docName: doc.name,
    hash: doc.hash,
    pages,
    onCall: (log) => run.calls.push(log),
    onPage: async (done, total, page) => {
      run.progress = { stage: `Reading scanned ${two ? `${key} ` : ""}page ${page} (${done} of ${total})`, step: 0, chars: 0 };
      await save(run.progress.stage);
    },
  });
  doc.scanned = r.read;
  if (r.failed.length) doc.unread = r.failed;
  if (!r.read.length) throw new Error(`The model could not read any of the ${r.failed.length} scanned pages${two ? ` of ${key}` : ""}.`);
  await writeRunFile(run.id, docFile(key, "pages.json"), JSON.stringify(r.pages));
  return r.pages;
}

async function loadDocs(run: Run): Promise<Docs> {
  return { A: await loadPages(run.id, "A"), ...(run.docB ? { B: await loadPages(run.id, "B") } : {}) };
}

// Deterministic checks and the .xlsx, from the cells and claims in run.json. Safe to rerun: hand edits
// on the run page call this too, and no model is involved.
export async function finish(run: Run) {
  const docs = await loadDocs(run);
  const result = check(Book.from(run.cells, run.claims), docs);
  run.result = result;
  const xlsx = await buildXlsx({
    title: run.docB ? pairTitle(run.doc.name, run.docB.name) : run.doc.name,
    docs: { A: run.doc.name, ...(run.docB ? { B: run.docB.name } : {}) },
    scanned: { A: run.doc.scanned ?? [], B: run.docB?.scanned ?? [] },
    cells: result.cells,
    claims: result.claims,
    model: modelName(run.model),
    edits: run.edits ?? [],
  });
  await writeRunFile(run.id, "model.xlsx", xlsx);
}
