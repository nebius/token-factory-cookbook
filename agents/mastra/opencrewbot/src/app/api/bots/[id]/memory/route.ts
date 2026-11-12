import { body, handle } from "@/lib/server/http";
import { getBot } from "@/lib/server/db";
import { publish } from "@/lib/server/bus";
import { MEMORY_PROMPT_LIMIT, memoryPath, readMemory, writeMemory } from "@/lib/server/memory-files";
import { InputError } from "@/lib/server/service";

async function requireBot(id: string) {
  if (!(await getBot(id))) throw new InputError("That bot doesn't exist.");
}

export async function GET(_request: Request, ctx: RouteContext<"/api/bots/[id]/memory">) {
  const { id } = await ctx.params;
  return handle(async () => {
    await requireBot(id);
    return { content: readMemory(id), path: memoryPath(id), limit: MEMORY_PROMPT_LIMIT };
  });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/bots/[id]/memory">) {
  const { id } = await ctx.params;
  return handle(async () => {
    await requireBot(id);
    const { content } = await body<{ content: string }>(request);
    if (typeof content !== "string") throw new InputError("Expected { content }.");
    const saved = writeMemory(id, content);
    publish({ type: "memory-changed", botId: id });
    return { content: saved };
  });
}
