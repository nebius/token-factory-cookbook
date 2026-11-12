// Written docs: GET returns stored docs (free), POST writes them with one call on the cached repo.
import { NextResponse } from "next/server";
import { asRun, runIdOf } from "@/server/cancel";
import { callerOf, errorResponse, repoAt, refOf } from "@/server/http";
import { getDocs, getStoredDocs } from "@/server/trail/docs";
import { getAtlas, getLedger, prepare } from "@/server/trail/service";

export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(new URL(req.url).searchParams));
    const docs = await getStoredDocs(await prepare(refOf({ owner, repo, sha, scope })));
    return docs ? NextResponse.json({ docs }) : NextResponse.json({ error: "No docs yet." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { owner, repo, sha, scope } = repoAt.parse(body);
    const who = await callerOf(req);
    return await asRun(runIdOf(body), async () => {
      const p = await prepare(refOf({ owner, repo, sha, scope }));
      const { atlas } = await getAtlas(p, who);
      const { docs, fromCache } = await getDocs(p, atlas, who);
      return NextResponse.json({ docs, fromCache, ledger: await getLedger(p.info) });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
