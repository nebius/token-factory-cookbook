// Redraw library pictures with the server renderer (no model calls). Useful after changing how thumbnails are framed.
// Usage: pnpm thumbnails [slug ...]   (no slugs = every ready device)
import { getBySlug, getParts, listLibrary, setThumbnail } from "@/lib/db/teardowns";
import { rasterViews } from "@/lib/render/raster";
import { buildOnServer } from "@/lib/sandbox/server";
import { THUMBNAIL, THUMBNAIL_SIZE } from "@/lib/viewer/frame";

const slugs = process.argv.slice(2);
for (const c of listLibrary().filter((c) => !slugs.length || slugs.includes(c.slug))) {
  const t = getBySlug(c.slug)!;
  const built = await buildOnServer(getParts(t.id).map((p) => ({ id: p.part_id, code: p.code })), t.meta!.device.sizeMm);
  const [img] = rasterViews(t.meta!, built, [THUMBNAIL], THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height, THUMBNAIL_SIZE.background);
  setThumbnail(t.id, Buffer.from(img.split(",")[1], "base64"), "image/jpeg");
  console.log(`redrew ${t.slug} (${built.filter((b) => b.ok).length}/${built.length} parts)`);
}
