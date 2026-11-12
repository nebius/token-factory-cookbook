import { deleteTeardown, getDiagrams, getParts, getTeardown, setThumbnail, updateTeardown } from "@/lib/db/teardowns";
import { finalize } from "@/lib/kimi/pipeline";
import { KimiError } from "@/lib/kimi/client";
import { body, fail, idParam, json } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Everything the generation screen needs to resume from wherever this teardown stopped. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = idParam((await ctx.params).id);
    const t = getTeardown(id);
    if (!t) return json({ error: "not found" }, 404);
    return json({ teardown: t, parts: getParts(id), diagrams: getDiagrams(id) });
  } catch (e) {
    return fail(e);
  }
}

type Patch =
  | { action: "hint"; hint: string }
  | { action: "finalize"; results: { id: string; ok: boolean; error?: string | null }[]; thumbnail?: string | null }
  | { action: "thumbnail"; thumbnail: string };

export async function PATCH(req: Request, ctx: Ctx) {
  let id: number | undefined;
  try {
    id = idParam((await ctx.params).id);
    const b = await body<Patch>(req);
    if (b.action === "hint") {
      updateTeardown(id, { hint: b.hint.slice(0, 300) });
      return json({ ok: true });
    }
    if (b.action === "finalize") {
      const t = finalize(id, { results: b.results, thumbnail: b.thumbnail });
      return json({ slug: t.slug, version: t.version });
    }
    if (b.action === "thumbnail") {
      const m = b.thumbnail.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
      if (!m) throw new KimiError("thumbnail must be a JPEG or PNG data URL", "config");
      setThumbnail(id, Buffer.from(m[2], "base64"), m[1]);
      return json({ ok: true });
    }
    throw new KimiError("unknown action", "config");
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    deleteTeardown(idParam((await ctx.params).id));
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
