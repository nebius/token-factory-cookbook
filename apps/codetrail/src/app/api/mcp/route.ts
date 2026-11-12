// The hosted MCP endpoint (Streamable HTTP, stateless): the same tools as `pnpm mcp`, no install needed.
//   claude mcp add --transport http codetrail https://<your-codetrail>/api/mcp
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { clientIp } from "@/server/http";
import { registerCodetrailTools } from "@/server/mcp-tools";

export const maxDuration = 300;

async function handle(req: Request) {
  const server = new McpServer({ name: "codetrail", version: "0.2.0" });
  registerCodetrailTools(server, `mcp:${clientIp(req)}`);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
