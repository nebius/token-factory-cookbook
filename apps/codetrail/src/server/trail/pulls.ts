// Pull-request tours. GitHub gives the facts and the PR's versions of changed files (no model); DeepSeek then gets
// the repo it already read (the cached prefix) plus only the change, and writes a tour through it with notes for
// a reviewer. Steps and notes are checked against the PR's code, and the tour is stored per head commit.
import { env } from "@/env";
import { pullJsonSchema, pullSchema, type Atlas, type PullFacts, type PullIndexEntry, type PullView, type Tour } from "@/lib/schemas";
import { AIError, chatJSON, type StreamHooks } from "@/server/ai/nebius";
import { fetchFilesAt, getPullFacts, RepoError, type RepoFile } from "@/server/repo/github";
import { fileFromStore, getJSON, putJSON, saveFiles } from "@/server/store";
import { checkReview, groundSteps, overlayFiles } from "./ground";
import { pullTask, rankChanged } from "./prompts";
import { checkLimitsFor, commitKey, getStoredTour, latestReadSha, questionIdOf, shared, storeKey, trackedCall, type Prepared } from "./service";

const MAX_HEAD_FILES = 40;
const MAX_HEAD_BYTES = 400_000;
/** Output of a PR tour, reasoning included (a tour is about 5K; the review notes add a little). */
const PR_OUTPUT = 6_000;

type PreparedPull = { facts: PullFacts; files: Map<string, string>; task: string; view: Omit<PullView, "tourId"> };

// PR facts change with every push, so they're cached briefly; everything keyed by the head commit is kept.
const factsCache = new Map<string, { at: number; value: Promise<PullFacts> }>();
const preparedPulls = new Map<string, Promise<PreparedPull>>();

