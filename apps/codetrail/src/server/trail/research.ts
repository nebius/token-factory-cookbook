// Research: for questions one pass can't settle. On the cached repo, DeepSeek first plans what to find out, then
// looks in up to three rounds (each sees the plan and what earlier rounds found, and stops early when there's
// nothing new), then writes the usual structured answer with every reference checked. Every step is a call on the
// same cached prefix, so it costs a few answers, not a few reads. Stored like any answer, with its plan and rounds.
import type { StoredAnswer } from "@/lib/answer-schema";
import type { Atlas, CallRecord } from "@/lib/schemas";
import type { StreamHooks } from "@/server/ai/nebius";
import { AIError, chatText } from "@/server/ai/nebius";
import { concludeResearch, getStoredAnswer } from "./ask";
import { answerBase, checkLimitsFor, questionIdOf, shared, trackedCall, type Prepared } from "./service";

export const MAX_ROUNDS = 3;
/** What a round answers when it found nothing the earlier rounds didn't. */
const NOTHING_NEW = "NOTHING NEW";
/** The plan and findings sent with each later call, kept well under the answer's own budget. */
const RECAP_CHARS = 24_000;

export type ResearchStage = { stage: "plan" } | { stage: "round"; n: number; plan: string } | { stage: "answer"; rounds: number };

const planTask = (q: string) =>
  [
    "A developer asked the question below about the repository above. Before answering, plan the research.",
    "Write 3 to 5 short sub-questions that together settle it, one per line, each naming where in the code to look (files or modules). No answer yet, no preamble.",
    `Question: ${q}`,
  ].join("\n\n");

export function roundTask(q: string, plan: string, rounds: string[]): string {
  return [
    `A developer asked: ${q}`,
    researchContext(plan, rounds),
    `Research round ${rounds.length + 1} of ${MAX_ROUNDS}. Work through the sub-questions not yet settled. Write findings as short bullet points, each with the file and line it rests on (path:line) and what that code does. Quote nothing you haven't read in the repository above.`,
    `If the earlier rounds already settle every sub-question, reply with exactly: ${NOTHING_NEW}`,
  ].join("\n\n");
}

/** The plan and findings so far, sent ahead of the next step. The newest rounds are kept when it runs long. */
export function researchContext(plan: string, rounds: string[]): string {
  const parts = [`Research plan:\n${plan.trim()}`, ...rounds.map((r, i) => `Findings, round ${i + 1}:\n${r.trim()}`)];
  while (parts.length > 2 && parts.join("\n\n").length > RECAP_CHARS) parts.splice(1, 1);
  return parts.join("\n\n").slice(0, RECAP_CHARS);
}

/** True when a round reports nothing new (or next to nothing). */
export const roundDone = (text: string) => text.trim().length < 40 || text.trim().toUpperCase().startsWith(NOTHING_NEW);

export async function getResearch(p: Prepared, atlas: Atlas, question: string, who: string, opts: { stream?: StreamHooks; onStage?: (s: ResearchStage) => void } = {}): Promise<{ answer: StoredAnswer; fromCache: boolean }> {
  const q = question.trim().slice(0, 300);
  const id = questionIdOf(`ask:research:${q}`);
  const stored = await getStoredAnswer(p, id);
  if (stored) return { answer: stored, fromCache: true };
  return shared(`${answerBase(p)}/answers/${id}`, () => runResearch(p, atlas, q, id, who, opts));
}

/**
 * Up to MAX_ROUNDS rounds; `look(n, found)` runs round n with the findings so far. Stops early when a round finds
 * nothing new, or when one is cut off: the answer is then written from what was found, rather than losing the run.
 */
export async function researchRounds(look: (n: number, found: string[]) => Promise<string>): Promise<string[]> {
  const found: string[] = [];
  for (let n = 1; n <= MAX_ROUNDS; n++) {
    let text: string;
    try {
      text = await look(n, found);
    } catch (error) {
      if (error instanceof AIError && error.kind === "truncated") break;
      throw error;
    }
    if (roundDone(text)) break;
    found.push(text);
  }
  return found;
}

async function runResearch(p: Prepared, atlas: Atlas, q: string, id: string, who: string, opts: { stream?: StreamHooks; onStage?: (s: ResearchStage) => void }) {
  await checkLimitsFor(who, "asks");
  const cacheKey = `codetrail:${p.info.owner}/${p.info.repo}@${p.info.sha}`;
  const calls: CallRecord[] = [];
  const step = async (label: string, task: string, maxTokens: number) => {
    const { result, record } = await trackedCall(p, "ask", label, (cfg) => chatText(cfg, { prefix: p.prefix, task, cacheKey, effort: "medium", maxTokens }));
    calls.push(record);
    return result.trim();
  };

  // Reasoning counts toward max_tokens, so each step gets room to think as well as write.
  opts.onStage?.({ stage: "plan" });
  const plan = await step(`Research plan: ${q}`, planTask(q), 6_144);
  const rounds = await researchRounds((n, found) => {
    opts.onStage?.({ stage: "round", n, plan });
    return step(`Research round ${n}: ${q}`, roundTask(q, plan, found), 12_288);
  });
  opts.onStage?.({ stage: "answer", rounds: rounds.length });
  const answer = await concludeResearch(p, atlas, q, id, { context: researchContext(plan, rounds), plan, rounds, calls }, opts.stream);
  return { answer, fromCache: false };
}
