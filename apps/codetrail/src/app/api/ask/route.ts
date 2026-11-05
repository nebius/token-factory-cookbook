// Ask answers with generative UI. POST streams the answer (SSE) as DeepSeek writes it, standalone or as a follow-up
// in a conversation (`thread`, or `root` to start one), or as Research (a plan, rounds of findings, then the answer);
// GET replays a stored one.
import { NextResponse } from "next/server";
import { z } from "zod";
import { runIdOf } from "@/server/cancel";
import { callerOf, errorResponse, repoAt, sse, threadStart, refOf } from "@/server/http";
import { recordReplay } from "@/server/stats";
import { getAnswer, getStoredAnswer } from "@/server/trail/ask";
import { getResearch } from "@/server/trail/research";
import { askFollowUp, type ThreadStart } from "@/server/trail/threads";
import { getAtlas, getLedger, prepare } from "@/server/trail/service";

export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(url.searchParams));
    const id = z.string().regex(/^[0-9a-f]{12}$/).parse(url.searchParams.get("id"));
    const answer = await getStoredAnswer(await prepare(refOf({ owner, repo, sha, scope })), id);
    if (!answer) return NextResponse.json({ error: "No such answer." }, { status: 404 });
    await recordReplay();
    return NextResponse.json({ answer });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  let body: { owner: string; repo: string; sha: string; scope?: string; question: string; mode: "answer" | "thorough" | "research" } & ThreadStart;
  let who: string;
  let runId: string | undefined;
  try {
    const raw = await req.json();
    runId = runIdOf(raw);
    body = {
      ...repoAt.parse(raw),
      ...threadStart.parse(raw),
      question: z.string().trim().min(3).max(300).parse(raw.question),
      mode: z.enum(["answer", "thorough", "research"]).default("answer").parse(raw.mode),
    };
    who = await callerOf(req);
  } catch (error) {
    return errorResponse(error);
  }
  return sse(async (send) => {
    let last = 0;
    const p = await prepare(refOf(body));
    const { atlas } = await getAtlas(p, who);
    const stream = {
      onReasoning: (chars: number) => {
        if (Date.now() - last > 400) {
          last = Date.now();
          send({ type: "thinking", chars });
        }
      },
      onContent: (text: string) => {
        if (Date.now() - last > 150) {
          last = Date.now();
          send({ type: "text", text });
        }
      },
    };
    if (body.mode === "research") {
      // Research answers a new question: the stages show as they go.
      const { answer, fromCache } = await getResearch(p, atlas, body.question, who, { stream, onStage: (s) => send({ type: "stage", ...s }) });
      send({ type: "done", answer, fromCache, ledger: await getLedger(p.info) });
    } else if (body.thread || body.root) {
      const { thread, answer, fromCache } = await askFollowUp(p, atlas, body, body.question, body.mode, who, stream);
      send({ type: "done", answer, fromCache, thread, ledger: await getLedger(p.info) });
    } else {
      const { answer, fromCache } = await getAnswer(p, atlas, body.question, who, { stream, thorough: body.mode === "thorough" });
      send({ type: "done", answer, fromCache, ledger: await getLedger(p.info) });
    }
  }, runId);
}
