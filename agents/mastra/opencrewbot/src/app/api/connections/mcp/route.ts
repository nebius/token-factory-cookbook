import { body, handle } from "@/lib/server/http";
import { addServer } from "@/lib/server/mcp-servers";
import { connectionsChanged } from "@/lib/server/connectors";

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body<{ name: string; url: string; token?: string; headers?: Record<string, string> }>(request);
    const server = await addServer(input);
    await connectionsChanged();
    return { server };
  });
}
