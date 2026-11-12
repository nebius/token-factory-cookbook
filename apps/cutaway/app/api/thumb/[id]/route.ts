import { getThumbnail } from "@/lib/db/teardowns";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const t = getThumbnail(Number((await ctx.params).id));
  if (!t) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(t.image), { headers: { "Content-Type": t.mime, "Cache-Control": "no-cache" } });
}
