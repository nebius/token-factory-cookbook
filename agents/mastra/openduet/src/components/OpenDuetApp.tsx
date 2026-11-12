"use client";

import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";
import { api } from "@/lib/client/api";
import { notifyFor } from "@/lib/client/notify";
import { followSystemTheme } from "@/lib/client/theme";
import { initialState, reducer, type Action, type AppState } from "@/lib/client/store";
import type { ConversationId, ServerEvent } from "@/lib/shared/types";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { Inspector } from "./Inspector";
import { NewBotDrawer } from "./BotForms";
import { NewRoomDrawer } from "./RoomForms";
import { SettingsPanel } from "./SettingsPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { TasksPane } from "./TasksPane";

/** Modal sheets. Editing an existing bot or room happens in the inspector instead. */
export type Panel = { kind: "new-bot" } | { kind: "new-room" } | { kind: "settings" } | { kind: "connections" } | null;

/** Bots use details/memory/browser; rooms use members/settings. "tasks" swaps the
 * whole right pane for Tasks, in any chat. */
export type InspectorTab = "details" | "memory" | "browser" | "members" | "settings" | "tasks";
export interface InspectorState {
  open: boolean;
  tab: InspectorTab;
}

interface AppContext {
  state: AppState;
  dispatch: Dispatch<Action>;
  open: (id: ConversationId | null) => void;
  refresh: () => Promise<void>;
  setPanel: (panel: Panel) => void;
  inspector: InspectorState;
  setInspector: (next: InspectorState) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toast: (message: string) => void;
}

const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside OpenDuetApp");
  return ctx;
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable
  }
}

function recall<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

const isWide = () => window.matchMedia("(min-width: 1280px)").matches;

