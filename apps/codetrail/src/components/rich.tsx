"use client";

// Tour text with a little markup, read the way CodeTour reads it: `inline code`, and where a tour is on screen,
// links. [#3] jumps to step 3, [Tour title#2] (or [Tour title]) opens another tour, and a backticked path of this
// repo (`src/app.ts` or `src/app.ts:12`) opens that file. With `blocks`, fenced code and ">> command" lines become
// code blocks with a copy button. Nothing else is interpreted.
import { Check, Copy } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { copyText } from "@/lib/announce";

export type RichLinks = {
  steps?: number;
  onStep?: (index: number) => void;
  tours?: { id: string; title: string; steps: number }[];
  onTour?: (id: string, step: number) => void;
  files?: Set<string>;
  onFile?: (path: string, line?: number) => void;
};

export const RichContext = createContext<RichLinks>({});

const link = "rounded-sm text-trail underline decoration-trail/40 underline-offset-2 hover:decoration-trail";
const norm = (s: string) => s.trim().toLowerCase();

function inline(text: string, l: RichLinks): ReactNode[] {
  return text.split(/(`[^`\n]+`|\[[^\]\n]{0,120}\])/g).map((p, i) => {
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) {
      const inner = p.slice(1, -1);
      const at = /^(.+?)(?::(\d+))?$/.exec(inner)!;
      if (l.onFile && l.files?.has(at[1])) {
        const line = at[2] ? Number(at[2]) : undefined;
        return (
          <button key={i} onClick={() => l.onFile!(at[1], line)} title={`Open ${inner}`} className={`${link} font-mono text-[0.88em]`}>
            {inner}
          </button>
        );
      }
      return (
        <code key={i} className="rounded bg-raised-2 px-1 py-px font-mono text-[0.88em] text-fg">
          {inner}
        </code>
      );
    }
    const ref = /^\[([^\]#]*)(?:#(\d+))?\]$/.exec(p);
    if (ref) {
      const [, name, num] = ref;
      const n = num ? Number(num) : 1;
      if (!name.trim() && num && l.onStep && l.steps && n >= 1 && n <= l.steps) {
        return (
          <button key={i} onClick={() => l.onStep!(n - 1)} className={link}>
            step {n}
          </button>
        );
      }
      const tour = name.trim() ? l.tours?.find((t) => norm(t.title) === norm(name)) : undefined;
      if (tour && l.onTour && n >= 1 && n <= tour.steps) {
        return (
          <button key={i} onClick={() => l.onTour!(tour.id, n - 1)} className={link}>
            {tour.title}
            {num ? `, step ${n}` : ""}
          </button>
        );
      }
    }
    return p;
  });
}

/** Splits text into prose, fenced code and ">> command" lines. */
export function richBlocks(text: string): { kind: "text" | "code" | "command"; text: string }[] {
  const out: { kind: "text" | "code" | "command"; text: string }[] = [];
  const push = (kind: "text" | "code" | "command", t: string) => {
    const last = out.at(-1);
    if (kind === "text" && last?.kind === "text") last.text += t;
    else if (kind !== "text" || t) out.push({ kind, text: t });
  };
  for (const part of text.split(/(```[^\n]*\n[\s\S]*?\n```)/g)) {
    const fence = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(part);
    if (fence) {
      push("code", fence[1]);
      continue;
    }
    for (const line of part.split(/(?<=\n)/)) {
      const cmd = /^>> (.+?)\n?$/.exec(line);
      if (cmd) push("command", cmd[1]);
      else push("text", line);
    }
  }
  return out.map((b) => (b.kind === "text" ? { ...b, text: b.text.replace(/^\n+|\n+$/g, "") } : b)).filter((b) => b.kind !== "text" || b.text);
}

function CodeBlock({ code, command }: { code: string; command: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="relative my-2 block">
      <pre tabIndex={0} className="code-surface overflow-x-auto rounded-[10px] bg-code p-3 pr-10 font-mono text-[12px] leading-5 text-[#cfd0d6]">
        {command ? <span aria-hidden className="text-[#7d7c94] select-none">$ </span> : null}
        {code}
      </pre>
      <button
        onClick={() =>
          void copyText(code, command ? "Command copied" : "Code copied").then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        aria-label={command ? "Copy the command" : "Copy the code"}
        title={command ? "Copy the command" : "Copy the code"}
        className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md text-[#9a9ca6] hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

export function Rich({ text, blocks }: { text: string; blocks?: boolean }) {
  const links = useContext(RichContext);
  if (!blocks) return <>{inline(text, links)}</>;
  return (
    <>
      {richBlocks(text).map((b, i) =>
        b.kind === "text" ? (
          <span key={i} className="block whitespace-pre-line">
            {inline(b.text, links)}
          </span>
        ) : (
          <CodeBlock key={i} code={b.text} command={b.kind === "command"} />
        ),
      )}
    </>
  );
}
