// Opens a CodeTour file from a GitHub or gist link as one of this commit's tours. Free; on a hosted instance it
// needs a signed-in account.
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { callerOf, errorResponse, repoAt, refOf } from "@/server/http";
import { AuthRequiredError } from "@/server/quota";
import { importTourFromUrl } from "@/server/trail/tour-url";
import { getAtlas, prepare } from "@/server/trail/service";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { owner, repo, sha, scope } = repoAt.parse(body);
    const { url } = z.object({ url: z.string().min(8).max(2000) }).parse(body);
    const who = await callerOf(req);
    if (env.AUTH_MODE !== "none" && !who.startsWith("user:")) throw new AuthRequiredError("Sign in with GitHub to add a tour.");
    const p = await prepare(refOf({ owner, repo, sha, scope }));
    const { atlas } = await getAtlas(p, who);
    return NextResponse.json(await importTourFromUrl(p, atlas, url));
  } catch (error) {
    return errorResponse(error);
  }
}
