// Repo facts, what will be read, and the cost estimate. No AI call: this is free to run. With `pull`, also the
// pull request's facts and what touring it would cost, on top of the repo's latest read.
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseRepoInput } from "@/lib/ref";
import type { PullView } from "@/lib/schemas";
import { errorResponse, repoAt } from "@/server/http";
import { getAnswerIndex } from "@/server/trail/ask";
import { getStoredDocs } from "@/server/trail/docs";
import { getPullIndex, getPullView } from "@/server/trail/pulls";
import { getThreadIndex } from "@/server/trail/threads";
import { freshestRead, getLedger, getStoredAtlas, getTourIndex, importCodeTours, latestReadSha, prepare, withActuals, type Newer } from "@/server/trail/service";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { input, pull, scope } = z
      .object({ input: z.string().min(1).max(300), pull: z.number().int().positive().optional(), scope: repoAt.shape.scope })
      .parse(await req.json());
    let ref = parseRepoInput(input);
    if (ref && scope) ref = { ...ref, scope };
    if (!ref) return NextResponse.json({ error: "That doesn't look like a GitHub repository. Try owner/repo or a github.com link." }, { status: 400 });
    // A PR is toured on top of the commit already read, so opening one never forces a new read.
    let newer: Newer | null = null;
    if (pull && !ref.ref) ref.ref = await latestReadSha(ref.owner, ref.repo);
    else ({ ref, newer } = await freshestRead(ref));
    const p = await prepare(ref);
    const atlas = await getStoredAtlas(p.info);
    if (atlas) await importCodeTours(p, atlas).catch(() => {});
    const [tours, ledger, answers, docs, pulls, threads] = await Promise.all([getTourIndex(p.info), getLedger(p.info), getAnswerIndex(p), getStoredDocs(p), getPullIndex(p), getThreadIndex(p)]);
    let pullView: PullView | null = null;
    let pullError: string | null = null;
    if (pull) {
      // A missing PR shouldn't hide the repo: the page still opens, with the reason shown.
      pullView = await getPullView(p, atlas, pull).catch((e: Error) => {
        pullError = e instanceof Error && e.name === "RepoError" ? e.message : "Couldn't load that pull request from GitHub.";
        return null;
      });
    }
    return NextResponse.json({ summary: withActuals(p.summary, ledger), atlas, tours, ledger, answers, docs, pulls, threads, newer, pull: pullView, pullError });
  } catch (error) {
    return errorResponse(error);
  }
}
