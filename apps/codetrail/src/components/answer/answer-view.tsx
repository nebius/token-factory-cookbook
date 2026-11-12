"use client";

import { Renderer } from "@openuidev/react-lang";
import { Check, Copy, Download, MessageSquareText, Sparkles } from "lucide-react";
import { useState } from "react";
import { answerFiles, answerToMarkdown } from "@/lib/answer-md";
import { copyText } from "@/lib/announce";
import { formatUsd } from "@/lib/format";
import type { StoredAnswer } from "@/lib/answer-schema";
import { CallLine } from "@/components/trail/cost";
import { Rich } from "@/components/rich";
import type { ResearchStage } from "@/server/trail/research";
import { AnswerContext, answerLibrary } from "./library";

/** A generative-UI answer: rendered live while it streams, then with every code reference checked. */
export function AnswerView({
  question,
  text,
  streaming,
  answer,
  fromCache,
  onOpen,
  at,
  onPrompt,
  stage,
}: {
  question: string;
  text: string;
  streaming: boolean;
  answer: StoredAnswer | null;
  fromCache: boolean;
  onOpen: (file: string, start?: number, end?: number) => void;
  /** The commit, for links in the Markdown export. */
  at: { owner: string; repo: string; sha: string };
  /** Copies the answer, with the architecture, as a prompt for an AI chat. */
  onPrompt?: () => void;
  /** While a Research question runs: the step it's on. */
  stage?: ResearchStage;
}) {
  const [copied, setCopied] = useState(false);
  /** The answer as Markdown, with the lines of every checked code reference. */
  async function markdown() {
    if (!answer) return "";
    const files = await Promise.all(
      answerFiles(answer).map(async (path) => {
        const r = await fetch(`/api/file?owner=${encodeURIComponent(at.owner)}&repo=${encodeURIComponent(at.repo)}&sha=${at.sha}&path=${encodeURIComponent(path)}`).catch(() => null);
        return [path, r?.ok ? (await r.text()).split("\n") : []] as const;
      }),
    );
    return answerToMarkdown(answer, at, Object.fromEntries(files));
  }
  return (
    <div>
      <p className="flex items-center gap-2 font-mono text-[11.5px] text-fg-3">
        <Sparkles className="size-3.5 text-trail" />
        <span className="truncate" title={question}>
          {question}
        </span>
      </p>
      {stage && <ResearchProgress stage={stage} />}
      <div className="mt-2.5" aria-busy={streaming} aria-live="off">
        <AnswerContext.Provider value={{ checks: answer?.checks ?? null, onOpen }}>
          {text ? <Renderer response={text} library={answerLibrary} isStreaming={streaming} /> : !stage && <p className="text-sm text-fg-3">Reading the question…</p>}
        </AnswerContext.Provider>
      </div>
      {!streaming && answer?.research && <ResearchTrail research={answer.research} />}
      {!streaming && answer && (
        <div className="mt-3 border-t border-line pt-2.5">
          {fromCache ? (
            <span className="font-mono text-[11px] text-fg-3">Saved earlier · free to replay</span>
          ) : (
            answer.calls.length > 1 ? (
              <span className="font-mono text-[11px] text-fg-3">
                {answer.calls.length} calls · {formatUsd(answer.calls.reduce((t, c) => t + (c.cost ?? 0), 0))} spent · each one in the receipt
              </span>
            ) : (
              answer.calls[0] && <CallLine call={answer.calls[0]} />
            )
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={async () => {
                if (!(await copyText(await markdown(), "Answer copied as Markdown"))) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] text-fg-3 hover:border-outline hover:text-fg"
            >
              {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy as Markdown"}
            </button>
            <button
              onClick={async () => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([await markdown()], { type: "text/markdown" }));
                a.download = `${at.repo}-${answer.id}.md`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              }}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] text-fg-3 hover:border-outline hover:text-fg"
            >
              <Download className="size-3" /> Download .md
            </button>
            {onPrompt && (
              <button onClick={onPrompt} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] text-fg-3 hover:border-outline hover:text-fg">
                <MessageSquareText className="size-3" /> Copy as a prompt
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STEPS = ["Plan", "Round 1", "Round 2", "Round 3", "Answer"];

/** Where a Research question is: plan, rounds, answer. */
function ResearchProgress({ stage }: { stage: ResearchStage }) {
  const at = stage.stage === "plan" ? 0 : stage.stage === "round" ? stage.n : 4;
  return (
    <div className="mt-2.5 rounded-[10px] border border-line px-3 py-2">
      <ol className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === at ? "step" : undefined} className={i === at ? "text-trail" : i < at ? "text-fg-2" : "text-fg-3"}>
            {i < at ? "✓ " : i === at ? "● " : ""}
            {s}
          </li>
        ))}
      </ol>
      {stage.stage === "round" && (
        <details className="mt-2 text-[12.5px] text-fg-2">
          <summary className="cursor-pointer font-mono text-[11px] text-fg-3">The plan</summary>
          <p className="mt-1 whitespace-pre-line">
            <Rich text={stage.plan} />
          </p>
        </details>
      )}
    </div>
  );
}

/** Research notes are written in Markdown; shown as text, headings and bold markers go. */
const plainMarkdown = (text: string) => text.replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*\n]+)\*\*/g, "$1");

/** After a Research answer: how it got there, each step openable. */
function ResearchTrail({ research }: { research: { plan: string; rounds: string[] } }) {
  return (
    <div className="mt-3 rounded-[10px] border border-line px-3 py-2">
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-fg-3 uppercase">How it was researched · {research.rounds.length} {research.rounds.length === 1 ? "round" : "rounds"}</p>
      {[{ title: "Plan", body: research.plan }, ...research.rounds.map((r, i) => ({ title: `Round ${i + 1}`, body: r }))].map((x) => ({ ...x, body: plainMarkdown(x.body) })).map((x) => (
        <details key={x.title} className="mt-1.5 text-[12.5px] text-fg-2">
          <summary className="cursor-pointer font-mono text-[11px] text-fg-2 hover:text-fg">{x.title}</summary>
          <p className="mt-1 whitespace-pre-line">
            <Rich text={x.body} />
          </p>
        </details>
      ))}
    </div>
  );
}
