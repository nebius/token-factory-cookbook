import { NextResponse } from "next/server";
import { exampleFile, exampleSource, listExamples } from "@/lib/examples";
import { MAX_PDF_BYTES, startRun, type Input } from "@/lib/pipeline";
import { docFile, listRuns, loadRun, readRunFile } from "@/lib/runs";

export const runtime = "nodejs";

export async function GET() {
  const runs = await listRuns();
  return NextResponse.json(runs.map(({ id, createdAt, status, doc, docB, options, model, result }) => ({ id, createdAt, status, doc, docB, options, model, summary: result?.summary })));
}

// example: a bundled example (one document, or a pair). examples: two bundled documents to compare.
// again: rerun a finished run, optionally with Python switched.
type Body = { example?: string; examples?: [string, string]; again?: string; python?: boolean; focus?: string };

export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = (await req.json()) as Body;
      if (body.again) {
        const prev = /^[a-z0-9-]+$/.test(body.again) ? await loadRun(body.again) : null;
        if (!prev) return NextResponse.json({ error: "Unknown run." }, { status: 404 });
        const pdf = await readRunFile(prev.id, "document.pdf");
        const b: Input | undefined = prev.docB ? { pdf: await readRunFile(prev.id, docFile("B", "document.pdf")), source: prev.docB.source ?? { name: prev.docB.name } } : undefined;
        return NextResponse.json({ id: await startRun(pdf, prev.doc.source ?? { name: prev.doc.name }, { python: body.python ?? prev.options.python, focus: prev.options.focus }, b) });
      }
      const all = await listExamples();
      if (body.examples) {
        const [a, b] = body.examples.map((id) => all.find((e) => e.id === id && !e.b));
        if (!a || !b || a.id === b.id) return NextResponse.json({ error: "Pick two different single-document examples." }, { status: 400 });
        return NextResponse.json({ id: await startRun(await exampleFile(a.file), exampleSource(a), { python: body.python, focus: body.focus }, { pdf: await exampleFile(b.file), source: exampleSource(b) }) });
      }
      const ex = all.find((e) => e.id === body.example);
      if (!ex) return NextResponse.json({ error: "Unknown example." }, { status: 404 });
      const second: Input | undefined = ex.b ? { pdf: await exampleFile(ex.b.file), source: exampleSource(ex.b) } : undefined;
      return NextResponse.json({ id: await startRun(await exampleFile(ex.file), exampleSource(ex), { python: body.python, focus: body.focus || ex.focus }, second) });
    }
    const form = await req.formData();
    const named = (f: File, fallback: string) => (String(f.name || fallback).replace(/\.pdf$/i, "") || fallback).slice(0, 160);
    const file = form.get("pdf");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a PDF." }, { status: 400 });
    const fileB = form.get("pdfB");
    for (const f of [file, fileB]) if (f instanceof File && f.size > MAX_PDF_BYTES) return NextResponse.json({ error: "PDFs up to 40 MB." }, { status: 413 });
    const second: Input | undefined = fileB instanceof File ? { pdf: Buffer.from(await fileB.arrayBuffer()), source: { name: named(fileB, "Document B") } } : undefined;
    return NextResponse.json({
      id: await startRun(Buffer.from(await file.arrayBuffer()), { name: named(file, "Uploaded document") }, { python: form.get("python") !== "off", focus: String(form.get("focus") ?? "") }, second),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
