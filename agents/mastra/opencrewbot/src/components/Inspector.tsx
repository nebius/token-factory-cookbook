"use client";

import { ExternalLink, Pencil, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import type { Bot, Room } from "@/lib/shared/types";
import { BotForm, MemoryEditor } from "./BotForms";
import { ModelPicker } from "./ModelPicker";
import { RoomForm } from "./RoomForms";
import { useApp, type InspectorTab } from "./OpenCrewBotApp";
import { BotAvatar, Button, IconButton, Mascot, RoomAvatar, Tabs, Toggle } from "./ui";
import { useConnections } from "@/lib/client/use-connections";

function BrowserView({ bot }: { bot: Bot }) {
  const { state, toast } = useApp();
  const liveUrl = state.liveViews[bot.id];

  if (liveUrl) {
    return (
      <div className="space-y-2">
        <iframe
          src={liveUrl}
          title={`${bot.name}'s live browser`}
          sandbox="allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write"
          className="aspect-[4/3] w-full rounded-2xl bg-black ring-1 ring-line"
        />
        <div className="flex items-center justify-between gap-2 px-1 text-[12.5px] text-mute">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ok" /> Live. Click inside to take over.
          </span>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline">
            Open <ExternalLink size={12} />
          </a>
        </div>
      </div>
    );
  }

  const turnOn = async () => {
    try {
      await api.updateBot(bot.id, { tools: { ...bot.tools, browser: true } });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't turn the browser on.");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl bg-raised px-6 text-center">
        <div className="relative">
          <Mascot color="#8a8a8a" size={44} className="opacity-70" asleep />
          <span className="absolute -top-2 -right-3 text-[11px] font-semibold text-faint">z z</span>
        </div>
        <div>
          <p className="text-[14.5px] font-medium">{bot.tools.browser ? "Browser is asleep" : "Browser is off"}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-mute">
            {bot.tools.browser
              ? state.status?.keys.browserbase
                ? "It wakes up on Browserbase the first time this bot opens a page."
                : "Add BROWSERBASE_API_KEY to wake it."
              : "Turn it on to let this bot browse the web in a cloud browser."}
          </p>
        </div>
        {!bot.tools.browser && (
          <Button size="sm" onClick={turnOn}>
            Turn on
          </Button>
        )}
      </div>
      <p className="text-center text-[12.5px] text-faint">{bot.name}&apos;s browser</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-raised px-4 py-3.5">
      <h3 className="mb-1.5 text-[12.5px] font-medium text-faint">{title}</h3>
      {children}
    </section>
  );
}

const TOOL_LABELS: Record<keyof Bot["tools"], string> = {
  webSearch: "Web search",
  memory: "Memory",
  codeMode: "Code mode",
  browser: "Browser",
  askUser: "Asks questions",
};

/** Which connected apps and MCP servers this bot may use. */
function BotConnections({ bot }: { bot: Bot }) {
  const { state, setPanel, toast } = useApp();
  const { options, loading, data } = useConnections(state.connectionsVersion);
  const [saving, setSaving] = useState<string | null>(null);

  const toggle = async (id: string, on: boolean) => {
    setSaving(id);
    try {
      const connections = on ? [...bot.connections, id] : bot.connections.filter((c) => c !== id);
      await api.updateBot(bot.id, { connections });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't update connections.");
    } finally {
      setSaving(null);
    }
  };

  // Connections the bot still lists but that are gone (disconnected app) stay visible so they can be switched off.
  const known = new Set(options.map((o) => o.id));
  const stale = data ? bot.connections.filter((c) => !known.has(c)) : [];

  return (
    <Card title="Connections">
      {loading && <p className="text-[13px] text-mute">Loading…</p>}
      {!loading && options.length === 0 && stale.length === 0 && (
        <p className="text-[13.5px] leading-relaxed text-mute">No apps connected yet. Connect Slack, GitHub and more, then switch them on here.</p>
      )}
      {(options.length > 0 || stale.length > 0) && (
        <div className="-my-1 divide-y divide-line">
          {options.map((o) => (
            <Toggle
              key={o.id}
              label={o.name}
              hint={o.kind === "mcp" ? "MCP server" : "via Composio"}
              checked={bot.connections.includes(o.id)}
              disabled={saving === o.id}
              onChange={(v) => toggle(o.id, v)}
            />
          ))}
          {stale.map((id) => (
            <Toggle key={id} label={id.replace(/^composio:|^mcp:/, "")} hint="Not connected any more" checked disabled={saving === id} onChange={() => toggle(id, false)} />
          ))}
        </div>
      )}
      <button onClick={() => setPanel({ kind: "connections" })} className="mt-2.5 text-[12.5px] font-medium text-[#8db4ff] hover:underline">
        Manage connections
      </button>
    </Card>
  );
}

/** A calm summary of the bot; the full form only appears when you choose Edit. */
function BotDetails({ bot }: { bot: Bot }) {
  const { state, toast } = useApp();
  const [editing, setEditing] = useState(false);

  const switchModel = async (id: string) => {
    if (id === bot.model) return;
    try {
      await api.updateBot(bot.id, { model: id });
      toast(`${bot.name} now uses ${state.models.find((m) => m.id === id)?.label ?? id}, from its next reply.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't switch the model.");
    }
  };
  const tools = (Object.keys(TOOL_LABELS) as (keyof Bot["tools"])[]).filter((k) => bot.tools[k]);

  if (editing) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[14px] font-medium">Edit {bot.name}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
        <BotForm key={JSON.stringify(bot)} bot={bot} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <Card title="About">
        <p className="text-[14px] leading-relaxed">{bot.description || <span className="text-mute">No description yet.</span>}</p>
        {bot.instructions && <p className="mt-2 line-clamp-4 text-[13px] leading-relaxed text-mute">{bot.instructions}</p>}
      </Card>
      <section>
        <h3 className="mb-1.5 px-1 text-[12.5px] font-medium text-faint">Default model</h3>
        <ModelPicker value={bot.model} onChange={switchModel} />
        {state.status?.mock && <p className="mt-1.5 px-1 text-[12px] text-faint">Mock mode: replies use a scripted model until NEBIUS_API_KEY is set.</p>}
      </section>
      <Card title="Tools">
        {tools.length ? (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <span key={t} className="rounded-full bg-raised-2 px-2.5 py-1 text-[12.5px]">
                {TOOL_LABELS[t]}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[13.5px] text-mute">No tools. It only chats.</p>
        )}
        {bot.tools.browser && (
          <p className="mt-2.5 text-[12.5px] text-mute">{bot.approval === "full" ? "Full access: browses without asking." : "Asks before each browser action."}</p>
        )}
      </Card>
      <BotConnections bot={bot} />
      <Button className="mt-2 w-full" onClick={() => setEditing(true)}>
        <Pencil size={14} /> Edit details
      </Button>
    </div>
  );
}

function BotInspector({ bot, tab, setTab }: { bot: Bot; tab: InspectorTab; setTab: (t: InspectorTab) => void }) {
  const current = tab === "members" || tab === "settings" ? "details" : tab;
  return (
    <>
      <div className="flex flex-col items-center px-6 pt-2 pb-5 text-center">
        <BotAvatar bot={bot} size={76} />
        <h2 className="mt-3 text-[19px] font-semibold tracking-tight">{bot.name}</h2>
        <p className="mt-0.5 text-[13px] text-mute">
          {bot.title || "No role yet"} · @{bot.handle}
        </p>
        <div className="mt-4">
          <Tabs
            value={current}
            onChange={setTab}
            tabs={[
              { value: "details", label: "Details" },
              { value: "memory", label: "Memory" },
              { value: "browser", label: "Browser" },
            ]}
          />
        </div>
      </div>
      <div className="px-5 pb-6">
        {current === "details" && <BotDetails key={bot.id} bot={bot} />}
        {current === "memory" && <MemoryEditor bot={bot} />}
        {current === "browser" && <BrowserView bot={bot} />}
      </div>
    </>
  );
}

function RoomInspector({ room, tab, setTab }: { room: Room; tab: InspectorTab; setTab: (t: InspectorTab) => void }) {
  const { state, open } = useApp();
  const members = room.memberIds.map((id) => state.bots.find((b) => b.id === id)).filter((b): b is Bot => Boolean(b));
  const running = state.summaries[`room:${room.id}`]?.running ?? [];
  const current = tab === "settings" ? "settings" : "members";
  return (
    <>
      <div className="flex flex-col items-center px-6 pt-2 pb-5 text-center">
        <RoomAvatar colors={members.map((m) => m.color)} size={76} />
        <h2 className="mt-3 text-[19px] font-semibold tracking-tight">{room.name}</h2>
        <p className="mt-0.5 text-[13px] text-mute">{room.topic || `${members.length} bots`}</p>
        <div className="mt-4">
          <Tabs
            value={current}
            onChange={setTab}
            tabs={[
              { value: "members", label: "Members" },
              { value: "settings", label: "Settings" },
            ]}
          />
        </div>
      </div>
      <div className="px-5 pb-6">
        {current === "members" && (
          <ul className="space-y-1">
            {members.map((bot) => (
              <li key={bot.id}>
                <button
                  onClick={() => open(`dm:${bot.id}`)}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-hover"
                  title={`Message ${bot.name} directly`}
                >
                  <BotAvatar bot={bot} size={38} busy={running.includes(bot.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[14.5px] font-medium">
                      {bot.name}
                      {bot.id === room.leadId && <span className="rounded-full bg-raised-2 px-2 py-0.5 text-[11px] font-normal text-mute">lead</span>}
                    </span>
                    <span className="block truncate text-[13px] text-mute">{bot.title || bot.description}</span>
                  </span>
                </button>
              </li>
            ))}
            {members.length === 0 && <p className="px-3 py-6 text-center text-sm text-mute">No members yet. Add some in Settings.</p>}
          </ul>
        )}
        {current === "settings" && <RoomForm key={JSON.stringify(room)} room={room} />}
      </div>
    </>
  );
}

export function Inspector() {
  const { state, inspector, setInspector } = useApp();
  const [kind, id] = state.active ? state.active.split(":") : [null, null];
  const bot = kind === "dm" ? state.bots.find((b) => b.id === id) : undefined;
  const room = kind === "room" ? state.rooms.find((r) => r.id === id) : undefined;
  if (!bot && !room) return null;
  const setTab = (tab: InspectorTab) => setInspector({ open: true, tab });

  return (
    <aside aria-label="Details" className="flex h-full w-full flex-col bg-side">
      <div className="flex h-16 shrink-0 items-center justify-end px-3">
        <IconButton label="Close details" onClick={() => setInspector({ ...inspector, open: false })} className="bg-raised">
          <X size={17} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {bot && <BotInspector bot={bot} tab={inspector.tab} setTab={setTab} />}
        {room && <RoomInspector room={room} tab={inspector.tab} setTab={setTab} />}
      </div>
    </aside>
  );
}
