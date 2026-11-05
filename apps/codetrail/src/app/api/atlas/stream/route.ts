// The first read as a live stream (SSE): reasoning progress, then modules, links and tour steps as DeepSeek
// writes them, then the final checked map. What's streamed is for display only; the checks run on the
// finished answer exactly as in /api/atlas.
import { Allow, parse } from "partial-json";
import { runIdOf } from "@/server/cancel";
import { callerOf, errorResponse, repoAt, sse, refOf } from "@/server/http";
import { getAtlas, getLedger, getTourIndex, prepare, withActuals } from "@/server/trail/service";

export const maxDuration = 300;

type PartialAtlas = {
  summary?: string;
  nodes?: { id?: string; label?: string; kind?: string }[];
  edges?: { from?: string; to?: string; label?: string }[];
  tours?: { title?: string }[];
  firstTour?: { title?: string; steps?: { title?: string; node?: string }[] };
};

export async function POST(req: Request) {
  let body: { owner: string; repo: string; sha: string; scope?: string };
  let who: string;
  let runId: string | undefined;
  try {
    const raw = await req.json();
    body = repoAt.parse(raw);
    runId = runIdOf(raw);
    who = await callerOf(req);
  } catch (error) {
    return errorResponse(error);
  }
  return sse(async (send) => {
    let lastSent = 0;
    let lastSize = 0;
    const p = await prepare(refOf(body));
    send({ type: "start", tokens: p.summary.tokens });
    const { atlas } = await getAtlas(p, who, {
      onReasoning: (chars) => {
        const now = Date.now();
        if (now - lastSent > 400) {
          lastSent = now;
          send({ type: "thinking", chars });
        }
      },
      onContent: (soFar) => {
        const now = Date.now();
        if (now - lastSent < 250 || soFar.length - lastSize < 40) return;
        lastSent = now;
        lastSize = soFar.length;
        let partial: PartialAtlas;
        try {
          partial = parse(soFar, Allow.ALL) as PartialAtlas;
        } catch {
          return;
        }
        send({
          type: "partial",
          chars: soFar.length,
          summary: partial.summary ?? null,
          nodes: (partial.nodes ?? []).filter((n) => n?.id && n.label && n.kind).map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
          edges: (partial.edges ?? []).filter((e) => e?.from && e.to && e.label).map((e) => ({ from: e.from, to: e.to, label: e.label })),
          tours: (partial.tours ?? []).map((t) => t?.title).filter(Boolean),
          steps: (partial.firstTour?.steps ?? []).filter((s) => s?.title).map((s) => ({ title: s.title, node: s.node ?? null })),
        });
      },
    });
    const [ledger, tours] = await Promise.all([getLedger(p.info), getTourIndex(p.info)]);
    send({ type: "done", atlas, ledger, tours, summary: withActuals(p.summary, ledger) });
  }, runId);
}