function pullFacts(p: Prepared, n: number): Promise<PullFacts> {
  const key = `${p.info.owner}/${p.info.repo}#${n}`.toLowerCase();
  const hit = factsCache.get(key);
  if (hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.value;
  const value = getPullFacts(p.info, n, env.GITHUB_TOKEN, env.AUTH_MODE === "none");
  value.catch(() => factsCache.delete(key));
  factsCache.set(key, { at: Date.now(), value });
  if (factsCache.size > 300) factsCache.delete(factsCache.keys().next().value!);
  return value;
}

const pullTourId = (n: number, headSha: string) => questionIdOf(`pr:${n}@${headSha}`);
export const getPullIndex = (p: Prepared) => getJSON<PullIndexEntry[]>(`${commitKey(p)}/pulls.json`).then((x) => x ?? []);

/** The PR's versions of its changed files: stored under the head commit after the first fetch. */
async function headFiles(p: Prepared, facts: PullFacts): Promise<RepoFile[]> {
  const key = storeKey(p.info.owner, p.info.repo, facts.headSha);
  const marker = `${key}/pull-files.json`;
  const stored = await getJSON<string[]>(marker);
  if (stored) {
    const texts = await Promise.all(stored.map((path) => fileFromStore(key, path)));
    return stored.flatMap((path, i) => (texts[i] === null ? [] : [{ path, text: texts[i]!, lines: texts[i]!.split("\n").length }]));
  }
  const wanted = rankChanged(facts.files).slice(0, MAX_HEAD_FILES).map((f) => f.path);
  // A deleted fork's commits stay reachable from the base repo (GitHub keeps refs/pull/N/head).
  const repo = facts.headRepo ?? `${p.info.owner}/${p.info.repo}`;
  const files = await fetchFilesAt(repo, facts.headSha, wanted, { token: env.GITHUB_TOKEN, private: p.info.private, maxBytes: MAX_HEAD_BYTES });
  await saveFiles(key, files);
  await putJSON(marker, files.map((f) => f.path));
  return files;
}

async function preparePull(p: Prepared, atlas: Atlas | null, n: number): Promise<PreparedPull> {
  const facts = await pullFacts(p, n);
  const key = `${commitKey(p)}/pulls/${n}@${facts.headSha}/${atlas ? "mapped" : "unmapped"}`;
  let ready = preparedPulls.get(key);
  if (!ready) {
    ready = (async () => {
      const head = await headFiles(p, facts);
      const nodes = (atlas?.nodes ?? []).map((x) => ({ id: x.id, label: x.label, files: x.files }));
      const task = pullTask(facts, { sha: p.info.sha, ref: p.info.ref }, head, nodes);
      const price = p.summary.price;
      const estimate = price
        ? {
            cached: p.summary.tokens * price.cached + task.tokens * price.input + PR_OUTPUT * price.output,
            cold: (p.summary.tokens + task.tokens) * price.input + PR_OUTPUT * price.output,
          }
        : { cached: null, cold: null };
      return { facts, files: overlayFiles(p.files, head, facts.files), task: task.text, view: { facts, tokens: task.tokens, sent: task.sent, estimate } };
    })();
    ready.catch(() => preparedPulls.delete(key));
    preparedPulls.set(key, ready);
    if (preparedPulls.size > 20) preparedPulls.delete(preparedPulls.keys().next().value!);
  }
  return ready;
}

/** What the PR page shows before any model call. If GitHub can't be reached, the latest stored tour still opens. */
export async function getPullView(p: Prepared, atlas: Atlas | null, n: number): Promise<PullView> {
  try {
    const { view } = await preparePull(p, atlas, n);
    const tourId = pullTourId(n, view.facts.headSha);
    return { ...view, tourId: (await getStoredTour(p.info, tourId)) ? tourId : null };
  } catch (error) {
    const latest = (await getPullIndex(p)).filter((e) => e.number === n).sort((a, b) => b.at - a.at)[0];
    const tour = latest && (await getStoredTour(p.info, latest.id));
    if (!(error instanceof RepoError) || !tour?.pull) throw error;
    return { facts: tour.pull, tourId: tour.id, tokens: 0, sent: { head: 0, patches: 0, left: [] }, estimate: { cached: null, cold: null } };
  }
}

export async function getPullTour(p: Prepared, atlas: Atlas, n: number, who: string, stream?: StreamHooks): Promise<{ tour: Tour; fromCache: boolean }> {
  const pp = await preparePull(p, atlas, n);
  const id = pullTourId(n, pp.facts.headSha);
  const stored = await getStoredTour(p.info, id);
  if (stored) return { tour: stored, fromCache: true };
  return shared(`${commitKey(p)}/tours/${id}`, () => tourPull(p, atlas, pp, n, id, who, stream));
}

async function tourPull(p: Prepared, atlas: Atlas, pp: PreparedPull, n: number, id: string, who: string, stream?: StreamHooks): Promise<{ tour: Tour; fromCache: boolean }> {
  await checkLimitsFor(who, "asks");

  const nodes = atlas.nodes.map((x) => ({ id: x.id, files: x.files }));
  const { result, record } = await trackedCall(p, "pr", `PR #${n}: ${pp.facts.title}`, (cfg) =>
    chatJSON(cfg, {
      prefix: p.prefix,
      task: pp.task,
      schema: pullSchema,
      jsonSchema: pullJsonSchema,
      name: "codetrail_pr",
      cacheKey: `codetrail:${p.info.owner}/${p.info.repo}@${p.info.sha}`,
      effort: "medium",
      maxTokens: 24_000,
      stream,
      // Same rule as tours: a repair turn resends the repo, so only when too much would be dropped.
      check: (t) => {
        const g = groundSteps(t.steps, pp.files, nodes);
        return g.steps.length < 2 || g.dropped / t.steps.length > 0.3 ? g.problems : [];
      },
    }),
  );

  const grounded = groundSteps(result.steps, pp.files, nodes);
  if (grounded.steps.length < 2) throw new AIError("The model's steps couldn't be matched to the PR's code, so no tour was saved. Try again.", "invalid_output");
  const known = new Set(atlas.nodes.map((x) => x.id));
  const tour: Tour = {
    id,
    question: `PR #${n}: ${pp.facts.title}`,
    title: result.title,
    summary: result.summary,
    steps: grounded.steps,
    check: { corrected: grounded.corrected, dropped: grounded.dropped },
    calls: [record],
    pull: pp.facts,
    review: checkReview(result.review, pp.files),
    modules: [...new Set([...result.modules.filter((m) => known.has(m)), ...grounded.steps.map((s) => s.node)])],
  };
  await putJSON(`${commitKey(p)}/tours/${id}.json`, tour);
  const index = await getPullIndex(p);
  await putJSON(`${commitKey(p)}/pulls.json`, [
    ...index.filter((e) => e.id !== id),
    { id, number: n, title: pp.facts.title, headSha: pp.facts.headSha, steps: tour.steps.length, review: tour.review!.length, cost: record.cost, at: record.at } satisfies PullIndexEntry,
  ]);
  return { tour, fromCache: false };
}

/** A stored PR tour for link previews, from the repo's latest read (no GitHub call). */
export async function storedPull(owner: string, repo: string, n: number): Promise<PullIndexEntry | null> {
  const sha = await latestReadSha(owner, repo);
  if (!sha) return null;
  const index = (await getJSON<PullIndexEntry[]>(`${storeKey(owner, repo, sha)}/pulls.json`)) ?? [];
  return index.filter((e) => e.number === n).sort((a, b) => b.at - a.at)[0] ?? null;
}
