import { conversationParam, body, handle } from "@/lib/server/http";
import { respondToApproval } from "@/lib/server/runtime";

export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/approval">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const { botId, toolCallId, approve } = await body<{ botId: string; toolCallId: string; approve: boolean }>(request);
    await respondToApproval(id, botId, toolCallId, Boolean(approve));
  });
}
