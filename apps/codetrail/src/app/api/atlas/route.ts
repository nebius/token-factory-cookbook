// Reads the whole repository with the model and returns the module map (stored per commit).
import { NextResponse } from "next/server";
import { asRun, runIdOf } from "@/server/cancel";
import { callerOf, errorResponse, repoAt, refOf } from "@/server/http";
import { getAtlas, getLedger, getTourIndex, prepare, withActuals } from "@/server/trail/service";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { owner, repo, sha, scope } = repoAt.parse(body);
    const who = await callerOf(req);
    return await asRun(runIdOf(body), async () => {
      const p = await prepare(refOf({ owner, repo, sha, scope }));
      const { atlas, fromCache } = await getAtlas(p, who);
      const [ledger, tours] = await Promise.all([getLedger(p.info), getTourIndex(p.info)]);
      return NextResponse.json({ atlas, fromCache, ledger, tours, summary: withActuals(p.summary, ledger) });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
