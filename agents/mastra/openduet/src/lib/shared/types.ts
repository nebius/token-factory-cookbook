// Types shared by the server and the browser. Everything here is plain JSON.

export type ApprovalMode = "ask" | "full";

export interface BotTools {
  /** Tavily search, extract and crawl. */
  webSearch: boolean;
  /** Read and update the bot's MEMORY.md. */
  memory: boolean;
  /** Let the model write one TypeScript function that calls several tools at once. */
  codeMode: boolean;
  /** A real browser (Playwright) the bot can drive. */
  browser: boolean;
  /** The bot may stop and ask you a question with a card in chat. */
  askUser: boolean;
}

/** What a bot does on its own, without being asked. */
export interface ProactiveSettings {
  /** Post a daily brief in the bot's chat. */
  brief: boolean;
  /** Local time for the brief, "HH:MM". */
  briefAt: string;
  /** Hours between quiet check-ins on connected apps; 0 is off. */
  checkEveryHours: number;
  /** What the person wants to hear about, in their words. */
  watchFor: string;
}

export interface Bot {
  id: string;
  name: string;
  /** Lowercase handle used for @mentions in rooms. */
  handle: string;
  title: string;
  description: string;
  instructions: string;
  emoji: string;
  color: string;
  model: string;
  tools: BotTools;
  /** Connection ids this bot may use: `composio:<toolkit>` or `mcp:<serverId>`. */
  connections: string[];
  approval: ApprovalMode;
  proactive: ProactiveSettings;
  pinned: boolean;
  createdAt: string;
}

export type BotInput = Omit<Bot, "id" | "createdAt" | "handle" | "connections" | "proactive"> & {
  handle?: string;
  connections?: string[];
  proactive?: Partial<ProactiveSettings>;
};

/** A bot's own scheduled work: the daily brief, or a check-in on its apps. */
export type RoutineKind = "brief" | "check";

/** When a bot's next brief or check-in is due, for the Tasks view's Up next tab. */
export interface UpcomingRoutine {
  botId: string;
  kind: RoutineKind;
  /** ISO time. Can be in the past by up to a minute, when it's about to start. */
  at: string;
}

export type RoomResponder = "auto" | "lead" | "everyone";

export interface Room {
  id: string;
  name: string;
  topic: string;
  emoji: string;
  memberIds: string[];
  leadId: string | null;
  responder: RoomResponder;
  pinned: boolean;
  createdAt: string;
}

export type RoomInput = Omit<Room, "id" | "createdAt">;

/** `dm:<botId>` or `room:<roomId>`. */
export type ConversationId = string;

export interface Source {
  title: string;
  url: string;
}

/** One action as it will run: its name (when a call runs several) and every field. */
export interface ActionDetail {
  action?: string;
  fields: { name: string; value: string }[];
}

export type ToolStatus = "running" | "awaiting-approval" | "done" | "error" | "denied";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      toolCallId: string;
      name: string;
      label: string;
      detail?: string;
      status: ToolStatus;
      /** For an approval: exactly what each action will send, every field in full. */
      what?: ActionDetail[];
      preview?: string;
      sources?: Source[];
    }
  | {
      kind: "question";
      toolCallId: string;
      question: string;
      options: { label: string; description?: string }[];
      answer?: string;
    };

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

export interface RouteNote {
  by: "mention" | "jev" | "lead" | "everyone" | "handoff" | RoutineKind;
  confidence?: number;
  /** A scheduled check-in that found something that needs the person. */
  found?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: ConversationId;
  role: "user" | "bot" | "notice";
  botId?: string;
  createdAt: string;
  status: MessageStatus;
  parts: Part[];
  model?: string;
  usage?: { input: number; output: number; costUsd: number | null };
  route?: RouteNote;
  error?: string;
}

/** Something you decided: an approval you gave or turned down, or a question you answered. */
export interface ResolvedTask {
  id: string;
  conversationId: ConversationId;
  botId: string;
  label: string;
  detail?: string;
  outcome: "approved" | "declined" | "answered";
  at: string;
}

/** A turn parked on the person: an approval or a question. */
export interface WaitingItem {
  messageId: string;
  botId: string;
  /** "Slack: send message", or the question asked. */
  label: string;
  kind: "approval" | "question";
}

export interface ConversationSummary {
  id: ConversationId;
  lastMessage?: { text: string; createdAt: string; author: string };
  running: string[];
  unread: number;
  /** Approvals and questions waiting on the person here. */
  waiting?: WaitingItem[];
}

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  context: number;
  tools: boolean;
  reasoning: boolean;
  vision: boolean;
  inputPerM: number | null;
  outputPerM: number | null;
  live: boolean;
}

export interface AppStatus {
  mock: boolean;
  keys: { nebius: boolean; tavily: boolean; jev: boolean; browserbase: boolean; composio: boolean };
  dataDir: string;
}

/** Events the server pushes to the browser over one SSE stream. */
export type ServerEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "delta"; conversationId: ConversationId; messageId: string; partIndex: number; kind: "text" | "reasoning"; delta: string }
  | { type: "running"; conversationId: ConversationId; botIds: string[] }
  | { type: "bots-changed" }
  | { type: "rooms-changed" }
  | { type: "memory-changed"; botId: string }
  /** A bot's Browserbase live view opened (url) or closed (null). */
  | { type: "browser-session"; botId: string; liveUrl: string | null }
  | { type: "connections-changed" }
  /** A brief or check-in started, so the Up next times moved. */
  | { type: "routines-changed" };

/** An app from Composio's catalog, with this install's connection state. */
export interface ComposioApp {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
}

/** A remote MCP server you added. The token never leaves the server. */
export interface McpServer {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
  headerNames: string[];
}

export interface ConnectionsState {
  composio: { enabled: boolean; apps: ComposioApp[]; error?: string };
  mcpServers: McpServer[];
}

/** Something a bot can be given access to. */
export interface ConnectionOption {
  id: string;
  name: string;
  kind: "composio" | "mcp";
  logo?: string;
}
