import { getInput } from "@/lib/db/teardowns";

/** The photo a teardown was made from. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const input = getInput(Number((await ctx.params).id));
  if (!input?.image) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(input.image), { headers: { "Content-Type": input.mime ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
