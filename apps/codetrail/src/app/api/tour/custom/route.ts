// Saves a tour written (or edited) by hand. Free; on a hosted instance it needs a signed-in account.
import { NextResponse } from "next/server";
import { env } from "@/env";
import { callerOf, errorResponse, repoAt, refOf } from "@/server/http";
import { AuthRequiredError } from "@/server/quota";
import { customTourInput, saveCustomTour } from "@/server/trail/custom";
import { getAtlas, prepare } from "@/server/trail/service";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { owner, repo, sha, scope } = repoAt.parse(body);
    const input = customTourInput.parse(body);
    const who = await callerOf(req);
    if (env.AUTH_MODE !== "none" && !who.startsWith("user:")) throw new AuthRequiredError("Sign in with GitHub to save a tour.");
    const p = await prepare(refOf({ owner, repo, sha, scope }));
    const { atlas } = await getAtlas(p, who);
    const saved = await saveCustomTour(p, atlas, input);
    if ("problems" in saved) return NextResponse.json({ error: saved.problems.join(" ") }, { status: 400 });
    return NextResponse.json(saved);
  } catch (error) {
    return errorResponse(error);
  }
}
