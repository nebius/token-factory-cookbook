// Codetrail's MCP server over stdio: lets a coding agent (Claude Code, Cursor, Codex…) get a repo's module map,
// a line-checked tour, a structured answer with follow-ups, or a reviewer's tour of a pull request. Same pipeline,
// cache and checks as the web app; everything is stored in SQLite, so repeats cost nothing.
// The hosted app serves the same tools at /api/mcp (Streamable HTTP).
//
//   pnpm mcp                                   (stdio; run from the repo, uses NEBIUS_API_KEY from .env)
//   claude mcp add codetrail -- pnpm --dir /path/to/codetrail -s mcp
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCodetrailTools } from "../src/server/mcp-tools.ts";

const server = new McpServer({ name: "codetrail", version: "0.3.0" });
registerCodetrailTools(server, "mcp-local");
await server.connect(new StdioServerTransport());
