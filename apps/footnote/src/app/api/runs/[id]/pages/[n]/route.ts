import { pageImage } from "@/lib/pages";
import { loadRun } from "@/lib/runs";

export const runtime = "nodejs";

// A page image; ?doc=B for the second document of a comparison.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const doc = new URL(req.url).searchParams.get("doc") === "B" ? "B" : "A";
  const run = /^[a-z0-9-]+$/.test(id) ? await loadRun(id) : null;
  const info = doc === "B" ? run?.docB : run?.doc;
  const page = Number(n);
  if (!run || !info || !Number.isInteger(page) || page < 1 || page > info.pages) return new Response("Not found", { status: 404 });
  try {
    const png = await pageImage(id, page, doc);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("Could not render this page", { status: 500 });
  }
}
