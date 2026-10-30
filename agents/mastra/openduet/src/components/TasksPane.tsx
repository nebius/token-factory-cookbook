"use client";

import clsx from "clsx";
import { Check, CheckCircle2, CircleDot, Hand, Loader2, Radar, Sun, X, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import type { ConversationId, ConversationSummary, ResolvedTask } from "@/lib/shared/types";
import { useApp } from "./OpenDuetApp";
import { BotAvatar, IconButton, RoomAvatar } from "./ui";

type Tab = "active" | "next" | "scheduled" | "resolved";

/** What needs you, what's ready to read and what's running, across every chat. */
export function taskGroups(summaries: Record<ConversationId, ConversationSummary>, known: Set<string>) {
  const list = Object.values(summaries).filter((s) => known.has(s.id));
  const waiting = (s: ConversationSummary) => (s.waiting?.length ?? 0) > 0;
  return {
    needsInput: list.flatMap((s) => (s.waiting ?? []).map((w) => ({ conversationId: s.id, item: w }))),
    working: list.filter((s) => s.running.length > 0 && !waiting(s)),
    ready: list.filter((s) => s.unread > 0 && s.running.length === 0 && !waiting(s)),
  };
}

/** Count of things waiting on you, for the header's Tasks button. */
export function useNeedsInputCount(): number {
  const { state } = useApp();
  return Object.values(state.summaries).reduce((n, s) => n + (s.waiting?.length ?? 0), 0);
}

function Row({ icon, children, onClick, action }: { icon: ReactNode; children: ReactNode; onClick?: () => void; action?: ReactNode }) {
  return (
    <li className="group flex items-center gap-1">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-hover">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-mute">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink">{children}</span>
      </button>
      {action}
    </li>
  );
}

function Group({ title, count, icon, children }: { title: string; count: number; icon?: ReactNode; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="mt-4 first:mt-1">
      <h3 className="flex items-center gap-2 px-2.5 pb-1 text-[14.5px] font-medium text-ink">
        {icon}
        {title} <span className="font-normal text-faint">{count}</span>
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

/** Long groups show three items, then "Show N more". */
function Clamp<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <>
      {shown.map(render)}
      {items.length > 3 && !all && (
        <li>
          <button onClick={() => setAll(true)} className="ml-12 py-2 text-[14px] text-mute hover:text-ink">
            Show {items.length - 3} more
          </button>
        </li>
      )}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-6 pt-16 text-center text-[14px] leading-relaxed text-mute">{children}</p>;
}

function when(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (minutes <= 1) return "any minute";
  if (minutes < 60) return `in ${minutes} min`;
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (at.toDateString() === now.toDateString()) return `today, ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow, ${time}`;
  return `${at.toLocaleDateString([], { weekday: "long" })}, ${time}`;
}

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The right-hand Tasks pane. */
export function TasksPane() {
  const { state, dispatch, open, inspector, setInspector, toast } = useApp();
  const [tab, setTab] = useState<Tab>("active");
  const [resolved, setResolved] = useState<ResolvedTask[] | null>(null);
  const [ticked, setTicked] = useState<Record<string, true>>({});

  const conversations = new Map<string, { name: string; avatar: ReactNode }>([
    ...state.bots.map((b) => [`dm:${b.id}`, { name: b.name, avatar: <BotAvatar bot={b} size={20} /> }] as const),
    ...state.rooms.map(
      (r) =>
        [
          `room:${r.id}`,
          { name: r.name, avatar: <RoomAvatar colors={r.memberIds.map((id) => state.bots.find((b) => b.id === id)?.color ?? "#888").slice(0, 2)} size={20} /> },
        ] as const,
    ),
  ]);
  const botName = (id: string) => state.bots.find((b) => b.id === id)?.name ?? "A bot";
  const { needsInput, working, ready } = taskGroups(state.summaries, new Set(conversations.keys()));
  const upcoming = state.routines.filter((r) => state.bots.some((b) => b.id === r.botId));
  const scheduled = state.bots.flatMap((b) => [
    ...(b.proactive.brief ? [{ bot: b, kind: "brief" as const, text: `Morning brief, every day at ${clock(b.proactive.briefAt)}` }] : []),
    ...(b.proactive.checkEveryHours
      ? [{ bot: b, kind: "check" as const, text: `Check in every ${b.proactive.checkEveryHours === 1 ? "hour" : `${b.proactive.checkEveryHours} hours`}` }]
      : []),
  ]);

  // Resolved comes from the server; refresh it whenever something stops waiting on you.
  const waitingKey = needsInput.map((n) => n.item.messageId).join(",");
  useEffect(() => {
    if (tab !== "resolved") return;
    let cancelled = false;
    api
      .resolvedTasks()
      .then(({ tasks }) => !cancelled && setResolved(tasks))
      .catch((error) => toast(error instanceof Error ? error.message : "Couldn't load resolved tasks."));
    return () => {
      cancelled = true;
    };
  }, [tab, waitingKey, toast]);

  // Only you can say something is done: ticking marks its new replies as read.
  const review = async (id: ConversationId) => {
    setTicked((t) => ({ ...t, [id]: true }));
    try {
      await api.read(id);
      window.setTimeout(() => dispatch({ type: "reviewed", id }), 350);
    } catch (error) {
      setTicked((t) => {
        const next = { ...t };
        delete next[id];
        return next;
      });
      toast(error instanceof Error ? error.message : "Couldn't mark that done.");
    }
  };

  // Ready and working items, grouped by the chat they're in.
  const byConversation = [...new Set([...ready, ...working].map((s) => s.id))].map((id) => ({
    id,
    ready: ready.find((s) => s.id === id),
    working: working.find((s) => s.id === id),
  }));

  return (
    <aside aria-label="Tasks" className="flex h-full w-full flex-col bg-side">
      <header className="flex h-16 shrink-0 items-center justify-between px-5">
        <h2 className="text-[17px] font-semibold">Tasks</h2>
        <IconButton label="Close tasks" onClick={() => setInspector({ ...inspector, open: false })}>
          <X size={18} />
        </IconButton>
      </header>
      <div role="tablist" className="flex shrink-0 gap-1 px-3.5 pb-2">
        {(
          [
            ["active", "Active"],
            ["next", "Up next"],
            ["scheduled", "Scheduled"],
            ["resolved", "Resolved"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx(
              "rounded-lg px-2.5 py-1.5 text-[14.5px] transition-colors",
              tab === value ? "bg-raised font-medium text-ink" : "text-mute hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-6">
        {tab === "active" && (
          <>
            <Group title="Needs input" count={needsInput.length}>
              <Clamp
                items={needsInput}
                render={({ conversationId, item }) => (
                  <Row key={item.messageId} icon={<Hand size={14} />} onClick={() => open(conversationId)}>
                    {botName(item.botId)}: {item.label}
                  </Row>
                )}
              />
            </Group>
            {byConversation.map(({ id, ready: r, working: w }) => {
              const c = conversations.get(id);
              const items = [w, r].filter(Boolean);
              return (
                <Group key={id} title={c?.name ?? "Chat"} count={items.length} icon={c?.avatar}>
                  {w && (
                    <Row icon={<Loader2 size={14} className="animate-spin" />} onClick={() => open(id)}>
                      <span className="text-mute">Working: </span>
                      {w.running.map(botName).join(", ")} on it
                    </Row>
                  )}
                  {r && (
                    <Row
                      icon={<CircleDot size={14} className="text-ok" />}
                      onClick={() => open(id)}
                      action={
                        <button
                          aria-label="Mark done"
                          title="Mark done"
                          onClick={() => review(id)}
                          className={clsx(
                            "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors",
                            ticked[id] ? "border-ok bg-ok text-white" : "border-line-strong text-transparent hover:border-mute",
                          )}
                        >
                          <Check size={13} strokeWidth={3} />
                        </button>
                      }
                    >
                      <span className="text-mute">Ready for review: </span>
                      {r.lastMessage?.text || `${r.unread} new`}
                    </Row>
                  )}
                </Group>
              );
            })}
            {needsInput.length + byConversation.length === 0 && <Empty>Nothing needs you right now. Requests for your OK and replies to review show up here.</Empty>}
          </>
        )}

        {tab === "next" &&
          (upcoming.length ? (
            <Group title="Coming up" count={upcoming.length}>
              {upcoming.map((r) => (
                <Row key={`${r.botId}:${r.kind}`} icon={r.kind === "brief" ? <Sun size={14} className="text-warn" /> : <Radar size={14} />} onClick={() => open(`dm:${r.botId}`)}>
                  {botName(r.botId)}: {r.kind === "brief" ? "morning brief" : "check-in"} <span className="text-mute">· {when(r.at)}</span>
                </Row>
              ))}
            </Group>
          ) : (
            <Empty>Nothing coming up. Turn on a morning brief or check-ins in a bot&apos;s Details, under While you&apos;re away.</Empty>
          ))}

        {tab === "scheduled" &&
          (scheduled.length ? (
            <Group title="Repeats" count={scheduled.length}>
              {scheduled.map((s) => (
                <Row key={`${s.bot.id}:${s.kind}`} icon={s.kind === "brief" ? <Sun size={14} className="text-warn" /> : <Radar size={14} />} onClick={() => {
                  open(`dm:${s.bot.id}`);
                  setInspector({ open: true, tab: "details" });
                }}>
                  {s.bot.name}: {s.text}
                </Row>
              ))}
            </Group>
          ) : (
            <Empty>No routines yet. Turn on a morning brief or check-ins in a bot&apos;s Details, under While you&apos;re away.</Empty>
          ))}

        {tab === "resolved" &&
          (resolved === null ? (
            <Empty>Loading…</Empty>
          ) : resolved.length ? (
            <Group title="Done" count={resolved.length}>
              <Clamp
                items={resolved}
                render={(t) => (
                  <Row
                    key={t.id}
                    icon={t.outcome === "declined" ? <XCircle size={14} /> : <CheckCircle2 size={14} className="text-ok" />}
                    onClick={() => open(t.conversationId)}
                  >
                    {botName(t.botId)}: {t.label}
                    {t.detail ? ` ${t.outcome === "answered" ? `→ ${t.detail}` : t.detail}` : ""}{" "}
                    <span className="text-mute">· {t.outcome === "approved" ? "approved" : t.outcome === "declined" ? "not sent" : "answered"}</span>
                  </Row>
                )}
              />
            </Group>
          ) : (
            <Empty>Nothing resolved yet. Approvals you give or turn down, and questions you answer, land here.</Empty>
          ))}
      </div>
    </aside>
  );
}
