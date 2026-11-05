// The function call graph of one file at a commit: its functions, what they call and who calls them, worked out
// from the stored code. Free: no model call.
import { NextResponse } from "next/server";
import { z } from "zod";
import { callsOf, type Calls } from "@/server/repo/calls";
import { errorResponse, repoAt, refOf } from "@/server/http";
import { prepare } from "@/server/trail/service";

const cache = new Map<string, Calls>();

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(url.searchParams));
    const path = z.string().min(1).max(500).parse(url.searchParams.get("path"));
    const key = `${owner}/${repo}@${sha}:${path}`;
    let calls = cache.get(key);
    if (!calls) {
      const p = await prepare(refOf({ owner, repo, sha, scope }));
      calls = callsOf(p.snapshot.files, p.graph, path);
      cache.set(key, calls);
      if (cache.size > 300) cache.delete(cache.keys().next().value!);
    }
    return NextResponse.json({ calls });
  } catch (error) {
    return errorResponse(error);
  }
}
