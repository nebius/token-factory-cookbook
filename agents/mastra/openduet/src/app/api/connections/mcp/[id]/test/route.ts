import { handle } from "@/lib/server/http";
import { testServer } from "@/lib/server/mcp-servers";

export async function POST(_request: Request, ctx: RouteContext<"/api/connections/mcp/[id]/test">) {
  const { id } = await ctx.params;
  return handle(() => testServer(id));
}
