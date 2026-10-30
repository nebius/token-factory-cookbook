import { conversationParam, handle } from "@/lib/server/http";
import { stopConversation } from "@/lib/server/runtime";

export async function POST(_request: Request, ctx: RouteContext<"/api/conversations/[id]/stop">) {
  const id = conversationParam((await ctx.params).id);
  return handle(() => stopConversation(id));
}
