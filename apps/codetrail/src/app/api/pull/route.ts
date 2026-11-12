// A pull-request tour as a live stream (SSE): reasoning progress, then step titles as DeepSeek writes them, then
// the checked tour. Stored per head commit, so the next person opening this PR gets it for free.
import { Allow, parse } from "partial-json";
import { z } from "zod";
import { runIdOf } from "@/server/cancel";
import { callerOf, errorResponse, repoAt, sse, refOf } from "@/server/http";
import { getPullIndex, getPullTour } from "@/server/trail/pulls";
import { getAtlas, getLedger, prepare } from "@/server/trail/service";

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: z.infer<typeof repoAt> & { number: number };
  let who: string;
  let runId: string | undefined;
  try {
    const raw = await req.json();
    body = repoAt.extend({ number: z.number().int().positive() }).parse(raw);
    runId = runIdOf(raw);
    who = await callerOf(req);
  } catch (error) {
    return errorResponse(error);
  }
  return sse(async (send) => {
    let lastSent = 0;
    const p = await prepare(refOf(body));
    const { atlas } = await getAtlas(p, who);
    const { tour, fromCache } = await getPullTour(p, atlas, body.number, who, {
      onReasoning: (chars) => {
        if (Date.now() - lastSent < 400) return;
        lastSent = Date.now();
        send({ type: "thinking", chars });
      },
      onContent: (soFar) => {
        if (Date.now() - lastSent < 300) return;
        lastSent = Date.now();
        try {
          const partial = parse(soFar, Allow.ALL) as { title?: string; steps?: { title?: string }[] };
          send({ type: "partial", title: partial.title ?? null, steps: (partial.steps ?? []).map((s) => s?.title).filter(Boolean) });
        } catch {
          // Not parseable yet.
        }
      },
    });
    const [ledger, pulls] = await Promise.all([getLedger(p.info), getPullIndex(p)]);
    send({ type: "done", tour, fromCache, ledger, pulls });
  }, runId);
}
