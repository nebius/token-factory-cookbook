"use client";

// The browser side of the answer blocks: the same names and schemas as the server's prompt, with renderers in
// design C. Code references and file paths show whether they held up against the real code.
import { createLibrary, defineComponent, useIsStreaming, useRenderNode } from "@openuidev/react-lang";
import { AlertTriangle, Check, CornerUpRight, Info } from "lucide-react";
import { createContext, useContext } from "react";
import { Rich } from "@/components/rich";
import { ANSWER_ROOT, answerDescription, answerProps, blockSpecs, refKey, type StoredAnswer } from "@/lib/answer-schema";

export const AnswerContext = createContext<{ checks: StoredAnswer["checks"] | null; onOpen: (file: string, start?: number, end?: number) => void }>({
  checks: null,
  onOpen: () => {},
});

const Callout = defineComponent({
  name: "Callout",
  description: blockSpecs.Callout.description,
  props: blockSpecs.Callout.props,
  component: ({ props }) => (
    <div className={`flex gap-2.5 rounded-[12px] border px-3.5 py-3 text-[13.5px] leading-relaxed ${props.tone === "warn" ? "border-warn/40 bg-warn/10" : "border-line bg-raised"}`}>
      {props.tone === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : <Info className="mt-0.5 size-4 shrink-0 text-verified" />}
      <span className="text-fg-2">
        <Rich text={props.text ?? ""} />
      </span>
    </div>
  ),
});

function FileListView({ items }: { items: { path: string; why: string }[] }) {
  const { checks, onOpen } = useContext(AnswerContext);
  return (
    <ul className="divide-y divide-line rounded-[12px] border border-line">
      {items.map((it, i) => {
        const resolved = checks?.files[it.path];
        const known = resolved !== undefined;
        return (
          <li key={i} className="px-3.5 py-2.5">
            <button disabled={known && !resolved} onClick={() => resolved && onOpen(resolved)} className="flex w-full items-baseline gap-2 text-left disabled:cursor-default">
              <span className={`truncate font-mono text-[12.5px] ${known && !resolved ? "text-fg-3 line-through" : "text-fg hover:text-trail"}`}>{resolved ?? it.path}</span>
              {known && !resolved && <span className="shrink-0 font-mono text-[10.5px] text-fg-3">not in the repo</span>}
            </button>
            <p className="mt-0.5 text-[12.5px] text-fg-2">{it.why}</p>
          </li>
        );
      })}
    </ul>
  );
}
const FileList = defineComponent({ name: "FileList", description: blockSpecs.FileList.description, props: blockSpecs.FileList.props, component: ({ props }) => <FileListView items={props.items ?? []} /> });

const Table = defineComponent({
  name: "Table",
  description: blockSpecs.Table.description,
  props: blockSpecs.Table.props,
  component: ({ props }) => (
    <div className="relative overflow-x-auto rounded-[12px] border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-raised">
            {(props.columns ?? []).map((c, i) => (
              <th key={i} scope="col" className="px-3 py-2 text-left font-mono text-[10.5px] font-normal tracking-[0.12em] text-fg-3 uppercase">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(props.rows ?? []).map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {(r ?? []).map((cell, j) => (
                <td key={j} className={`px-3 py-2 align-top ${j === 0 ? "font-mono text-[12.5px] text-fg" : "text-fg-2"}`}>
                  <Rich text={String(cell ?? "")} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

const Sequence = defineComponent({
  name: "Sequence",
  description: blockSpecs.Sequence.description,
  props: blockSpecs.Sequence.props,
  component: ({ props }) => (
    <ol className="rounded-[12px] border border-line px-3.5 py-3">
      {(props.steps ?? []).map((s, i) => (
        <li key={i} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0">
          <span className="mt-1 grid size-5 place-items-center rounded-full bg-trail font-mono text-[10px] font-semibold text-[#16171a]">{i + 1}</span>
          <div>
            <p className="font-mono text-[12px] text-fg">
              {s?.from} <span className="text-trail">→</span> {s?.to}
            </p>
            <p className="text-[12.5px] text-fg-2">{s?.message}</p>
          </div>
        </li>
      ))}
    </ol>
  ),
});

function CodeRefView({ file, startLine, endLine, note }: { file: string; startLine: number; endLine: number; note: string }) {
  const { checks, onOpen } = useContext(AnswerContext);
  const streaming = useIsStreaming();
  const check = checks ? checks.refs[refKey(file, startLine)] : undefined;
  const failed = check === null;
  const at = check ?? { file, startLine, endLine, corrected: false };
  return (
    <button
      disabled={failed}
      onClick={() => onOpen(at.file, at.startLine, at.endLine)}
      className={`block w-full rounded-[12px] border px-3.5 py-2.5 text-left transition ${failed ? "border-line opacity-50" : "border-line hover:border-trail/60"}`}
    >
      <span className="flex items-center justify-between gap-2 font-mono text-[11.5px]">
        <span className="truncate text-fg-2">
          {at.file} <span className="text-trail">L{at.startLine}–{at.endLine}</span>
        </span>
        {!streaming && check !== undefined && (
          <span className={`inline-flex shrink-0 items-center gap-1 tracking-[0.08em] uppercase ${failed ? "text-fg-3" : at.corrected ? "text-warn" : "text-ok"}`}>
            {failed ? "couldn't verify" : at.corrected ? <><CornerUpRight className="size-3" /> range corrected</> : <><Check className="size-3" /> lines checked</>}
          </span>
        )}
      </span>
      <span className="mt-1 block text-[13px] text-fg-2">
        <Rich text={note ?? ""} />
      </span>
    </button>
  );
}
const CodeRef = defineComponent({
  name: "CodeRef",
  description: blockSpecs.CodeRef.description,
  props: blockSpecs.CodeRef.props,
  component: ({ props }) => <CodeRefView file={props.file ?? ""} startLine={props.startLine ?? 1} endLine={props.endLine ?? props.startLine ?? 1} note={props.note ?? ""} />,
});

function AnswerRoot({ title, summary, blocks }: { title?: string; summary?: string; blocks?: unknown[] }) {
  const render = useRenderNode();
  return (
    <div>
      <h2 className="font-display text-[24px] leading-[1.08] font-medium tracking-[-0.03em] [font-stretch:82%]">{title}</h2>
      {summary && (
        <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">
          <Rich text={summary} />
        </p>
      )}
      <div className="mt-4 space-y-3">{(blocks ?? []).map((b, i) => <div key={i}>{render(b)}</div>)}</div>
    </div>
  );
}

const blocks = [Callout, FileList, Table, Sequence, CodeRef];
const Answer = defineComponent({
  name: ANSWER_ROOT,
  description: answerDescription,
  props: answerProps(blocks.map((b) => b.ref)),
  component: ({ props }) => <AnswerRoot title={props.title} summary={props.summary} blocks={props.blocks as unknown[]} />,
});

export const answerLibrary = createLibrary({ components: [Answer, ...blocks], root: ANSWER_ROOT });
