// The building blocks DeepSeek may use to answer a question (generative UI with OpenUI Lang). The schemas are
// shared: the server turns them into the prompt and checks the answer; the browser attaches the renderers.
import { z } from "zod";

export const ANSWER_ROOT = "Answer";

export const blockSpecs = {
  Callout: {
    description: "A short highlighted note: a key point, a caveat or a gotcha.",
    props: z.object({
      tone: z.enum(["info", "warn"]).describe("info for a key point, warn for a pitfall"),
      text: z.string().describe("One or two sentences."),
    }),
  },
  FileList: {
    description: "Files that matter for the question, each with why it matters.",
    props: z.object({
      items: z
        .array(z.object({ path: z.string().describe("Exact path from a file header"), why: z.string().describe("Under 20 words") }))
        .describe("3-12 files, most important first"),
    }),
  },
  Table: {
    description: "A comparison or a list of facts in rows, e.g. routes, config options, commands.",
    props: z.object({
      columns: z.array(z.string()).describe("2-5 column headers"),
      rows: z.array(z.array(z.string())).describe("Each row has one cell per column"),
    }),
  },
  Sequence: {
    description: "Who calls whom, in order: a sequence of messages between parts of the code.",
    props: z.object({
      steps: z
        .array(z.object({ from: z.string(), to: z.string(), message: z.string().describe("Under 12 words") }))
        .describe("3-12 messages in order"),
    }),
  },
  CodeRef: {
    description: "One place in the code, shown inline. Use it for the exact lines that answer the question.",
    props: z.object({
      file: z.string().describe("Exact path from a file header"),
      startLine: z.number().int().describe("First line"),
      endLine: z.number().int().describe("Last line, at most 30 after startLine"),
      anchor: z.string().describe("One distinctive line copied exactly from inside the range, without the line-number prefix"),
      note: z.string().describe("One sentence on what these lines do"),
    }),
  },
} as const;


export const answerDescription = "The whole answer: a title, a one-sentence summary, blocks in reading order, then 2-3 follow-up questions.";

/** The root's props, given the block components' refs (each side defines its own components). */
export function answerProps(refs: readonly unknown[]) {
  return z.object({
    title: z.string().describe("3-8 words"),
    summary: z.string().describe("The answer in one or two sentences"),
    blocks: z.array(z.union(refs as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])).describe("2-6 blocks"),
    followUps: z.array(z.string()).optional().describe("2-3 short questions a developer would ask next, answerable from this repository"),
  });
}

export const ANSWER_RULES = [
  "Answer only from the repository above. Every file path must be an exact path from a file header.",
  "Use CodeRef for the lines that really answer the question, and copy each anchor exactly from the file.",
  "Prefer a Table for lists of routes, options or commands; a Sequence for who-calls-whom; a FileList for 'where is X'.",
  "Keep it short: 2-6 blocks, no filler.",
  "Write the program once, top to bottom, with no commentary and no second attempt. Every statement you define must be listed in the root's blocks.",
  "If the repository doesn't answer the question, say so in the summary and add a Callout with what is closest.",
  "End the root with 2-3 follow-up questions (under 15 words each) that dig deeper into this answer.",
];

/** Thorough mode: the same blocks, more tracing. */
export const THOROUGH_RULES = [
  "Be thorough: trace the answer across every file involved, following calls and data from where they start to where they end.",
  "Use up to 8 blocks and up to 6 CodeRefs, and say explicitly where behaviour differs by configuration or edge case.",
];

export const ANSWER_EXAMPLE = `root = Answer("Where requests are routed", "Routing happens in lib/router.ts, which matches the path and calls the handler.", [files, code], ["How are route params parsed?", "What happens when no route matches?"])
files = FileList([{path: "lib/router.ts", why: "Matches paths to handlers"}, {path: "lib/app.ts", why: "Registers routes"}])
code = CodeRef("lib/router.ts", 12, 30, "function match(path) {", "Walks the route table and returns the first match.")`;

/** Stored answer for a commit + question. `checks` says which code references held up. */
export type StoredAnswer = {
  id: string;
  question: string;
  text: string;
  checks: { refs: Record<string, { file: string; startLine: number; endLine: number; corrected: boolean } | null>; files: Record<string, string | null> };
  calls: import("./schemas").CallRecord[];
  at: number;
  thorough?: boolean;
  /** A Research answer: the plan it made and what each round found, before the answer was written. */
  research?: { plan: string; rounds: string[] };
};

export const refKey = (file: string, startLine: number) => `${file}:${startLine}`;

/**
 * The final OpenUI Lang program from a reply: only statement lines, starting at the last `root =` (models
 * sometimes write a program, comment on it, then write a corrected one).
 */
export function cleanProgram(text: string): string {
  // Some replies separate statements with a written "\n" (backslash, n) instead of a line break.
  const lines = text.replace(/(?:\\n)+\s*(?=[A-Za-z_$][\w$]*\s*=\s*[A-Z]\w*\()/g, "\n").split("\n");
  const statement = /^\s*[A-Za-z_$][\w$]*\s*=/;
  let start = 0;
  lines.forEach((l, i) => {
    if (/^\s*root\s*=/.test(l)) start = i;
  });
  return lines
    .slice(start)
    .filter((l) => statement.test(l))
    .join("\n");
}
