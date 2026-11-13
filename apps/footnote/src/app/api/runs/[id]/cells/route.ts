import { NextResponse } from "next/server";
import { CellEdit, applyEdit } from "@/lib/edits";
import { finish } from "@/lib/pipeline";
import { loadRun, saveRun } from "@/lib/runs";

export const runtime = "nodejs";

// One edit at a time per run, so two quick saves cannot overwrite each other.
const locks = new Map<string, Promise<unknown>>();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = CellEdit.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });

  const prev = locks.get(id) ?? Promise.resolve();
  const job = prev.then(async () => {
    const run = await loadRun(id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (run.status !== "done" && run.status !== "failed") return NextResponse.json({ error: "Wait for the run to finish before editing." }, { status: 409 });
    const r = applyEdit(run, parsed.data);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    // Deterministic only: checks, recompute and the .xlsx. No model call.
    await finish(run);
    await saveRun(run);
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  });
  locks.set(id, job.catch(() => {}));
  try {
    return await job;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
