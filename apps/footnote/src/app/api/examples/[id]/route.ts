import sharp from "sharp";
import { exampleFile, listExamples } from "@/lib/examples";
import { renderPage } from "@/lib/pdf";

export const runtime = "nodejs";

// First page of a bundled example, as a small thumbnail for the start page.
const cache = new Map<string, Buffer>();

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ex = (await listExamples()).find((e) => e.id === id);
  if (!ex) return new Response("Not found", { status: 404 });
  if (!cache.has(id)) {
    const png = await renderPage(new Uint8Array(await exampleFile(ex.file)), 1, 480);
    cache.set(id, await sharp(png).jpeg({ quality: 80 }).toBuffer());
  }
  return new Response(new Uint8Array(cache.get(id)!), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
}