export function OpenDuetApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [panel, setPanel] = useState<Panel>(null);
  const [inspector, setInspectorState] = useState<InspectorState>({ open: false, tab: "details" });
  const [sidebarOpen, setSidebarState] = useState(true);
  const [toastText, setToastText] = useState<string | null>(null);
  const activeRef = useRef<ConversationId | null>(null);
  const botsRef = useRef(state.bots);
  useEffect(() => {
    activeRef.current = state.active;
    botsRef.current = state.bots;
  }, [state.active, state.bots]);

  // Layout preferences are read after mount so the server render stays stable.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage
    setInspectorState({ open: isWide() && recall("openduet:inspector", true), tab: recall<InspectorTab>("openduet:pane", "details") });
    setSidebarState(recall("openduet:sidebar", true));
  }, []);

  useEffect(() => followSystemTheme(), []);

  const setInspector = useCallback((next: InspectorState) => {
    setInspectorState(next);
    if (isWide()) remember("openduet:inspector", next.open);
    remember("openduet:pane", next.tab === "tasks" ? "tasks" : "details");
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarState(open);
    remember("openduet:sidebar", open);
  }, []);

  const toast = useCallback((message: string) => {
    setToastText(message);
    window.setTimeout(() => setToastText((t) => (t === message ? null : t)), 4000);
  }, []);

  const refresh = useCallback(async () => {
    const data = await api.bootstrap();
    dispatch({ type: "bootstrap", ...data });
  }, []);

  const loadTranscript = useCallback(
    async (id: ConversationId) => {
      try {
        const { messages, running } = await api.messages(id);
        dispatch({ type: "transcript", id, messages, running });
      } catch (error) {
        toast(error instanceof Error ? error.message : "Couldn't load messages.");
      }
    },
    [toast],
  );

  const open = useCallback(
    (id: ConversationId | null) => {
      dispatch({ type: "open", id });
      if (id) {
        void loadTranscript(id);
        if (window.location.hash !== `#${id}`) window.history.replaceState(null, "", `#${id}`);
      } else {
        window.history.replaceState(null, "", window.location.pathname);
      }
    },
    [loadTranscript],
  );

  // First load: data, then the conversation from the URL (or the first pinned bot on wide screens).
  useEffect(() => {
    (async () => {
      // Back from a Composio sign-in: say so, let bots reload their app tools, tidy the URL.
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("connected");
      if (connected) {
        const ok = params.get("status") !== "failed";
        toast(ok ? `${connected.charAt(0).toUpperCase()}${connected.slice(1)} connected. Switch it on for a bot in its Details.` : `Connecting ${connected} didn't finish.`);
        if (ok) void api.connectionsChanged().catch(() => {});
        window.history.replaceState(null, "", window.location.pathname + window.location.hash);
        setPanel({ kind: "connections" });
      }
      try {
        const data = await api.bootstrap();
        dispatch({ type: "bootstrap", ...data });
        const fromHash = decodeURIComponent(window.location.hash.slice(1));
        const ids = new Set(data.conversations.map((c) => c.id));
        if (fromHash && ids.has(fromHash)) open(fromHash);
        else if (window.matchMedia("(min-width: 768px)").matches) {
          const bot = data.bots.find((b) => b.pinned) ?? data.bots[0];
          const room = data.rooms.find((r) => r.pinned) ?? data.rooms[0];
          if (bot) open(`dm:${bot.id}`);
          else if (room) open(`room:${room.id}`);
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "Couldn't reach the server.");
      }
    })();
  }, [open, toast]);

  // One live stream for everything. After a drop, resync what we may have missed.
  useEffect(() => {
    let dropped = false;
    let refetch: number | undefined;
    const source = new EventSource("/api/events");
    source.onopen = () => {
      if (!dropped) return;
      dropped = false;
      void refresh();
      if (activeRef.current) void loadTranscript(activeRef.current);
    };
    source.onerror = () => {
      dropped = true;
    };
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as ServerEvent;
      dispatch({ type: "event", event });
      if (event.type === "message") {
        const name = botsRef.current.find((b) => b.id === event.message.botId)?.name ?? "A bot";
        notifyFor(event.message, name, activeRef.current, open);
      }
      if (event.type === "bots-changed" || event.type === "rooms-changed" || event.type === "routines-changed") {
        window.clearTimeout(refetch);
        refetch = window.setTimeout(() => void refresh(), 150);
      }
    };
    return () => source.close();
  }, [refresh, loadTranscript, open]);

  // Reading a conversation that gets new replies keeps it read on the server too.
  const activeUnreadMarker = state.active ? state.transcripts[state.active]?.length : 0;
  useEffect(() => {
    if (state.active && document.visibilityState === "visible") void api.read(state.active).catch(() => {});
  }, [state.active, activeUnreadMarker]);

  const value = useMemo(
    () => ({ state, dispatch, open, refresh, setPanel, inspector, setInspector, sidebarOpen, setSidebarOpen, toast }),
    [state, open, refresh, inspector, setInspector, sidebarOpen, setSidebarOpen, toast],
  );
  const showInspector = inspector.open && (Boolean(state.active) || inspector.tab === "tasks");

  return (
    <Ctx.Provider value={value}>
      <div className="flex h-full w-full bg-app">
        <div
          className={clsx(
            "h-full shrink-0 border-r border-line",
            state.active ? "hidden" : "flex w-full",
            sidebarOpen ? "md:flex md:w-[312px]" : "md:hidden",
          )}
        >
          <Sidebar />
        </div>
        <main className={clsx("relative h-full min-w-0 flex-1", state.active ? "flex" : "hidden md:flex")}>
          <ChatView />
        </main>
        {showInspector && (
          <>
            <button
              aria-label="Close details"
              className="fixed inset-0 z-30 bg-black/20 xl:hidden dark:bg-black/50"
              onClick={() => setInspector({ ...inspector, open: false })}
            />
            <div
              className={clsx(
                "fixed inset-y-0 right-0 z-30 w-full border-l border-line shadow-pop xl:static xl:z-auto xl:max-w-none xl:shadow-none",
                inspector.tab === "tasks" ? "max-w-[460px] xl:w-[440px]" : "max-w-[400px] xl:w-[380px]",
              )}
            >
              {inspector.tab === "tasks" ? <TasksPane /> : <Inspector />}
            </div>
          </>
        )}
      </div>
      {panel?.kind === "new-bot" && <NewBotDrawer onClose={() => setPanel(null)} />}
      {panel?.kind === "new-room" && <NewRoomDrawer onClose={() => setPanel(null)} />}
      {panel?.kind === "settings" && <SettingsPanel onClose={() => setPanel(null)} />}
      {panel?.kind === "connections" && <ConnectionsPanel onClose={() => setPanel(null)} />}
      {toastText && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-raised-2 px-4 py-2.5 text-[13.5px] text-ink shadow-pop ring-1 ring-line-strong"
        >
          {toastText}
        </div>
      )}
    </Ctx.Provider>
  );
}
