// GET: a stored tour by id. POST: a tour answering a question (stored per commit and question), standalone or as a
// follow-up in a conversation.
import { NextResponse } from "next/server";
import { asRun, runIdOf } from "@/server/cancel";
import { z } from "zod";
import { callerOf, errorResponse, repoAt, threadStart, refOf } from "@/server/http";
import { recordReplay } from "@/server/stats";
import { getAtlas, getLedger, getStoredTour, getTour, prepare, repoInfo } from "@/server/trail/service";
import { askFollowUp } from "@/server/trail/threads";

export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(url.searchParams));
    const id = z.string().regex(/^[0-9a-f]{12}$/).parse(url.searchParams.get("id"));
    const tour = await getStoredTour({ ...(await repoInfo({ owner, repo, ref: sha })), scope }, id);
    if (!tour) return NextResponse.json({ error: "No such tour." }, { status: 404 });
    // Opening a stored tour costs nothing: it's counted as a free replay.
    await recordReplay();
    return NextResponse.json({ tour });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { owner, repo, sha, scope } = repoAt.parse(body);
    const { question } = z.object({ question: z.string().trim().min(3).max(300) }).parse(body);
    const who = await callerOf(req);
    return await asRun(runIdOf(body), async () => {
      const p = await prepare(refOf({ owner, repo, sha, scope }));
      const { atlas } = await getAtlas(p, who);
      const start = threadStart.parse(body);
      if (start.thread || start.root) {
        const { thread, tour, fromCache } = await askFollowUp(p, atlas, start, question, "tour", who);
        return NextResponse.json({ tour, fromCache, thread, ledger: await getLedger(p.info) });
      }
      const { tour, fromCache } = await getTour(p, atlas, question, who);
      return NextResponse.json({ tour, fromCache, ledger: await getLedger(p.info) });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
