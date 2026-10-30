// Client state: one reducer folds the bootstrap payload, transcript loads and
// the live SSE events into what the UI renders.
import type { AppStatus, Bot, ChatMessage, ConversationId, ConversationSummary, ModelOption, Room, ServerEvent } from "@/lib/shared/types";
import { messagePreview } from "./format";

export interface AppState {
  loaded: boolean;
  status: AppStatus | null;
  bots: Bot[];
  rooms: Room[];
  models: ModelOption[];
  summaries: Record<ConversationId, ConversationSummary>;
  /** Transcripts loaded so far, keyed by conversation. */
  transcripts: Record<ConversationId, ChatMessage[]>;
  active: ConversationId | null;
  /** Bumped when a bot's MEMORY.md changes, so an open memory editor can refresh. */
  memoryVersion: Record<string, number>;
  /** Finished bot replies already counted toward unread badges. */
  counted: Record<string, true>;
  /** botId → Browserbase live view of that bot's open browser. */
  liveViews: Record<string, string>;
  /** Bumped when apps or MCP servers change, so views refetch them. */
  connectionsVersion: number;
}

export const initialState: AppState = {
  loaded: false,
  status: null,
  bots: [],
  rooms: [],
  models: [],
  summaries: {},
  transcripts: {},
  active: null,
  memoryVersion: {},
  counted: {},
  liveViews: {},
  connectionsVersion: 0,
};

export type Action =
  | {
      type: "bootstrap";
      status: AppStatus;
      bots: Bot[];
      rooms: Room[];
      models: ModelOption[];
      conversations: ConversationSummary[];
      liveViews: Record<string, string>;
    }
  | { type: "open"; id: ConversationId | null }
  | { type: "models"; models: ModelOption[] }
  | { type: "transcript"; id: ConversationId; messages: ChatMessage[]; running: string[] }
  | { type: "cleared"; id: ConversationId }
  | { type: "event"; event: ServerEvent };

function upsert(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === message.id);
  if (i === -1) return [...list, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = list.slice();
  next[i] = message;
  return next;
}

function touchSummary(state: AppState, message: ChatMessage, isNewReply: boolean): Record<ConversationId, ConversationSummary> {
  const prev = state.summaries[message.conversationId] ?? { id: message.conversationId, running: [], unread: 0 };
  const author = message.role === "user" ? "You" : (state.bots.find((b) => b.id === message.botId)?.name ?? "Bot");
  const unread = state.active === message.conversationId ? 0 : prev.unread + (isNewReply ? 1 : 0);
  const text = messagePreview(message);
  return {
    ...state.summaries,
    [message.conversationId]: {
      ...prev,
      unread,
      lastMessage: text || !prev.lastMessage ? { text, createdAt: message.createdAt, author } : prev.lastMessage,
    },
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "bootstrap": {
      const summaries: Record<ConversationId, ConversationSummary> = {};
      for (const s of action.conversations) summaries[s.id] = s;
      return {
        ...state,
        loaded: true,
        status: action.status,
        bots: action.bots,
        rooms: action.rooms,
        models: action.models,
        summaries,
        liveViews: action.liveViews,
      };
    }
    case "models":
      return { ...state, models: action.models };
    case "open": {
      if (!action.id) return { ...state, active: null };
      const prev = state.summaries[action.id];
      return {
        ...state,
        active: action.id,
        summaries: prev ? { ...state.summaries, [action.id]: { ...prev, unread: 0 } } : state.summaries,
      };
    }
    case "transcript": {
      const prev = state.summaries[action.id] ?? { id: action.id, running: [], unread: 0 };
      return {
        ...state,
        transcripts: { ...state.transcripts, [action.id]: action.messages },
        summaries: { ...state.summaries, [action.id]: { ...prev, running: action.running } },
      };
    }
    case "cleared": {
      const prev = state.summaries[action.id];
      return {
        ...state,
        transcripts: { ...state.transcripts, [action.id]: [] },
        summaries: prev ? { ...state.summaries, [action.id]: { ...prev, lastMessage: undefined, unread: 0 } } : state.summaries,
      };
    }
    case "event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: AppState, event: ServerEvent): AppState {
  switch (event.type) {
    case "message": {
      const { message } = event;
      const list = state.transcripts[message.conversationId];
      const isNewReply = message.role === "bot" && message.status !== "streaming" && !state.counted[message.id];
      return {
        ...state,
        transcripts: list ? { ...state.transcripts, [message.conversationId]: upsert(list, message) } : state.transcripts,
        summaries: touchSummary(state, message, isNewReply),
        counted: isNewReply ? { ...state.counted, [message.id]: true } : state.counted,
      };
    }
    case "delta": {
      const list = state.transcripts[event.conversationId];
      if (!list) return state;
      const i = list.findIndex((m) => m.id === event.messageId);
      if (i === -1) return state;
      const message = list[i];
      const part = message.parts[event.partIndex];
      if (!part || (part.kind !== "text" && part.kind !== "reasoning")) return state;
      const parts = message.parts.slice();
      parts[event.partIndex] = { ...part, text: part.text + event.delta };
      const next = list.slice();
      next[i] = { ...message, parts };
      return { ...state, transcripts: { ...state.transcripts, [event.conversationId]: next } };
    }
    case "running": {
      const prev = state.summaries[event.conversationId] ?? { id: event.conversationId, running: [], unread: 0 };
      return { ...state, summaries: { ...state.summaries, [event.conversationId]: { ...prev, running: event.botIds } } };
    }
    case "memory-changed":
      return { ...state, memoryVersion: { ...state.memoryVersion, [event.botId]: (state.memoryVersion[event.botId] ?? 0) + 1 } };
    case "browser-session": {
      const liveViews = { ...state.liveViews };
      if (event.liveUrl) liveViews[event.botId] = event.liveUrl;
      else delete liveViews[event.botId];
      return { ...state, liveViews };
    }
    case "connections-changed":
      return { ...state, connectionsVersion: state.connectionsVersion + 1 };
    case "bots-changed":
    case "rooms-changed":
      // The provider refetches the bootstrap payload for these.
      return state;
  }
}
