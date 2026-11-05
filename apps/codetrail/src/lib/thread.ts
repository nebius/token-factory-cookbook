// Follow-up conversations. Each reply is sent after the cached repo with a short recap of the conversation so far
// (questions plus a compact gist of each answer), so only the recap and the new question are fresh input.
import type { Tour } from "./schemas";

export type ThreadTurn = { question: string; kind: "answer" | "tour"; refId: string; title: string; gist: string };
export type Thread = { id: string; turns: ThreadTurn[]; at: number };
export type ThreadIndexEntry = { id: string; title: string; turns: number; at: number };

const GIST_CHARS = 1_200;
const FULL_TURNS = 6;
const CONTEXT_CHARS = 32_000; // About 10K tokens.

/** An OpenUI answer's title: the first argument of `Answer(…)`. */
export const answerTitle = (text: string) => text.match(/Answer\("((?:[^"\\]|\\.){1,100})"/)?.[1] ?? null;

/** The questions the model suggested asking next: the string list after the blocks in `root = Answer(…)`. */
export function answerFollowUps(text: string): string[] {
  const root = text.split("\n").find((l) => /^\s*root\s*=\s*Answer\(/.test(l)) ?? "";
  const list = root.match(/\]\s*,\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)+)\]\s*\)\s*$/)?.[1];
  return list ? [...list.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((q) => q.length > 3).slice(0, 3) : [];
}

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * The gist of an OpenUI answer, without parsing it: its text (string literals) and code references as file:Lx-Ly.
 * Statement names, block names and tones are dropped.
 */
export function answerGist(text: string): string {
  const parts: string[] = [];
  for (const line of text.split("\n")) {
    const ref = line.match(/CodeRef\(\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*"((?:[^"\\]|\\.)*)"/);
    if (ref) {
      parts.push(`${ref[1]}:L${ref[2]}-${ref[3]} ${ref[4]}`);
      continue;
    }
    const strings = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => s !== "info" && s !== "warn");
    // The root's last list is the suggested follow-ups, not part of the answer.
    if (/^\s*root\s*=/.test(line)) strings.splice(2);
    parts.push(...strings);
  }
  return cut(parts.filter(Boolean).join("; ").replace(/\s+/g, " "), GIST_CHARS);
}

export const tourGist = (tour: Pick<Tour, "summary" | "steps">) =>
  cut(`${tour.summary} Steps: ${tour.steps.map((s, i) => `${i + 1}. ${s.title} (${s.file}:L${s.startLine}-${s.endLine})`).join("; ")}`, GIST_CHARS);

/** The recap sent before a follow-up: the last turns in full, older ones as one line each, within a size cap. */
export function threadContext(turns: ThreadTurn[]): string {
  if (!turns.length) return "";
  const older = turns.slice(0, -FULL_TURNS).map((t) => `- Q: ${t.question} → ${t.title}`);
  let recent = turns.slice(-FULL_TURNS).map((t) => `Q: ${t.question}\nA (${t.kind}): ${t.gist}`);
  const head = "This question follows an earlier conversation about this repository (oldest first):";
  const size = () => head.length + older.join("\n").length + recent.join("\n\n").length;
  // Over the cap, drop the oldest full turns down to one line each.
  while (size() > CONTEXT_CHARS && recent.length > 1) {
    older.push(`- Q: ${turns[turns.length - recent.length].question}`);
    recent = recent.slice(1);
  }
  return [head, ...older, "", recent.join("\n\n"), "", "Answer the new question in that context. Don't repeat what was already said; build on it."].join("\n");
}
