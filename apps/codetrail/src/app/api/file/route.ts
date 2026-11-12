// A file from Codetrail's stored copy of the commit, as plain text: every text file in the repo can be opened in
// the app, whether or not it was sent to the model, without touching GitHub's rate limits. Pull requests' changed
// files are stored under their head commit, so they're served the same way.
import { z } from "zod";
import { errorResponse, repoAt } from "@/server/http";
import { fileFromStore } from "@/server/store";
import { storeKey } from "@/server/trail/service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { owner, repo, sha } = repoAt.parse(Object.fromEntries(url.searchParams));
    const path = z.string().min(1).max(500).parse(url.searchParams.get("path"));
    // Only what's stored: the app prepares a commit before opening its files, and a miss falls back to GitHub's
    // raw file in the browser (never a whole-repo download here).
    const text = await fileFromStore(storeKey(owner, repo, sha), path);
    if (text === null) return new Response("Not in Codetrail's copy of this commit.", { status: 404 });
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });
  } catch (error) {
    return errorResponse(error);
  }
}
