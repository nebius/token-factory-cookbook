// Cloud browsers on Browserbase. Each bot with the browser tool gets one
// session, created the first time it opens a page and released when its
// controller closes. The session's live view is published so the UI can show
// (and let you take over) exactly what the bot is doing.
import { publish } from "./bus";

const API = "https://api.browserbase.com/v1";

interface LiveSession {
  id: string;
  projectId: string;
  liveUrl: string | null;
}

const g = globalThis as unknown as { __openduetBrowserbase?: Map<string, LiveSession> };
const sessions = (g.__openduetBrowserbase ??= new Map());

function apiKey(): string {
  const key = process.env.BROWSERBASE_API_KEY;
  if (!key) throw new Error("The browser runs on Browserbase. Set BROWSERBASE_API_KEY in .env and restart the app.");
  return key;
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { "X-BB-API-Key": apiKey(), "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Browserbase ${res.status}: ${text.slice(0, 300) || res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Start a session for this bot and return its CDP WebSocket URL. */
export async function createSession(botId: string): Promise<string> {
  const minutes = Number(process.env.BROWSERBASE_SESSION_MINUTES || 15);
  const session = await call<{ id: string; projectId: string; connectUrl: string }>("/sessions", {
    method: "POST",
    body: {
      ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}),
      timeout: Math.min(Math.max(minutes, 1), 360) * 60,
      userMetadata: { app: "openduet", botId },
    },
  });
  sessions.set(botId, { id: session.id, projectId: session.projectId, liveUrl: null });
  return session.connectUrl;
}

/** Look up the live view once the browser is connected, and tell the UI. */
export async function announceLiveView(botId: string): Promise<void> {
  const session = sessions.get(botId);
  if (!session) return;
  try {
    const debug = await call<{ debuggerFullscreenUrl?: string }>(`/sessions/${session.id}/debug`);
    session.liveUrl = debug.debuggerFullscreenUrl ?? null;
  } catch {
    session.liveUrl = null;
  }
  publish({ type: "browser-session", botId, liveUrl: session.liveUrl });
}

/** End the bot's session so it stops billing. Safe to call when there is none. */
export async function releaseSession(botId: string): Promise<void> {
  const session = sessions.get(botId);
  if (!session) return;
  sessions.delete(botId);
  publish({ type: "browser-session", botId, liveUrl: null });
  await call(`/sessions/${session.id}`, { method: "POST", body: { projectId: session.projectId, status: "REQUEST_RELEASE" } }).catch(() => {});
}

/** botId → live view URL, for the bootstrap payload after a page reload. */
export function liveViews(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [botId, s] of sessions) if (s.liveUrl) out[botId] = s.liveUrl;
  return out;
}
