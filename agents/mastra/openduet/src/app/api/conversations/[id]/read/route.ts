import { conversationParam, handle } from "@/lib/server/http";
import { markRead } from "@/lib/server/db";

export async function POST(_request: Request, ctx: RouteContext<"/api/conversations/[id]/read">) {
  const id = conversationParam((await ctx.params).id);
  return handle(() => markRead(id));
}
