// Follow-up conversations. A thread starts from any stored answer or tour; each follow-up sends the cached repo, a
// recap of the thread so far, and the new question. Replies are checked like any answer or tour and stored per
// thread, so a shared conversation replays for free.
import { randomUUID } from "node:crypto";
import type { StoredAnswer } from "@/lib/answer-schema";
import type { Atlas, Tour } from "@/lib/schemas";
import { answerGist, answerTitle, threadContext, tourGist, type Thread, type ThreadIndexEntry, type ThreadTurn } from "@/lib/thread";
import type { StreamHooks } from "@/server/ai/nebius";
import { RepoError } from "@/server/repo/github";
import { getJSON, putJSON } from "@/server/store";
import { getAnswer, getStoredAnswer } from "./ask";
import { commitKey, getStoredTour, getTour, type Prepared } from "./service";

type FollowUpMode = "answer" | "thorough" | "tour";
export type ThreadStart = { thread?: string; root?: { kind: "answer" | "tour"; id: string } };

const key = (p: Prepared, id: string) => `${commitKey(p)}/threads/${id.replace(/[^\w-]/g, "")}.json`;
export const getThread = (p: Prepared, id: string) => getJSON<Thread>(key(p, id));
export const getThreadIndex = (p: Prepared) => getJSON<ThreadIndexEntry[]>(`${commitKey(p)}/threads.json`).then((x) => x ?? []);

const answerTurn = (a: StoredAnswer): ThreadTurn => ({ question: a.question, kind: "answer", refId: a.id, title: answerTitle(a.text) ?? a.question, gist: answerGist(a.text) });
const tourTurn = (t: Tour): ThreadTurn => ({ question: t.question, kind: "tour", refId: t.id, title: t.title, gist: tourGist(t) });

async function rootTurn(p: Prepared, root: NonNullable<ThreadStart["root"]>): Promise<ThreadTurn> {
  const turn = root.kind === "answer" ? await getStoredAnswer(p, root.id).then((a) => a && answerTurn(a)) : await getStoredTour(p.info, root.id).then((t) => t && tourTurn(t));
  if (!turn) throw new RepoError("That answer or tour isn't stored for this commit.", 404);
  return turn;
}

const newThread = (first: ThreadTurn): Thread => ({ id: randomUUID().replace(/-/g, "").slice(0, 12), turns: [first], at: Date.now() });

const sameQuestion = (a: string, b: string) => {
  const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!\s]+$/, "");
  return norm(a) === norm(b);
};

/**
 * The same follow-up, already asked from the same answer or tour: its context (that answer, and nothing else) is the
 * same, so its stored reply replays free. A thread that went further is copied up to that reply, not reused whole.
 */
async function askedBefore(p: Prepared, root: NonNullable<ThreadStart["root"]>, question: string, mode: FollowUpMode) {
  for (const entry of await getThreadIndex(p)) {
    const t = await getThread(p, entry.id);
    const [first, second] = t?.turns ?? [];
    if (!t || first?.refId !== root.id || !second || !sameQuestion(second.question, question) || (second.kind === "tour") !== (mode === "tour")) continue;
    const answer = second.kind === "answer" ? await getStoredAnswer(p, second.refId) : null;
    const tour = second.kind === "tour" ? await getStoredTour(p.info, second.refId) : null;
    if (second.kind === "answer" && (!answer || !!answer.thorough !== (mode === "thorough"))) continue;
    if (second.kind === "tour" && !tour) continue;
    const thread = t.turns.length === 2 ? t : { ...newThread(first), turns: [first, second] };
    return { thread, answer: answer ?? undefined, tour: tour ?? undefined, copied: thread !== t };
  }
  return null;
}

/** A thread holding just a stored answer or tour, so a follow-up can come later (agents use this). No model call. */
export async function startThread(p: Prepared, root: NonNullable<ThreadStart["root"]>): Promise<Thread> {
  const thread = newThread(await rootTurn(p, root));
  await putJSON(key(p, thread.id), thread);
  return thread;
}

export async function askFollowUp(
  p: Prepared,
  atlas: Atlas,
  start: ThreadStart,
  question: string,
  mode: FollowUpMode,
  who: string,
  stream?: StreamHooks,
): Promise<{ thread: Thread; answer?: StoredAnswer; tour?: Tour; fromCache: boolean }> {
  let thread = start.thread ? await getThread(p, start.thread) : null;
  if (start.thread && !thread) throw new RepoError("That conversation isn't stored for this commit.", 404);
  if (!thread) {
    if (!start.root) throw new RepoError("A follow-up needs an answer or tour to follow.", 400);
    const again = await askedBefore(p, start.root, question, mode);
    if (again) {
      if (again.copied) await saveThread(p, again.thread);
      return { thread: again.thread, answer: again.answer, tour: again.tour, fromCache: true };
    }
    thread = newThread(await rootTurn(p, start.root));
  }
  const follow = { context: threadContext(thread.turns), scope: `thread:${thread.id}` };

  let turn: ThreadTurn;
  let reply: { answer?: StoredAnswer; tour?: Tour; fromCache: boolean };
  if (mode === "tour") {
    const r = await getTour(p, atlas, question, who, follow);
    turn = tourTurn(r.tour);
    reply = { tour: r.tour, fromCache: r.fromCache };
  } else {
    const r = await getAnswer(p, atlas, question, who, { stream, thorough: mode === "thorough", follow });
    turn = answerTurn(r.answer);
    reply = { answer: r.answer, fromCache: r.fromCache };
  }

  // Asking the same follow-up again replays it; it isn't added twice.
  if (!thread.turns.some((t) => t.refId === turn.refId)) thread = { ...thread, turns: [...thread.turns, turn], at: Date.now() };
  await saveThread(p, thread);
  return { thread, ...reply };
}

/** Stores a thread and lists it with the repo's conversations. */
async function saveThread(p: Prepared, thread: Thread) {
  await putJSON(key(p, thread.id), thread);
  const index = await getThreadIndex(p);
  await putJSON(`${commitKey(p)}/threads.json`, [
    ...index.filter((t) => t.id !== thread.id),
    { id: thread.id, title: thread.turns[0].title, turns: thread.turns.length, at: thread.at } satisfies ThreadIndexEntry,
  ]);
}
