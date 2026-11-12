// Groups an older map into architecture layers (one small call on the module list), then the map is saved with them.
import { NextResponse } from "next/server";
import { asRun, runIdOf } from "@/server/cancel";
import { callerOf, errorResponse, repoAt, refOf } from "@/server/http";
import { addLayers } from "@/server/trail/layers";
import { getAtlas, getLedger, prepare } from "@/server/trail/service";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { owner, repo, sha, scope } = repoAt.parse(body);
    const who = await callerOf(req);
    return await asRun(runIdOf(body), async () => {
      const p = await prepare(refOf({ owner, repo, sha, scope }));
      const { atlas } = await getAtlas(p, who);
      return NextResponse.json({ atlas: await addLayers(p, atlas, who), ledger: await getLedger(p.info) });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
