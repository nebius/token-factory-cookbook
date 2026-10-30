// Turns a bot's chosen connections into tools: Composio apps share one
// session, and each MCP server gets its own client.
import type { ToolsInput } from "@mastra/core/agent";
import type { Bot } from "@/lib/shared/types";
import { composioTools } from "./composio";
import { getSetting, setSetting } from "./db";
import { publish } from "./bus";
import { listServers, mcpTools } from "./mcp-servers";
import { keys } from "./config";

const VERSION_KEY = "connections.version";

/** Changes whenever an app is connected or a server is added, so bots pick it up. */
export async function connectionsVersion(): Promise<number> {
  return (await getSetting<number>(VERSION_KEY)) ?? 0;
}

export async function connectionsChanged(): Promise<void> {
  await setSetting(VERSION_KEY, (await connectionsVersion()) + 1);
  publish({ type: "connections-changed" });
}

/** MCP server names by id, for labelling tool steps in chat. */
const g = globalThis as unknown as { __openduetMcpNames?: Map<string, string> };
export const mcpServerNames = (g.__openduetMcpNames ??= new Map());

export interface ConnectorToolset {
  tools: ToolsInput;
  capabilities: string[];
  close: () => Promise<void>;
}

const appName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export async function buildConnectorTools(bot: Bot, clientId: string): Promise<ConnectorToolset> {
  const composioSlugs = bot.connections.filter((c) => c.startsWith("composio:")).map((c) => c.slice("composio:".length));
  const mcpIds = bot.connections.filter((c) => c.startsWith("mcp:")).map((c) => c.slice("mcp:".length));
  const tools: ToolsInput = {};
  const capabilities: string[] = [];
  let close = async () => {};

  if (composioSlugs.length && keys.composio()) {
    try {
      Object.assign(tools, await composioTools(composioSlugs));
      capabilities.push(
        `Use the person's connected apps (${composioSlugs.map(appName).join(", ")}): find the right action with COMPOSIO_SEARCH_TOOLS, then run it with COMPOSIO_MULTI_EXECUTE_TOOL. Actions ask the person first unless you have full access. If an app isn't connected, tell them to connect it in Connections.`,
      );
    } catch (error) {
      capabilities.push(`Connected apps are switched on for you but couldn't load right now (${error instanceof Error ? error.message : "unknown error"}). Say so if asked.`);
    }
  } else if (composioSlugs.length) {
    capabilities.push("Connected apps are switched on for you, but no COMPOSIO_API_KEY is set, so you can't use them right now.");
  }

  if (mcpIds.length) {
    const servers = await listServers();
    for (const s of servers) mcpServerNames.set(s.id, s.name);
    const result = await mcpTools(mcpIds, clientId);
    Object.assign(tools, result.tools);
    close = result.close;
    const names = servers.filter((s) => mcpIds.includes(s.id)).map((s) => s.name);
    if (Object.keys(result.tools).length) {
      capabilities.push(`Use tools from ${names.join(", ")} (the mcp_* tools). Actions that change things ask the person first unless you have full access.`);
    }
    for (const e of result.errors) capabilities.push(`Couldn't connect to ${e}. Say so if asked.`);
  }

  return { tools, capabilities, close };
}
