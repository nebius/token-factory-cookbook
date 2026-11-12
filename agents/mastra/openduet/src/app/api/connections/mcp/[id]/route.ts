import { handle } from "@/lib/server/http";
import { removeServer } from "@/lib/server/mcp-servers";
import { connectionsChanged } from "@/lib/server/connectors";
import { listBots, saveBot } from "@/lib/server/db";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/connections/mcp/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => {
    await removeServer(id);
    // Bots that used this server stop listing it.
    for (const bot of await listBots()) {
      if (bot.connections.includes(`mcp:${id}`)) await saveBot({ ...bot, connections: bot.connections.filter((c) => c !== `mcp:${id}`) });
    }
    await connectionsChanged();
  });
}
