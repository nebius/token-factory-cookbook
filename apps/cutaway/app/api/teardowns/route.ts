import { createTeardown, findOpenByInputHash, findReadyByNameKey } from "@/lib/db/teardowns";
import { sha256 } from "@/lib/hash";
import { KimiError } from "@/lib/kimi/client";
import { body, fail, json } from "@/lib/server/http";
import { startJob } from "@/lib/jobs/runner";
import { nameKey } from "@/lib/slug";

const MAX_IMAGE = 8 * 1024 * 1024;

/**
 * Start (or find) a teardown from a photo or a device name. Nothing here calls the model:
 * a ready teardown for the same name opens directly, and an unfinished one for the same input resumes.
 */
export async function POST(req: Request) {
  try {
    const b = await body<{ text?: string; image?: string; hint?: string; force?: boolean }>(req);
    if (b.image) {
      const m = b.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) throw new KimiError("image must be a JPEG, PNG or WebP data URL", "config");
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > MAX_IMAGE) throw new KimiError("image is larger than 8 MB", "config");
      const hash = sha256(bytes);
      const open = b.force ? null : findOpenByInputHash(hash);
      if (open?.status === "ready") return json({ slug: open.slug, cached: true });
      if (open) {
        startJob(open.id);
        return json({ id: open.id, resumed: true });
      }
      const id = createTeardown({ slug: `draft-${hash.slice(0, 10)}-${Date.now()}`, inputKind: "image", inputHash: hash, image: bytes, mime: m[1], hint: b.hint ?? null });
      startJob(id);
      return json({ id });
    }
    const text = (b.text ?? "").trim().slice(0, 200);
    if (text.length < 2) throw new KimiError("type a device name or add a photo", "config");
    const key = nameKey(text);
    if (!b.force) {
      const ready = findReadyByNameKey(key);
      if (ready) return json({ slug: ready.slug, cached: true });
      const open = findOpenByInputHash(`text:${key}`);
      if (open) {
        startJob(open.id);
        return json({ id: open.id, resumed: true });
      }
    }
    const id = createTeardown({ slug: `draft-${key.slice(0, 24)}-${Date.now()}`, inputKind: "text", inputHash: `text:${key}`, text, name: text, nameKey: key, hint: b.hint ?? null });
    // The job runs on the server from here, whether or not anyone keeps the page open.
    startJob(id);
    return json({ id });
  } catch (e) {
    return fail(e);
  }
}
