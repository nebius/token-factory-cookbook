"use client";

import clsx from "clsx";
import { MoreHorizontal, PanelLeft, Pin, Plug, Plus, Search, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Bot, ConversationSummary, Room } from "@/lib/shared/types";
import { useApp } from "./OpenDuetApp";
import { BotAvatar, DuoMark, IconButton, Mascot, RoomAvatar } from "./ui";
import { NebiusLogo } from "./NebiusLogo";

type Row =
  | { kind: "room"; id: string; room: Room; summary?: ConversationSummary }
  | { kind: "bot"; id: string; bot: Bot; summary?: ConversationSummary };

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, onOutside]);
}

export function Menu({
  items,
  onClose,
  className,
}: {
  items: { label: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode }[];
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);
  return (
    <div ref={ref} role="menu" className={clsx("absolute z-40 min-w-48 rounded-2xl bg-raised p-1.5 shadow-pop ring-1 ring-line-strong", className)}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            item.onClick();
          }}
          className={clsx(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] hover:bg-raised-2",
            item.danger ? "text-danger" : "text-ink",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function RowItem({ row }: { row: Row }) {
  const { state, open, setInspector, toast } = useApp();
  const [menu, setMenu] = useState(false);
  const conversationId = `${row.kind === "room" ? "room" : "dm"}:${row.id}`;
  const active = state.active === conversationId;
  const summary = row.summary;
  const running = summary?.running ?? [];
  const name = row.kind === "room" ? row.room.name : row.bot.name;
  const pinned = row.kind === "room" ? row.room.pinned : row.bot.pinned;
  const memberColors =
    row.kind === "room" ? row.room.memberIds.map((id) => state.bots.find((b) => b.id === id)?.color).filter((c): c is string => Boolean(c)) : [];

  const runningNames = running.map((id) => state.bots.find((b) => b.id === id)?.name).filter(Boolean);
  const waiting = summary?.waiting?.[0];
  const preview = waiting
    ? waiting.kind === "approval"
      ? "Waiting for your OK"
      : "Has a question for you"
    : running.length
    ? row.kind === "room"
      ? `${runningNames.join(", ")} typing…`
      : "typing…"
    : summary?.lastMessage
      ? `${summary.lastMessage.author === "You" ? "You: " : row.kind === "room" ? `${summary.lastMessage.author}: ` : ""}${summary.lastMessage.text}`
      : row.kind === "room"
        ? `${row.room.memberIds.length} bots`
        : row.bot.title || row.bot.description;

  const togglePin = async () => {
    try {
      if (row.kind === "room") await api.updateRoom(row.id, { pinned: !pinned });
      else await api.updateBot(row.id, { pinned: !pinned });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't update.");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${name}? ${row.kind === "bot" ? "Its chat and MEMORY.md are deleted too." : "The room's chat is deleted too."}`)) return;
    try {
      if (row.kind === "room") await api.deleteRoom(row.id);
      else await api.deleteBot(row.id);
      if (active) open(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't delete.");
    }
  };

  const openWith = (tab: "details" | "memory" | "settings") => {
    open(conversationId);
    setInspector({ open: true, tab });
  };

  const items =
    row.kind === "room"
      ? [
          { label: pinned ? "Unpin" : "Pin to top", onClick: togglePin },
          { label: "Room settings", onClick: () => openWith("settings") },
          { label: "Delete room", onClick: remove, danger: true },
        ]
      : [
          { label: pinned ? "Unpin" : "Pin to top", onClick: togglePin },
          { label: "Edit profile", onClick: () => openWith("details") },
          { label: "Memory", onClick: () => openWith("memory") },
          { label: "Delete bot", onClick: remove, danger: true },
        ];

  return (
    <li className="group relative">
      <button
        onClick={() => open(conversationId)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        aria-current={active ? "page" : undefined}
        title={preview}
        className={clsx("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors", active ? "bg-active" : "hover:bg-hover")}
      >
        {row.kind === "room" ? <RoomAvatar colors={memberColors} size={22} /> : <BotAvatar bot={row.bot} size={22} />}
        <span className={clsx("min-w-0 flex-1 truncate text-[15px]", summary?.unread && !active ? "font-semibold text-ink" : "text-ink")}>{name}</span>
        <span className="flex shrink-0 items-center gap-1.5 transition-opacity group-hover:opacity-0">
          {pinned && <Pin size={11} className="rotate-45 text-faint" aria-label="Pinned" />}
          {waiting ? (
            <span className="h-2 w-2 rounded-full bg-warn" title="Needs input" />
          ) : running.length ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-ok" title="Working" />
          ) : !!summary?.unread && !active ? (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">
              {summary.unread}
            </span>
          ) : null}
        </span>
      </button>
      <IconButton
        label={`More for ${name}`}
        onClick={() => setMenu((m) => !m)}
        className="absolute top-1.5 right-1.5 h-7 w-7 bg-raised-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <MoreHorizontal size={15} />
      </IconButton>
      {menu && <Menu items={items} onClose={() => setMenu(false)} className="top-9 right-2" />}
    </li>
  );
}

/** The app's own row at the top: its mark and name. Opens Tasks, the view across every chat. */
function BrandRow() {
  const { state, inspector, setInspector } = useApp();
  const needsInput = Object.values(state.summaries).reduce((n, x) => n + (x.waiting?.length ?? 0), 0);
  const active = inspector.open && inspector.tab === "tasks";
  return (
    <button
      onClick={() => setInspector({ open: !active, tab: "tasks" })}
      title={active ? "Hide tasks" : "Show tasks"}
      className={clsx("mx-3 flex items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors", active ? "bg-active" : "bg-raised/60 hover:bg-hover")}
    >
      <DuoMark size={32} />
      <span className="min-w-0 flex-1 truncate text-[16px] font-medium">OpenDuet</span>
      {needsInput > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn px-1.5 text-[11px] font-semibold text-white" title="Needs input">
          {needsInput}
        </span>
      )}
    </button>
  );
}

function SectionHeader({ title, onAdd, addLabel }: { title: string; onAdd: () => void; addLabel: string }) {
  return (
    <li className="flex items-center justify-between px-2.5 pt-4 pb-1">
      <span className="text-[13.5px] text-mute">{title}</span>
      <IconButton label={addLabel} onClick={onAdd} className="h-7 w-7">
        <Plus size={16} />
      </IconButton>
    </li>
  );
}

/** Bottom bar: who powers the models, and the way to settings and keys. */
function SidebarFooter() {
  const { state, setPanel } = useApp();
  const status = state.status;
  const missing = status ? Object.values(status.keys).filter((on) => !on).length : 0;
  const settingsHint = status?.mock ? "Settings · mock mode until NEBIUS_API_KEY is set" : missing ? `Settings · ${missing} key${missing === 1 ? "" : "s"} not set` : "Settings";
  return (
    <div className="flex items-center gap-1 border-t border-line px-3 py-3">
      <a
        href="https://tokenfactory.nebius.com"
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-10 min-w-0 shrink items-center gap-2 rounded-xl px-3 ring-1 ring-line transition-colors hover:bg-hover hover:ring-line-strong"
        title="Models by Nebius Token Factory"
      >
        <span className="shrink-0 text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">Powered by</span>
        <NebiusLogo height={14} className="shrink-0" />
      </a>
      <IconButton label="Connections" onClick={() => setPanel({ kind: "connections" })} className="ml-auto">
        <Plug size={18} />
      </IconButton>
      <IconButton label={settingsHint} onClick={() => setPanel({ kind: "settings" })} className="relative">
        <Settings size={18} />
        {status && (status.mock || missing > 0) && (
          <span className={clsx("absolute top-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-side", status.mock ? "bg-warn" : "bg-faint")} />
        )}
      </IconButton>
    </div>
  );
}

export function Sidebar() {
  const { state, setPanel, setSidebarOpen } = useApp();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: Row[] = [
      ...state.bots.map((bot) => ({ kind: "bot" as const, id: bot.id, bot, summary: state.summaries[`dm:${bot.id}`] })),
      ...state.rooms.map((room) => ({ kind: "room" as const, id: room.id, room, summary: state.summaries[`room:${room.id}`] })),
    ];
    const matches = all.filter((r) => {
      if (!q) return true;
      const text = r.kind === "room" ? `${r.room.name} ${r.room.topic}` : `${r.bot.name} ${r.bot.title} ${r.bot.handle}`;
      return text.toLowerCase().includes(q);
    });
    const recency = (r: Row) => r.summary?.lastMessage?.createdAt ?? (r.kind === "room" ? r.room.createdAt : r.bot.createdAt);
    const isPinned = (r: Row) => (r.kind === "room" ? r.room.pinned : r.bot.pinned);
    return matches.sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || recency(b).localeCompare(recency(a)));
  }, [state.rooms, state.bots, state.summaries, query]);

  return (
    <nav aria-label="Bots and rooms" className="flex h-full w-full flex-col bg-side">
      <header className="flex h-16 shrink-0 items-center justify-end gap-1.5 px-3">
        <IconButton label="Hide sidebar" onClick={() => setSidebarOpen(false)} className="mr-auto hidden md:inline-flex">
          <PanelLeft size={18} />
        </IconButton>
        <IconButton
          label="Search"
          onClick={() => {
            setSearching((s) => !s);
            setQuery("");
          }}
          className={clsx("bg-raised", searching && "bg-raised-2 text-ink")}
        >
          <Search size={17} />
        </IconButton>
        <div className="relative">
          <IconButton label="New bot or room" onClick={() => setNewMenu((v) => !v)} className="bg-raised">
            <Plus size={19} />
          </IconButton>
          {newMenu && (
            <Menu
              className="top-11 right-0"
              onClose={() => setNewMenu(false)}
              items={[
                { label: "New bot", onClick: () => setPanel({ kind: "new-bot" }), icon: <Mascot color="#3b82f6" size={18} /> },
                { label: "New room", onClick: () => setPanel({ kind: "new-room" }), icon: <RoomAvatar colors={["#22c55e", "#f59e0b"]} size={18} /> },
              ]}
            />
          )}
        </div>
      </header>

      <BrandRow />
      {searching && (
        <div className="px-3 pb-2">
          <label className="flex h-10 items-center gap-2 rounded-full bg-raised px-3.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent">
            <Search size={15} className="text-faint" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearching(false)}
              placeholder="Search"
              aria-label="Search bots and rooms"
              className="min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery("")} className="text-faint hover:text-ink">
                <X size={14} />
              </button>
            )}
          </label>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!state.loaded && <p className="px-3 py-6 text-sm text-mute">Loading…</p>}
        {state.loaded && !query && <SectionHeader title="Bots" addLabel="New bot" onAdd={() => setPanel({ kind: "new-bot" })} />}
        {rows
          .filter((row) => query || row.kind === "bot")
          .map((row) => (
            <RowItem key={`${row.kind}:${row.id}`} row={row} />
          ))}
        {state.loaded && !query && <SectionHeader title="Rooms" addLabel="New room" onAdd={() => setPanel({ kind: "new-room" })} />}
        {!query &&
          rows
            .filter((row) => row.kind === "room")
            .map((row) => <RowItem key={`${row.kind}:${row.id}`} row={row} />)}
        {state.loaded && rows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-mute">{query ? "Nothing matches." : "No bots yet. Press + to make one."}</p>
        )}
      </ul>

      <SidebarFooter />
    </nav>
  );
}
