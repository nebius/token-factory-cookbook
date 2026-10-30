import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AppStatus } from "@/lib/shared/types";

// The data folder is chosen at runtime, so keep the bundler from tracing it.
export const DATA_DIR = resolve(/*turbopackIgnore: true*/ process.env.OPENDUET_DATA_DIR || "./data");
export const WORKSPACES_DIR = resolve(DATA_DIR, "workspaces");
mkdirSync(WORKSPACES_DIR, { recursive: true });

const APP_DB_PATH = resolve(DATA_DIR, "openduet.db");

export const APP_DB_URL = `file:${APP_DB_PATH}`;
export const MASTRA_DB_URL = `file:${resolve(DATA_DIR, "mastra.db")}`;

/** The single local owner every bot thread belongs to. */
export const OWNER_ID = "owner";

export const keys = {
  nebius: () => Boolean(process.env.NEBIUS_API_KEY),
  tavily: () => Boolean(process.env.TAVILY_API_KEY),
  jev: () => Boolean(process.env.TYPESAFE_API_KEY),
  browserbase: () => Boolean(process.env.BROWSERBASE_API_KEY),
  composio: () => Boolean(process.env.COMPOSIO_API_KEY),
};

/** Without a Nebius key, bots run on a scripted local model so the UI still works. */
export const isMock = () => !keys.nebius();

export function appStatus(): AppStatus {
  return {
    mock: isMock(),
    keys: { nebius: keys.nebius(), tavily: keys.tavily(), jev: keys.jev(), browserbase: keys.browserbase(), composio: keys.composio() },
    dataDir: DATA_DIR,
  };
}
