// Connected apps through Composio: one key, OAuth handled by Composio, and
// hundreds of apps (Slack, GitHub, Gmail, Notion…). This install is one
// Composio "user"; every bot shares its connected accounts, and each bot only
// gets the apps you switch on for it.
import { randomUUID } from "node:crypto";
import { Composio } from "@composio/core";
import { MastraProvider } from "@composio/mastra";
import type { ToolsInput } from "@mastra/core/agent";
import type { ComposioApp } from "@/lib/shared/types";
import { getSetting, setSetting } from "./db";

/** Shown first in the Connections panel; search finds the rest. */
export const FEATURED_APPS = ["slack", "github", "gmail", "googlecalendar", "notion", "linear", "googledrive", "jira"];

const g = globalThis as unknown as { __opencrewbotComposio?: { key: string; client: Composio<MastraProvider> } };

function client(): Composio<MastraProvider> | null {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  if (g.__opencrewbotComposio?.key !== apiKey) {
    g.__opencrewbotComposio = { key: apiKey, client: new Composio({ apiKey, provider: new MastraProvider() }) };
  }
  return g.__opencrewbotComposio.client;
}

/** A stable id for this install, created once and kept in settings. */
async function userId(): Promise<string> {
  const existing = await getSetting<string>("composio.userId");
  if (existing) return existing;
  const id = `opencrewbot-${randomUUID()}`;
  await setSetting("composio.userId", id);
  return id;
}

function requireClient(): Composio<MastraProvider> {
  const c = client();
  if (!c) throw new Error("Set COMPOSIO_API_KEY in .env and restart the app to connect apps.");
  return c;
}

/** Apps with their connection state. With a search term, searches Composio's whole catalog. */
export async function listApps(search?: string): Promise<ComposioApp[]> {
  const c = requireClient();
  const session = await c.create(await userId(), { manageConnections: false });
  const result = await session.toolkits(search ? { search, limit: 20 } : { toolkits: FEATURED_APPS, limit: FEATURED_APPS.length });
  const apps = result.items.map((t) => ({
    slug: t.slug,
    name: t.name,
    logo: t.logo,
    connected: Boolean(t.connection?.isActive),
  }));
  if (search) return apps;
  // Keep the featured order, then anything else already connected.
  const connected = await c.connectedAccounts.list({ userIds: [await userId()], statuses: ["ACTIVE"] });
  const extra = connected.items.map((a) => a.toolkit.slug).filter((slug) => !FEATURED_APPS.includes(slug));
  const extraApps = extra.length
    ? (await session.toolkits({ toolkits: [...new Set(extra)], limit: extra.length })).items.map((t) => ({
        slug: t.slug,
        name: t.name,
        logo: t.logo,
        connected: true,
      }))
    : [];
  return [...apps.sort((a, b) => FEATURED_APPS.indexOf(a.slug) - FEATURED_APPS.indexOf(b.slug)), ...extraApps];
}

/** Start the sign-in flow for an app. Composio sends the person back to `callbackUrl`. */
export async function connectApp(slug: string, callbackUrl: string): Promise<string> {
  const c = requireClient();
  const session = await c.create(await userId(), { manageConnections: false });
  const request = await session.authorize(slug, { callbackUrl });
  if (!request.redirectUrl) throw new Error(`Composio didn't return a sign-in link for ${slug}.`);
  return request.redirectUrl;
}

/** Remove every connected account this install has for an app. */
export async function disconnectApp(slug: string): Promise<void> {
  const c = requireClient();
  const accounts = await c.connectedAccounts.list({ userIds: [await userId()], toolkitSlugs: [slug] });
  for (const account of accounts.items) await c.connectedAccounts.delete(account.id);
}

/** Tools for the given apps, as one Composio session. Composio exposes a small set of
 * meta tools (search, then execute) instead of every action, which keeps the tool
 * list short enough for open models. */
export async function composioTools(slugs: string[]): Promise<ToolsInput> {
  const c = client();
  if (!c || slugs.length === 0) return {};
  const session = await c.create(await userId(), { toolkits: slugs, manageConnections: false });
  return (await session.tools()) as unknown as ToolsInput;
}
