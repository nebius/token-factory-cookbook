import { createTeardown, getInput, getTeardown, nextVersion } from "@/lib/db/teardowns";
import { KimiError } from "@/lib/kimi/client";
import { body, fail, idParam, json } from "@/lib/server/http";
import { startJob } from "@/lib/jobs/runner";

/** A new version of the same device from the same input. The old version stays available. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const t = getTeardown(idParam((await ctx.params).id));
    if (!t) throw new KimiError("not found", "config");
    const b = await body<{ hint?: string }>(req).catch(() => ({}) as { hint?: string });
    const input = getInput(t.id);
    const id = createTeardown({
      slug: t.slug,
      version: nextVersion(t.slug),
      inputKind: t.input_kind,
      inputHash: `${t.input_hash}#v${Date.now()}`,
      image: input?.image ?? undefined,
      mime: input?.mime ?? undefined,
      text: input?.text ?? undefined,
      name: t.name ?? undefined,
      nameKey: t.name_key ?? undefined,
      category: t.category ?? undefined,
      identity: t.identity ?? (t.meta ? { device: t.meta.device.name, category: t.meta.device.category, confidence: 1, visibleClues: [], question: null } : null),
      status: t.identity || t.meta ? "identified" : "new",
      hint: b.hint ?? t.hint,
    });
    startJob(id);
    return json({ id });
  } catch (e) {
    return fail(e);
  }
}
