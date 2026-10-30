import { conversationParam, body, handle } from "@/lib/server/http";
import { answerQuestion } from "@/lib/server/runtime";
import { InputError } from "@/lib/server/service";

export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/answer">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const { botId, toolCallId, answer } = await body<{ botId: string; toolCallId: string; answer: string }>(request);
    if (!String(answer ?? "").trim()) throw new InputError("Write an answer first.");
    await answerQuestion(id, botId, toolCallId, String(answer).trim());
  });
}
