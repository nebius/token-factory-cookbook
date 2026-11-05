// A stored conversation: its turns, each pointing at a stored answer or tour. Free to replay.
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, repoAt, refOf } from "@/server/http";
import { prepare } from "@/server/trail/service";
import { getThread } from "@/server/trail/threads";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(url.searchParams));
    const id = z.string().regex(/^[0-9a-f]{12}$/).parse(url.searchParams.get("id"));
    const thread = await getThread(await prepare(refOf({ owner, repo, sha, scope })), id);
    if (!thread) return NextResponse.json({ error: "No such conversation." }, { status: 404 });
    return NextResponse.json({ thread });
  } catch (error) {
    return errorResponse(error);
  }
}
