import { conversationParam, body, handle } from "@/lib/server/http";
import { listMessages, markRead } from "@/lib/server/db";
import { runningBots } from "@/lib/server/runtime";
import { sendMessage } from "@/lib/server/service";

export async function GET(_request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const messages = await listMessages(id);
    await markRead(id);
    return { messages, running: runningBots(id) };
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const { text } = await body<{ text: string }>(request);
    return { message: await sendMessage(id, String(text ?? "")) };
  });
}
