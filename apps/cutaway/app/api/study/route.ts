import { addProgress, setBookmark, setNote } from "@/lib/db/user";
import { KimiError } from "@/lib/kimi/client";
import { body, fail, json } from "@/lib/server/http";

type Body =
  | { slug: string; kind: "note"; partId?: string; body: string }
  | { slug: string; kind: "bookmark"; on: boolean }
  | { slug: string; kind: "progress"; partsOpened?: string[]; stepsDone?: number[]; quiz?: Record<string, number>; reset?: boolean; resetQuiz?: boolean };

/** Notes, bookmarks and study progress. Local only; never touches the model. */
export async function PUT(req: Request) {
  try {
    const b = await body<Body>(req);
    if (!b.slug) throw new KimiError("slug is required", "config");
    if (b.kind === "note") {
      setNote(b.slug, b.partId ?? "", String(b.body ?? "").slice(0, 20_000));
      return json({ ok: true });
    }
    if (b.kind === "bookmark") {
      setBookmark(b.slug, !!b.on);
      return json({ ok: true });
    }
    if (b.kind === "progress") return json(addProgress(b.slug, b));
    throw new KimiError("unknown kind", "config");
  } catch (e) {
    return fail(e);
  }
}
