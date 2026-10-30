import type { RoutineKind } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { runRoutineNow } from "@/lib/server/proactive";

/** Run a brief or check-in now. The reply streams into the bot's chat. */
export async function POST(request: Request, ctx: RouteContext<"/api/bots/[id]/routine">) {
  const { id } = await ctx.params;
  return handle(async () => {
    const { kind } = await body<{ kind: RoutineKind }>(request);
    await runRoutineNow(id, kind);
  });
}
