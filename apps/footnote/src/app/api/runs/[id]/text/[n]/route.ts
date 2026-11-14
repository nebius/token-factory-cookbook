import { NextResponse } from "next/server";
import { loadPages, loadRun } from "@/lib/runs";

export const runtime = "nodejs";

// One page's text layer and where it came from: the PDF, or the model's transcription of a scan
// (with the file's own OCR text, when it had one). ?doc=B for the second document.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const doc = new URL(req.url).searchParams.get("doc") === "B" ? "B" : "A";
  const run = /^[a-z0-9-]+$/.test(id) ? await loadRun(id) : null;
  const page = Number(n);
  const info = doc === "B" ? run?.docB : run?.doc;
  if (!run || !info || !Number.isInteger(page) || page < 1 || page > info.pages) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const p = (await loadPages(id, doc))[page - 1];
    return NextResponse.json({ origin: p.origin ?? "pdf", kind: p.kind ?? "text", lines: p.runs.map((r) => r.s), fileText: p.fileText ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Not ready" }, { status: 404 });
  }
}
