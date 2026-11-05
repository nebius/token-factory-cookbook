import { getInput, getParts, getTeardown, partsVersion } from "@/lib/db/teardowns";
import { cancelJob, jobView, startJob } from "@/lib/jobs/runner";
import { fail, idParam, json } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Progress for a watching page. Metadata and part code are only sent when they changed since `pv`. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const id = idParam((await ctx.params).id);
    const job = jobView(id);
    if (!job) return json({ error: "not found" }, 404);
    const t = getTeardown(id);
    const pv = t ? partsVersion(id) : "";
    const known = new URL(req.url).searchParams.get("pv");
    const body: Record<string, unknown> = { job, status: t?.status ?? "deleted", pv, hasPhoto: !!getInput(id)?.image, inputKind: t?.input_kind };
    if (t && known !== pv) {
      body.meta = t.meta;
      body.parts = getParts(id).map((p) => ({ id: p.part_id, code: p.code }));
    }
    return json(body);
  } catch (e) {
    return fail(e);
  }
}

/** Start or resume. Safe to call again while it runs. */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    return json({ job: startJob(idParam((await ctx.params).id)) });
  } catch (e) {
    return fail(e);
  }
}

/** Stop the run. Everything finished so far stays saved. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    cancelJob(idParam((await ctx.params).id));
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
