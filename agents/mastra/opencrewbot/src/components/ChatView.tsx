"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowUp, AtSign, Eraser, MonitorPlay, MoreHorizontal, NotebookPen, PanelLeft, PanelRight, Plus, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Bot, ChatMessage, Room } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { MessageItem } from "./Message";
import { Menu } from "./Sidebar";
import { BotAvatar, IconButton, RoomAvatar } from "./ui";

function useClear(conversationId: string) {
  const { dispatch, toast } = useApp();
  return async () => {
    if (!window.confirm("Clear this chat? The bots start a fresh thread. Their MEMORY.md is kept.")) return;
    try {
      await api.clear(conversationId);
      dispatch({ type: "cleared", id: conversationId });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't clear the chat.");
    }
  };
}

function TopBar({ bot, room, members, running }: { bot?: Bot; room?: Room; members: Bot[]; running: string[] }) {
  const { state, open, inspector, setInspector, sidebarOpen, setSidebarOpen } = useApp();
  const [menu, setMenu] = useState(false);
  const conversationId = bot ? `dm:${bot.id}` : `room:${room!.id}`;
  const clear = useClear(conversationId);
  const browserBotId = bot ? (state.liveViews[bot.id] ? bot.id : undefined) : [...running, ...members.map((m) => m.id)].find((id) => state.liveViews[id]);

  const toggleDetails = () => setInspector({ open: !inspector.open, tab: inspector.tab });
  const openTab = (tab: "details" | "memory" | "browser" | "members" | "settings") => setInspector({ open: true, tab });

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-2 bg-gradient-to-b from-app via-app/85 to-transparent px-3">
      <div className="pointer-events-auto flex items-center gap-1">
        <IconButton label="Back" className="md:hidden" onClick={() => open(null)}>
          <ArrowLeft size={18} />
        </IconButton>
        {!sidebarOpen && (
          <IconButton label="Show sidebar" className="hidden md:inline-flex" onClick={() => setSidebarOpen(true)}>
            <PanelLeft size={18} />
          </IconButton>
        )}
      </div>

      <div className="flex flex-1 justify-center">
        <button
          onClick={toggleDetails}
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-raised/90 py-1.5 pr-4 pl-1.5 ring-1 ring-line backdrop-blur transition-colors hover:bg-raised-2"
          title={inspector.open ? "Hide details" : "Show details"}
        >
          {bot ? <BotAvatar bot={bot} size={26} /> : <RoomAvatar colors={members.map((m) => m.color)} size={26} />}
          <span className="truncate text-[15px] font-medium">{bot?.name ?? room?.name}</span>
          {running.length > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-ok" title="Working" />}
        </button>
      </div>

      <div className="pointer-events-auto flex items-center gap-1">
        {browserBotId && (
          <button
            onClick={() => {
              if (bot) openTab("browser");
              else open(`dm:${browserBotId}`);
            }}
            className="flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[13px] font-medium text-[#8db4ff] ring-1 ring-accent/30 hover:bg-[rgb(52_120_246/0.22)]"
          >
            <MonitorPlay size={15} />
            <span className="hidden sm:inline">Watch the browser</span>
          </button>
        )}
        <div className="relative">
          <IconButton label="More" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={18} />
          </IconButton>
          {menu && (
            <Menu
              className="top-11 right-0"
              onClose={() => setMenu(false)}
              items={[
                ...(bot
                  ? [
                      { label: "Memory", icon: <NotebookPen size={15} />, onClick: () => openTab("memory") },
                      { label: "Browser", icon: <MonitorPlay size={15} />, onClick: () => openTab("browser") },
                    ]
                  : []),
                { label: "Clear chat", icon: <Eraser size={15} />, onClick: clear, danger: true },
              ]}
            />
          )}
        </div>
        {!inspector.open && (
          <IconButton label="Show details" onClick={() => openTab(bot ? "details" : "members")}>
            <PanelRight size={18} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function EmptyState({ bot, room, members, onPick }: { bot?: Bot; room?: Room; members: Bot[]; onPick: (text: string) => void }) {
  const suggestions = bot
    ? bot.tools.webSearch
      ? ["What's new in open-source LLMs this week?", "remember that I prefer short answers", "Compare three vector databases for a small app"]
      : ["Draft a short launch post for my project", "remember that I write in a casual tone", "ask me something"]
    : ["Plan a launch for next Friday", "@everyone introduce yourselves", "Research our top 3 competitors and draft a summary"];
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-6 pt-16 pb-8 text-center">
      {bot ? <BotAvatar bot={bot} size={84} /> : <RoomAvatar colors={members.map((m) => m.color)} size={84} />}
      <h2 className="mt-4 text-[22px] font-semibold tracking-tight">{bot?.name ?? room?.name}</h2>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-mute">{bot ? bot.description : room?.topic || "A group chat with your bots."}</p>
      {room && (
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          @mention a bot to choose who answers. Otherwise{" "}
          {room.responder === "auto" ? "Jev routes the message" : room.responder === "lead" ? "the lead answers" : "everyone answers"}.
        </p>
      )}
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full bg-raised px-4 py-2 text-[13.5px] text-ink ring-1 ring-line transition-colors hover:bg-raised-2"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function readDraft(conversationId: string): string {
  try {
    return sessionStorage.getItem(`draft:${conversationId}`) ?? "";
  } catch {
    return "";
  }
}

/** Keyed by conversation (and by a picked suggestion), so it starts fresh for each. */
function Composer({
  conversationId,
  name,
  members,
  running,
  prefill,
}: {
  conversationId: string;
  name: string;
  members: Bot[];
  running: boolean;
  prefill?: string;
}) {
  const { toast } = useApp();
  const [text, setText] = useState(() => prefill ?? readDraft(conversationId));
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [plusMenu, setPlusMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const clear = useClear(conversationId);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`draft:${conversationId}`, text);
      else sessionStorage.removeItem(`draft:${conversationId}`);
    } catch {
      // storage may be unavailable
    }
  }, [text, conversationId]);
  useEffect(() => {
    if (prefill) ref.current?.focus();
  }, [prefill]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const options = mention
    ? [...members, { id: "everyone", name: "everyone", handle: "everyone", title: "All members", color: "#8a8a8a" } as Bot].filter(
        (m) => m.handle.startsWith(mention.query.toLowerCase()) || m.name.toLowerCase().startsWith(mention.query.toLowerCase()),
      )
    : [];

  const updateMention = (value: string, caret: number) => {
    if (!members.length) return setMention(null);
    const match = value.slice(0, caret).match(/(^|\s)@([a-z0-9_-]*)$/i);
    setMention(match ? { query: match[2], start: caret - match[2].length - 1 } : null);
    setHighlight(0);
  };

  const pickMention = (handle: string) => {
    if (!mention) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    setText(`${text.slice(0, mention.start)}@${handle} ${text.slice(caret)}`);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + handle.length + 2;
      el?.setSelectionRange(pos, pos);
      el?.focus();
    });
  };

  const startMention = () => {
    const el = ref.current;
    const next = `${text}${text && !text.endsWith(" ") ? " " : ""}@`;
    setText(next);
    setMention({ query: "", start: next.length - 1 });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.length, next.length);
    });
  };

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await api.send(conversationId, value);
      setText("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send.");
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const stop = async () => {
    try {
      await api.stop(conversationId);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't stop.");
    }
  };

  return (
    <div className="shrink-0 px-4 pt-2 pb-4">
      <div className="relative mx-auto max-w-[780px]">
        {mention && options.length > 0 && (
          <ul role="listbox" aria-label="Mention a bot" className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl bg-raised p-1.5 shadow-pop ring-1 ring-line-strong">
            {options.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === highlight}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m.handle);
                  }}
                  className={clsx("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px]", i === highlight ? "bg-raised-2" : "hover:bg-raised-2")}
                >
                  <BotAvatar bot={m} size={26} />
                  <span className="font-medium">@{m.handle}</span>
                  <span className="truncate text-[12.5px] text-mute">{m.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2 rounded-[28px] bg-raised p-2 ring-1 ring-line transition focus-within:ring-line-strong">
          <div className="relative">
            <IconButton label="More actions" onClick={() => setPlusMenu((v) => !v)} className="bg-raised-2 text-ink">
              <Plus size={18} />
            </IconButton>
            {plusMenu && (
              <Menu
                className="bottom-12 left-0"
                onClose={() => setPlusMenu(false)}
                items={[
                  ...(members.length ? [{ label: "Mention a bot", icon: <AtSign size={15} />, onClick: startMention }] : []),
                  { label: "Clear chat", icon: <Eraser size={15} />, onClick: clear, danger: true },
                ]}
              />
            )}
          </div>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={`Message ${name}`}
            aria-label="Message"
            onChange={(e) => {
              setText(e.target.value);
              updateMention(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              if (mention && options.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  return setHighlight((h) => (h + 1) % options.length);
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  return setHighlight((h) => (h - 1 + options.length) % options.length);
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  return pickMention(options[highlight].handle);
                }
                if (e.key === "Escape") return setMention(null);
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className="max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-snug placeholder:text-faint focus:outline-none"
          />
          {running && (
            <IconButton label="Stop" onClick={stop} className="bg-raised-2 text-ink">
              <Square size={13} fill="currentColor" />
            </IconButton>
          )}
          <IconButton
            label="Send"
            onClick={send}
            disabled={!text.trim() || sending}
            className="bg-accent text-accent-ink hover:bg-accent-hover hover:text-accent-ink disabled:bg-raised-2 disabled:text-faint disabled:opacity-100"
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </IconButton>
        </div>
        {running && <p className="mt-2 text-center text-[12px] text-faint">Messages you send now wait until this reply finishes.</p>}
      </div>
    </div>
  );
}

function shouldShowAuthor(messages: ChatMessage[], i: number, isRoom: boolean): boolean {
  if (!isRoom) return false;
  const m = messages[i];
  if (m.role !== "bot") return false;
  const prev = messages[i - 1];
  return !prev || prev.role !== "bot" || prev.botId !== m.botId;
}

export function ChatView() {
  const { state, sidebarOpen, setSidebarOpen } = useApp();
  const [prefill, setPrefill] = useState<{ conversationId: string; text: string; n: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const id = state.active;
  const [kind, targetId] = id ? id.split(":") : [null, null];
  const bot = kind === "dm" ? state.bots.find((b) => b.id === targetId) : undefined;
  const room = kind === "room" ? state.rooms.find((r) => r.id === targetId) : undefined;
  const messages = useMemo(() => (id ? state.transcripts[id] : undefined), [id, state.transcripts]);
  const running = (id && state.summaries[id]?.running) || [];
  const members = room ? room.memberIds.map((m) => state.bots.find((b) => b.id === m)).filter((b): b is Bot => Boolean(b)) : [];

  useEffect(() => {
    pinnedToBottom.current = true;
  }, [id]);

  // Follow new output only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!id || (!bot && !room)) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
        {!sidebarOpen && (
          <IconButton label="Show sidebar" className="absolute top-3.5 left-3" onClick={() => setSidebarOpen(true)}>
            <PanelLeft size={18} />
          </IconButton>
        )}
        <p className="text-[17px] font-medium">{state.loaded ? "Pick a bot or a room" : "Loading…"}</p>
        {state.loaded && <p className="mt-1.5 max-w-sm text-[14px] text-mute">Every contact is an AI teammate with its own model, tools and memory.</p>}
      </div>
    );
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <TopBar bot={bot} room={room} members={members} running={running} />
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages === undefined ? (
          <p className="px-6 pt-24 text-center text-sm text-mute">Loading messages…</p>
        ) : messages.length === 0 ? (
          <EmptyState bot={bot} room={room} members={members} onPick={(text) => setPrefill((p) => ({ conversationId: id, text, n: (p?.n ?? 0) + 1 }))} />
        ) : (
          <div className="mx-auto max-w-[780px] space-y-4 px-4 pt-20 pb-6">
            {messages.map((m, i) => (
              <MessageItem key={m.id} message={m} bot={state.bots.find((b) => b.id === m.botId)} showAuthor={shouldShowAuthor(messages, i, Boolean(room))} />
            ))}
          </div>
        )}
      </div>
      <Composer
        key={`${id}:${prefill?.conversationId === id ? prefill.n : 0}`}
        conversationId={id}
        name={bot?.name ?? room?.name ?? ""}
        members={members}
        running={running.length > 0}
        prefill={prefill?.conversationId === id ? prefill.text : undefined}
      />
    </div>
  );
}
