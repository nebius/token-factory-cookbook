import { respondJob } from "@/lib/jobs/runner";
import { body, fail, idParam, json } from "@/lib/server/http";

/** Answer Kimi's question about a photo, or choose whether to open a machine that's already saved. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = idParam((await ctx.params).id);
    const b = await body<{ value: string | boolean | null }>(req);
    return json({ ok: respondJob(id, b.value ?? null) });
  } catch (e) {
    return fail(e);
  }
}
