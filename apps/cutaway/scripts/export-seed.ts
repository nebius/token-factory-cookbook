// Export ready teardowns from the local database to seed/<slug>.json so a fresh clone has them.
// Usage: pnpm seed:export [slug ...]   (no slugs = every ready device)
import fs from "node:fs";
import path from "node:path";
import { getBySlug, getDiagrams, getInput, getParts, getThumbnail, listLibrary } from "@/lib/db/teardowns";
import type { SeedFile } from "@/lib/db/seed";

const slugs = process.argv.slice(2);
const cards = listLibrary().filter((c) => !slugs.length || slugs.includes(c.slug));
fs.mkdirSync(path.join(process.cwd(), "seed"), { recursive: true });
for (const c of cards) {
  const t = getBySlug(c.slug)!;
  const input = getInput(t.id);
  const thumb = getThumbnail(t.id);
  const seed: SeedFile = {
    slug: t.slug,
    provider: t.provider ?? "unknown",
    model: t.model ?? "unknown",
    input: input?.image
      ? { kind: "image", imageBase64: input.image.toString("base64"), mime: input.mime ?? "image/jpeg" }
      : { kind: "text", text: input?.text ?? t.name ?? "" },
    meta: t.meta!,
    parts: getParts(t.id).map((p) => ({ id: p.part_id, code: p.code })),
    diagrams: getDiagrams(t.id),
    thumbnailBase64: thumb?.image.toString("base64"),
  };
  fs.writeFileSync(path.join("seed", `${t.slug}.json`), JSON.stringify(seed, null, 1));
  console.log(`exported ${t.slug} (v${t.version}, ${seed.parts.length} parts)`);
}
