"use client";

import clsx from "clsx";
import {
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  FileText,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  MousePointerClick,
  NotebookPen,
  Radar,
  Sun,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/client/api";
import { formatCost, formatTokens, timeLabel } from "@/lib/client/format";
import type { ActionDetail, Bot, ChatMessage, Part, Source } from "@/lib/shared/types";
import { useApp } from "./OpenDuetApp";
import { BotAvatar, Button, inputClass } from "./ui";

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

type ToolPart = Extract<Part, { kind: "tool" }>;
type QuestionPart = Extract<Part, { kind: "question" }>;

function ToolIcon({ name }: { name: string }) {
  const props = { size: 14, className: "shrink-0 text-mute", "aria-hidden": true } as const;
  if (["web_search", "read_page", "crawl_site"].includes(name)) return <Globe {...props} />;
  if (name.startsWith("memory_")) return <NotebookPen {...props} />;
  if (name === "send_email") return <Mail {...props} />;
  if (name.startsWith("browser_")) return <MousePointerClick {...props} />;
  return <Code2 {...props} />;
}

/** What kind of thing an action makes, for the draft card's icon. */
function DraftIcon({ part }: { part: ToolPart }) {
  const text = `${part.name} ${part.label}`.toLowerCase();
  const props = { size: 15, className: "shrink-0 text-mute", "aria-hidden": true } as const;
  if (/mail|gmail|outlook/.test(text)) return <Mail {...props} />;
  if (/slack|message|chat|discord|teams/.test(text)) return <MessageSquare {...props} />;
  if (/calendar|event|meeting/.test(text)) return <CalendarDays {...props} />;
  if (/issue|github|linear|jira/.test(text)) return <CircleDot {...props} />;
  if (part.name.startsWith("browser_")) return <Globe {...props} />;
  return <FileText {...props} />;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Short fields read like headers (To, Subject); long ones like the body underneath. */
function DraftFields({ detail }: { detail: ActionDetail }) {
  const long = (v: string) => v.length > 90 || v.includes("\n");
  const heads = detail.fields.filter((f) => !long(f.value));
  const bodies = detail.fields.filter((f) => long(f.value));
  return (
    <div>
      {detail.action && <p className="px-4 pt-3 text-[12.5px] font-medium text-mute">{detail.action}</p>}
      {heads.length > 0 && (
        <dl className="divide-y divide-line border-b border-line">
          {heads.map((f, i) => (
            <div key={i} className="flex gap-1.5 px-4 py-2 text-[14px]">
              <dt className="shrink-0 text-faint">{capitalize(f.name)}:</dt>
              <dd className="min-w-0 break-words text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {bodies.map((f, i) => (
        <div key={i} className="px-4 py-3">
          {bodies.length > 1 && <p className="mb-1 text-[12px] text-faint">{capitalize(f.name)}</p>}
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{f.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Exactly what the bot is about to do, as a draft held until you approve it. */
function ApprovalCard({ message, part }: { message: ChatMessage; part: ToolPart }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api.approve(message.conversationId, message.botId!, part.toolCallId, approve);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send that.");
      setBusy(false);
    }
  };
  return (
    <div className="overflow-hidden rounded-2xl bg-card text-[13.5px] shadow-sm ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-4 py-3">
        <DraftIcon part={part} />
        <span className="text-[14.5px] font-medium text-ink">{part.label}</span>
        {part.detail && <span className="min-w-0 truncate text-mute">{part.detail}</span>}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-[12px] font-medium text-warn">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" aria-hidden />
          Waiting for your OK
        </span>
      </div>
      {Array.isArray(part.what) && part.what.length > 0 && (
        <div className="max-h-80 overflow-y-auto">
          {part.what.map((detail, i) => (
            <DraftFields key={i} detail={detail} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-line bg-raised/40 px-4 py-2.5">
        <span className="mr-auto text-[12.5px] text-faint">Nothing happens until you approve.</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(false)}>
          Not now
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(true)}>
          <Check size={14} /> Approve
        </Button>
      </div>
    </div>
  );
}

function ToolChip({ message, part }: { message: ChatMessage; part: ToolPart }) {
  if (part.status === "awaiting-approval" && message.status === "streaming") return <ApprovalCard message={message} part={part} />;
  return <ToolStep message={message} part={part} />;
}

function ToolStep({ message, part }: { message: ChatMessage; part: ToolPart }) {
  const { state, open: openConversation, setInspector } = useApp();
  const [open, setOpen] = useState(false);
  const waiting = part.status === "awaiting-approval";
  const expandable = Boolean(part.preview || part.sources?.length);
  const canWatch = part.name.startsWith("browser_") && message.botId && state.liveViews[message.botId] && message.status === "streaming";

  const watch = () => {
    if (message.conversationId !== `dm:${message.botId}`) openConversation(`dm:${message.botId}`);
    setInspector({ open: true, tab: "browser" });
  };

  return (
    <div className={clsx("overflow-hidden rounded-2xl text-[13.5px]", waiting ? "bg-warn-soft ring-1 ring-warn/30" : "bg-raised-2")}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={clsx("flex w-full items-center gap-2 px-3.5 py-2 text-left", expandable && "cursor-pointer")}
      >
        <ToolIcon name={part.name} />
        <span className="shrink-0 font-medium whitespace-nowrap text-ink">{part.label}</span>
        {part.detail && <span className="min-w-0 truncate text-mute">{part.detail}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {canWatch && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                watch();
              }}
              onKeyDown={(e) => e.key === "Enter" && watch()}
              className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-link"
            >
              Watch live
            </span>
          )}
          {part.status === "running" && <Loader2 size={14} className="animate-spin text-mute" aria-label="Running" />}
          {part.status === "done" && <Check size={14} className="text-ok" aria-label="Done" />}
          {part.status === "error" && <X size={14} className="text-danger" aria-label="Failed" />}
          {part.status === "denied" && <span className="text-[12px] text-faint">Skipped</span>}
          {expandable && <ChevronRight size={14} className={clsx("text-faint transition-transform", open && "rotate-90")} aria-hidden />}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3.5 py-2.5">
          {part.preview && <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-mute">{part.preview}</p>}
          {part.sources && <SourceList sources={part.sources} />}
        </div>
      )}
    </div>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {sources.map((s, i) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.url}
            className="inline-flex max-w-64 items-center gap-1.5 rounded-full bg-raised-2 px-2.5 py-1 text-[12.5px] text-ink transition-colors hover:bg-line-strong"
          >
            <span className="text-faint">{i + 1}</span>
            <span className="truncate">{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function QuestionCard({ message, part }: { message: ChatMessage; part: QuestionPart }) {
  const { toast } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const answered = part.answer !== undefined;
  const live = !answered && message.status === "streaming";
  const send = async (answer: string) => {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      await api.answer(message.conversationId, message.botId!, part.toolCallId, answer);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send that.");
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl bg-accent-soft px-4 py-3.5 ring-1 ring-accent/25">
      <p className="text-[15px] font-medium">{part.question}</p>
      {answered ? (
        <p className="mt-1.5 text-[13.5px] text-mute">
          You answered <span className="text-ink">{part.answer}</span>
        </p>
      ) : live ? (
        <div className="mt-3 space-y-2.5">
          {part.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {part.options.map((o) => (
                <Button key={o.label} size="sm" disabled={busy} title={o.description} onClick={() => send(o.label)}>
                  {o.label}
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={part.options.length ? "Or type your own answer" : "Type your answer"}
              aria-label="Your answer"
              className={clsx(inputClass, "rounded-full py-2")}
              disabled={busy}
            />
            <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
              Answer
            </Button>
          </form>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-faint">Not answered.</p>
      )}
    </div>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  return (
    <details className="group text-[13.5px] text-mute">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-ink">
        <Brain size={14} aria-hidden />
        {live ? "Thinking…" : "Thought it through"}
        <ChevronRight size={13} className="transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <p className="mt-2 border-l-2 border-line-strong pl-3 leading-relaxed whitespace-pre-wrap">{text}</p>
    </details>
  );
}

function routeLabel(message: ChatMessage): string | null {
  const r = message.route;
  if (!r) return null;
  switch (r.by) {
    case "jev":
      return `picked by Jev${r.confidence ? ` · ${Math.round(r.confidence * 100)}%` : ""}`;
    case "mention":
      return "mentioned";
    case "handoff":
      return "handed off";
    case "lead":
      return "room lead";
    case "brief":
    case "check":
      // RoutineHeader says it inside the card.
      return null;
    case "everyone":
      return null;
  }
}

/** The top of a brief or check-in card: what it is and when it came in. */
function RoutineHeader({ message }: { message: ChatMessage }) {
  const at = new Date(message.createdAt);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let icon = <Radar size={15} className="text-mute" aria-hidden />;
  let title = "Check-in";
  let when = time;
  if (message.route?.by === "brief") {
    icon = <Sun size={15} className="text-warn" aria-hidden />;
    title = at.getHours() < 12 ? "Morning brief" : "Your brief";
    when = at.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  } else if (message.route?.found) {
    icon = <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />;
    title = "Needs your attention";
  }
  return (
    <div className="flex w-full items-center gap-2 border-b border-line px-4 py-2.5 text-[13px]">
      {icon}
      <span className="font-medium text-ink">{title}</span>
      <span className="text-faint">· {when}</span>
    </div>
  );
}

export function MessageItem({ message, bot, showAuthor }: { message: ChatMessage; bot?: Bot; showAuthor: boolean }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return (
      <div className="group flex flex-col items-end">
        <div className="bubble-user max-w-[min(620px,80%)] rounded-[22px] bg-bubble px-4 py-2.5 text-bubble-ink">
          <Markdown text={text} />
        </div>
        <span className="mt-1 h-4 pr-2 text-[11.5px] text-faint opacity-0 transition-opacity group-hover:opacity-100">{timeLabel(message.createdAt)}</span>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  const allSources = message.parts.flatMap((p) => (p.kind === "tool" && p.sources ? p.sources : []));
  const uniqueSources = allSources.filter((s, i) => allSources.findIndex((x) => x.url === s.url) === i);
  const lastIndex = message.parts.length - 1;
  const cost = formatCost(message.usage?.costUsd);
  const route = routeLabel(message);
  // Briefs and check-ins arrive unasked, so they read as one card with a header.
  const routine = message.route?.by === "brief" || message.route?.by === "check";

  // Words go in bubbles; tool steps and question cards stand on their own between them.
  type Block =
    | { kind: "bubble"; parts: { part: Extract<Part, { kind: "text" | "reasoning" }>; index: number }[] }
    | { kind: "block"; part: Part };
  const blocks: Block[] = [];
  message.parts.forEach((part, index) => {
    if (part.kind === "text" || part.kind === "reasoning") {
      if (!part.text) return;
      const last = blocks[blocks.length - 1];
      if (last?.kind === "bubble") last.parts.push({ part, index });
      else blocks.push({ kind: "bubble", parts: [{ part, index }] });
    } else {
      blocks.push({ kind: "block", part });
    }
  });
  const lastBlock = blocks[blocks.length - 1];
  const waitingOnYou = message.parts.some(
    (p) => (p.kind === "tool" && p.status === "awaiting-approval") || (p.kind === "question" && p.answer === undefined),
  );
  // Dots while the model is thinking: before any output, or after a finished tool step.
  const showTyping =
    streaming &&
    !waitingOnYou &&
    (!lastBlock || (lastBlock.kind === "block" && !(lastBlock.part.kind === "tool" && lastBlock.part.status === "running")));

  return (
    <div className="group flex flex-col items-start">
      {showAuthor && (
        <div className="mb-1.5 flex items-center gap-2 pl-1">
          {bot && <BotAvatar bot={bot} size={22} />}
          <span className="text-[13.5px] font-medium text-ink">{bot?.name ?? "Deleted bot"}</span>
          {route && <span className="text-[12px] text-faint">{route}</span>}
        </div>
      )}
      <div
        className={clsx(
          "flex w-full max-w-[min(680px,92%)] min-w-0 flex-col items-start gap-2",
          routine && "overflow-hidden rounded-[22px] bg-raised pb-2 ring-1 [&>*:not(:first-child)]:mx-2",
          routine && (message.route?.found ? "ring-warn/40" : "ring-line"),
        )}
      >
        {routine && <RoutineHeader message={message} />}
        {blocks.map((block, b) =>
          block.kind === "bubble" ? (
            <div key={b} className={clsx("max-w-full min-w-0 space-y-2.5 rounded-[22px] bg-raised px-4 py-3", routine ? "w-full !mx-0 py-1.5" : "w-fit")}>
              {block.parts.map(({ part, index }) =>
                part.kind === "text" ? (
                  <Markdown key={index} text={part.text} />
                ) : part.kind === "reasoning" ? (
                  <Reasoning key={index} text={part.text} live={streaming && index === lastIndex} />
                ) : null,
              )}
            </div>
          ) : block.part.kind === "tool" ? (
            <div key={b} className="w-full max-w-[520px]">
              <ToolChip message={message} part={block.part} />
            </div>
          ) : block.part.kind === "question" ? (
            <div key={b} className="w-full max-w-[520px]">
              <QuestionCard message={message} part={block.part} />
            </div>
          ) : null,
        )}
        {showTyping && (
          <span className="flex h-11 items-center gap-1 rounded-[22px] bg-raised px-4" aria-label="Typing">
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-mute" />
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-mute" />
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-mute" />
          </span>
        )}
        {message.error && <p className="rounded-2xl bg-danger-soft px-4 py-2.5 text-[13.5px] text-danger">{message.error}</p>}
        {message.status === "stopped" && !message.error && <p className="px-2 text-[13px] text-faint">Stopped.</p>}
        {uniqueSources.length > 0 && !streaming && <SourceList sources={uniqueSources} />}
      </div>
      <div className="mt-1 flex h-4 flex-wrap gap-x-2 pl-2 text-[11.5px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
        <span>{timeLabel(message.createdAt)}</span>
        {message.model && !streaming && <span>{message.model === "mock" ? "mock model" : message.model.split("/").pop()}</span>}
        {message.usage && (message.usage.input > 0 || message.usage.output > 0) && (
          <span title={`${message.usage.input} in · ${message.usage.output} out`}>{formatTokens(message.usage.input + message.usage.output)} tokens</span>
        )}
        {cost && <span>{cost}</span>}
      </div>
    </div>
  );
}
