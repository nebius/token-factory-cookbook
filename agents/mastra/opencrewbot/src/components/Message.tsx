"use client";

import clsx from "clsx";
import { Brain, Check, ChevronRight, Code2, Globe, Loader2, MousePointerClick, NotebookPen, ShieldAlert, X } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/client/api";
import { formatCost, formatTokens, timeLabel } from "@/lib/client/format";
import type { Bot, ChatMessage, Part, Source } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
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
  if (name.startsWith("browser_")) return <MousePointerClick {...props} />;
  return <Code2 {...props} />;
}

function ApprovalButtons({ message, part }: { message: ChatMessage; part: ToolPart }) {
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
    <div className="flex flex-wrap items-center gap-2 border-t border-warn/20 px-3.5 py-2.5">
      <span className="mr-auto flex items-center gap-1.5 text-[13px] font-medium text-warn">
        <ShieldAlert size={14} /> Allow this action?
      </span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(false)}>
        Deny
      </Button>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(true)}>
        Allow once
      </Button>
    </div>
  );
}

function ToolChip({ message, part }: { message: ChatMessage; part: ToolPart }) {
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
              className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-[#8db4ff]"
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
      {waiting && message.status === "streaming" && <ApprovalButtons message={message} part={part} />}
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
            className="inline-flex max-w-64 items-center gap-1.5 rounded-full bg-raised-2 px-2.5 py-1 text-[12.5px] text-ink transition-colors hover:bg-[#303030]"
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
    case "everyone":
      return null;
  }
}

export function MessageItem({ message, bot, showAuthor }: { message: ChatMessage; bot?: Bot; showAuthor: boolean }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return (
      <div className="group flex flex-col items-end">
        <div className="bubble-user max-w-[min(620px,80%)] rounded-[22px] bg-accent px-4 py-2.5 text-accent-ink">
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
      <div className="flex w-full max-w-[min(680px,92%)] min-w-0 flex-col items-start gap-2">
        {blocks.map((block, b) =>
          block.kind === "bubble" ? (
            <div key={b} className="w-fit max-w-full min-w-0 space-y-2.5 rounded-[22px] bg-raised px-4 py-3">
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
