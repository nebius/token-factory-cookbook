import type { BotInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { deleteBot, updateBot } from "@/lib/server/service";

export async function PATCH(request: Request, ctx: RouteContext<"/api/bots/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => ({ bot: await updateBot(id, await body<Partial<BotInput>>(request)) }));
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/bots/[id]">) {
  const { id } = await ctx.params;
  return handle(() => deleteBot(id));
}
