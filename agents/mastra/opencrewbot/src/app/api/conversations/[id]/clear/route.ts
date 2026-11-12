import { conversationParam, handle } from "@/lib/server/http";
import { clearConversation } from "@/lib/server/service";

export async function POST(_request: Request, ctx: RouteContext<"/api/conversations/[id]/clear">) {
  const id = conversationParam((await ctx.params).id);
  return handle(() => clearConversation(id));
}
