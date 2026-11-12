// The whole flow for one repository: facts from GitHub → tarball → import graph → pack → map → tours.
// Everything is pinned to a commit and stored, so a repository someone already traced costs nothing to open.
import { createHash, randomUUID } from "node:crypto";
import { env, MODEL_LABEL } from "@/env";
import { atlasJsonSchema, atlasSchema, onCode, tourJsonSchema, tourSchema, type Atlas, type CallRecord, type RepoSummary, type Step, type Tour, type TourAnswer, type TourIndexEntry } from "@/lib/schemas";
import { getPrices, nebius } from "@/server/ai/client";
import { AIError, chatJSON, type CallUsage, type Message, type StreamHooks } from "@/server/ai/nebius";
import { costOf } from "@/server/ai/pricing";
import { commitsAhead, downloadSnapshot, getRepoInfo, RepoError, type RepoInfo, type Snapshot } from "@/server/repo/github";
import { localInfo, readLocal } from "@/server/repo/local";
import { buildImportGraph, summarizeGraph, type ImportGraph } from "@/server/repo/graph";
import { estimateTokens, packRepo, type Pack } from "@/server/repo/pack";
import { LOCAL_OWNER, type RepoRef } from "@/lib/ref";
import { appendCall, fileFromStore, getCalls, getJSON, keysLike, loadSnapshot, putJSON, saveSnapshot } from "@/server/store";
import { recordCall, spentToday } from "@/server/stats";
import { AuthRequiredError, takeQuota, type QuotaKind } from "@/server/quota";
import { savedBy } from "@/lib/cache";
import { modelsOf } from "@/lib/models";
import { inScope, parseScope, scopeHash, scopeLabel, scopeString } from "@/lib/scope";
import { shared } from "@/server/inflight";

export { shared };
import { carryTour } from "./carry";
import { groundSteps, nodeForFile, resolvePath } from "./ground";
import { ATLAS_TASK, repoPrefix, tourTask } from "./prompts";

export type Prepared = {
  info: RepoInfo;
  snapshot: Snapshot;
  graph: ImportGraph;
  pack: Pack;
  /** Text of the files the model saw, by path (for checking steps). */
  files: Map<string, string>;
  prefix: Message[];
  summary: RepoSummary;
};

/** Where a read is stored. A read of only some folders gets its own key next to the full read's. */
const base = (info: Pick<RepoInfo, "owner" | "repo" | "sha"> & { scope?: string }) => {
  const scope = parseScope(info.scope);
  return `repos/${info.owner.toLowerCase()}/${info.repo.toLowerCase()}/${info.sha}${scope ? `~${scopeHash(scope)}` : ""}`;
};
const questionId = (q: string) => createHash("sha1").update(q.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 12);

// --- Small in-memory caches (per server instance) ---------------------------------------------------
const infoCache = new Map<string, { at: number; info: Promise<RepoInfo> }>();
const prepared = new Map<string, Promise<Prepared>>();
const remember = <V>(map: Map<string, V>, key: string, value: V, max: number) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value!);
};

export function repoInfo(ref: RepoRef): Promise<RepoInfo> {
  const key = `${ref.owner}/${ref.repo}@${ref.ref ?? ""}`.toLowerCase();
  const local = ref.owner === LOCAL_OWNER;
  const hit = infoCache.get(key);
  // A local folder is re-checked after a few seconds, so an edit shows up as a new "commit" quickly.
  if (hit && Date.now() - hit.at < (local ? 5_000 : 5 * 60 * 1000)) return hit.info;
  // A commit we've already read needs no GitHub call: its facts are stored next to its snapshot.
  const pinned = ref.ref && /^[0-9a-f]{40}$/i.test(ref.ref);
  const info = (pinned ? getJSON<RepoInfo>(`${base({ owner: ref.owner, repo: ref.repo, sha: ref.ref! })}/info.json`) : Promise.resolve(null)).then(
    // Private repos only on self-hosted instances (AUTH_MODE=none): there, nothing stored is shown to others.
    (stored) => stored ?? (local ? localInfo(ref.repo) : getRepoInfo(ref, env.GITHUB_TOKEN, env.AUTH_MODE === "none")),
  );
  info.catch(() => infoCache.delete(key));
  remember(infoCache, key, { at: Date.now(), info }, 200);
  return info;
}

/** Downloads (or loads) the commit, builds the import graph and packs it. No AI. */
export function prepare(ref: RepoRef): Promise<Prepared> {
  const scope = scopeString(parseScope(ref.scope));
  return repoInfo(ref).then((raw) => {
    const info: RepoInfo = scope ? { ...raw, scope } : raw;
    const key = base(info);
    let p = prepared.get(key);
    if (!p) {
      p = build(info);
      p.catch(() => prepared.delete(key));
      remember(prepared, key, p, 6);
    }
    return p;
  });
}

async function build(info: RepoInfo): Promise<Prepared> {
  // The commit's files are stored once, under the full read; a scoped read filters them.
  const full: RepoInfo = { ...info, scope: undefined };
  let snapshot = await loadSnapshot(base(full));
  if (!snapshot) {
    snapshot = info.owner === LOCAL_OWNER ? await readLocal(info.repo) : await downloadSnapshot(info, env.GITHUB_TOKEN);
    await saveSnapshot(base(full), snapshot);
  }
  if (!(await getJSON<RepoInfo>(`${base(full)}/info.json`))) {
    // Keep the branch name for display even when this commit was first opened by its hash.
    await putJSON(`${base(full)}/info.json`, /^[0-9a-f]{40}$/i.test(full.ref) ? { ...full, ref: full.defaultBranch } : full);
  }
  const scope = parseScope(info.scope);
  if (scope) {
    // The scoped read's own facts, so lists can link back to it with its folders.
    if (!(await getJSON<RepoInfo>(`${base(info)}/info.json`))) await putJSON(`${base(info)}/info.json`, { ...full, ref: /^[0-9a-f]{40}$/i.test(full.ref) ? full.defaultBranch : full.ref, scope: info.scope });
    const out = snapshot.files.filter((f) => !inScope(f.path, scope));
    if (!snapshot.files.some((f) => inScope(f.path, scope))) throw new RepoError(`No files in this commit match the chosen folders (${scopeLabel(scope)}).`, 400);
    snapshot = {
      files: snapshot.files.filter((f) => inScope(f.path, scope)),
      images: snapshot.images.filter((i) => inScope(i.path, scope)),
      skipped: [...out.map((f) => ({ path: f.path, reason: "scope" as const })), ...snapshot.skipped.filter((s) => inScope(s.path, scope))],
    };
  }
  const graph = buildImportGraph(snapshot.files);
  // Room for the system prompt, the header and up to six images.
  const pack = packRepo(snapshot.files, graph, env.MAX_REPO_TOKENS - 8_000 - snapshot.images.length * 1_500);
  const graphSummary = summarizeGraph(graph);
  const prefix = repoPrefix(info, pack, graphSummary, snapshot.images, snapshot.skipped.length);
  const included = new Set([...pack.included, ...pack.compressed].map((f) => f.path));
  const files = new Map(snapshot.files.filter((f) => included.has(f.path)).map((f) => [f.path, f.text]));

  const prices = await getPrices();
  const price = prices?.models[env.NEBIUS_MODEL] ?? null;
  const prefixTokens = pack.tokens + estimateTokens(graphSummary) + 1_500 + snapshot.images.length * 1_000;
  const summary: RepoSummary = {
    owner: info.owner,
    repo: info.repo,
    ...(info.scope ? { scope: info.scope } : {}),
    description: info.description,
    stars: info.stars,
    ref: info.ref,
    sha: info.sha,
    htmlUrl: info.htmlUrl,
    private: !!info.private,
    languages: info.languages,
    files: {
      total: snapshot.files.length + snapshot.skipped.length,
      read: pack.included.length,
      compressed: pack.compressed.length,
      overBudget: pack.overBudget.length,
      skipped: snapshot.skipped.length,
      secrets: snapshot.skipped.filter((s) => s.reason === "secret").length,
      images: snapshot.images.map((i) => i.path),
    },
    tokens: prefixTokens,
    lines: pack.included.reduce((n, f) => n + f.lines, 0),
    model: env.NEBIUS_MODEL,
    modelLabel: MODEL_LABEL,
    price,
    prices: prices?.models ?? {},
    estimate: estimateFor(prefixTokens, price),
    entries: graph.entries,
    graphEdges: graph.edges.length,
    read: pack.included.slice(0, 2_000).map((f) => f.path),
    compressed: pack.compressed.slice(0, 2_000).map((f) => f.path),
    fileSizes: pack.included.slice(0, 2_000).map((f) => [f.path, f.lines, f.tokens] as [string, number, number]),
    otherFiles: [
      ...pack.compressed.map((f) => [f.path, f.lines, "signatures"] as [string, number, "signatures"]),
      ...pack.overBudget.map((f) => [f.path, f.lines, "left out"] as [string, number, "left out"]),
    ].slice(0, 3_000),
    ...(() => {
      const index = new Map(pack.included.slice(0, 2_000).map((f, i) => [f.path, i]));
      const kept = graph.edges
        .map(([a, b]) => ({ pair: [index.get(a), index.get(b)] as const, line: graph.lines.get(`${a}\u0000${b}`) ?? null }))
        .filter((e): e is { pair: [number, number]; line: number | null } => e.pair[0] !== undefined && e.pair[1] !== undefined)
        .slice(0, 4_000);
      return { imports: kept.map((e) => e.pair), importLines: kept.map((e) => e.line) };
    })(),
    overBudget: pack.overBudget.slice(0, 300).map((f) => f.path),
    skippedSample: snapshot.skipped.slice(0, 300).map((s) => ({ path: s.path, reason: s.reason })),
  };
  return { info, snapshot, graph, pack, files, prefix, summary };
}

/**
 * What reading costs, from the live price. Output sizes are typical of our runs, reasoning included: about
 * 8K for the map + main tour, 5K for a tour. `followUpCold` is a tour that misses Token Factory's cache
 * (the first few calls on a new repo can, since the cache is per server).
 */
function estimateFor(prefixTokens: number, price: Prepared["summary"]["price"]): RepoSummary["estimate"] {
  if (!price) return { firstRead: null, followUp: null, followUpCold: null };
  return {
    firstRead: prefixTokens * price.input + 8_000 * price.output,
    followUp: prefixTokens * price.cached + 500 * price.input + 5_000 * price.output,
    followUpCold: prefixTokens * price.input + 5_000 * price.output,
  };
}

/** Once the repo has been read, the real prompt size from Token Factory replaces the estimate. */
export function withActuals(summary: RepoSummary, ledger: CallRecord[]): RepoSummary {
  const read = ledger.find((c) => c.kind === "atlas");
  if (!read) return summary;
  const tokens = Math.round(read.usage.input / Math.max(1, read.attempts));
  return { ...summary, tokens, tokensMeasured: true, estimate: estimateFor(tokens, summary.price) };
}

// --- One model call per piece of work -------------------------------------------------------------------
// --- Spend and rate limits -------------------------------------------------------------------------
const hits = new Map<string, number[]>();

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/**
 * Before any new model call. `who` is "user:<id>", "anon:<ip>", "mcp:<ip>" or a local caller ("mcp-local",
 * "eval"). The daily dollar cap always applies; with AUTH_MODE=github, new work needs a GitHub account (or the
 * hosted MCP, limited per IP) and counts against the free daily quota.
 */
async function checkLimits(who: string, kind: QuotaKind) {
  // Local and self-hosted runs (AUTH_MODE=none, no budget set) have no limits at all.
  if (env.DAILY_BUDGET_USD > 0 && (await spentToday()) >= env.DAILY_BUDGET_USD) {
    throw new LimitError("Today's AI budget for the hosted app is used up. Repos already traced still open, or run Codetrail yourself with your own key.");
  }
  if (env.AUTH_MODE === "github") {
    if (who.startsWith("anon:")) throw new AuthRequiredError();
    if (who.startsWith("user:") || who.startsWith("mcp:")) await takeQuota(who, kind);
    // A burst guard for the hosted app on top of the daily quota.
    const now = Date.now();
    const recent = (hits.get(who) ?? []).filter((t) => now - t < 10 * 60 * 1000);
    if (recent.length >= 12) throw new LimitError("That's a lot of new tours in a few minutes. Try again shortly.");
    remember(hits, who, [...recent, now], 5_000);
  }
}

/** Runs one structured call and returns its priced record (all attempts, repair turns included). */
async function tracked<T>(kind: CallRecord["kind"], label: string, run: (cfg: ReturnType<typeof nebius>) => Promise<T>) {
  const calls: CallUsage[] = [];
  const priced = async () => {
    const prices = await getPrices();
    const price = prices?.models[env.NEBIUS_MODEL] ?? null;
    const usage = calls.reduce((a, c) => ({ input: a.input + c.input, cached: a.cached + c.cached, output: a.output + c.output }), { input: 0, cached: 0, output: 0 });
    const costs = calls.map((c) => costOf(prices, c.model, c));
    const cost = costs.some((c) => c === null) ? null : costs.reduce<number>((a, c) => a + (c ?? 0), 0);
    return { usage, cost, saved: savedBy(usage, price) };
  };
  let result: T;
  try {
    result = await run(nebius((u) => calls.push(u)));
  } catch (error) {
    // A failed call still cost something: count it in the day's spend.
    if (calls.length) await recordCall(await priced());
    throw error;
  }
  const { usage, cost, saved } = await priced();
  const record: CallRecord = {
    id: randomUUID(),
    kind,
    label,
    model: env.NEBIUS_MODEL,
    usage,
    cost,
    saved,
    ms: calls.reduce((a, c) => a + c.ms, 0),
    at: Date.now(),
    attempts: calls.length,
  };
  await recordCall(record, kind);
  return { result, record };
}

async function appendLedger(info: RepoInfo, record: CallRecord) {
  await appendCall(base(info), record);
}

export const getLedger = (info: Pick<RepoInfo, "owner" | "repo" | "sha">) => getCalls(base(info));
export const getStoredAtlas = (info: RepoInfo) => getJSON<Atlas>(`${base(info)}/atlas.json`);

export const getTourIndex = (info: RepoInfo) => getJSON<TourIndexEntry[]>(`${base(info)}/tours.json`).then((t) => t ?? []);
export const getStoredTour = (info: RepoInfo, id: string) => getJSON<Tour>(`${base(info)}/tours/${id.replace(/[^\w-]/g, "")}.json`);

/** One tour step's place in the code, for the code panel's markers. */
export type TourMark = { tourId: string; tourTitle: string; step: number; title: string; file: string; start: number; end: number };
const marksCache = new Map<string, { key: string; marks: TourMark[] }>();

/** Where every listed tour's steps sit (pull-request and conversation tours aren't listed, so they're left out). */
export async function tourMarks(info: Pick<RepoInfo, "owner" | "repo" | "sha" | "scope">): Promise<TourMark[]> {
  const index = await getTourIndex(info as RepoInfo);
  const key = `${index.length}:${Math.max(0, ...index.map((t) => t.at))}`;
  const hit = marksCache.get(base(info));
  if (hit?.key === key) return hit.marks;
  const tours = await Promise.all(index.map((t) => getStoredTour(info as RepoInfo, t.id)));
  const marks = tours.flatMap((t) => (t ? t.steps.flatMap((s, i) => (onCode(s) && !s.stale ? [{ tourId: t.id, tourTitle: t.title, step: i, title: s.title, file: s.file, start: s.startLine, end: s.endLine }] : [])) : []));
  remember(marksCache, base(info), { key, marks }, 50);
  return marks;
}

// --- The map ----------------------------------------------------------------------------------------
export async function getAtlas(p: Prepared, who: string, stream?: StreamHooks): Promise<{ atlas: Atlas; fromCache: boolean }> {
  const stored = await getStoredAtlas(p.info);
  if (stored) return { atlas: stored, fromCache: true };
  return shared(`${base(p.info)}/atlas`, () => readAtlas(p, who, stream));
}

async function readAtlas(p: Prepared, who: string, stream?: StreamHooks): Promise<{ atlas: Atlas; fromCache: boolean }> {
  await checkLimits(who, "reads");

  // One read of the whole repo returns the map and the main-flow tour together.
  const { result, record } = await tracked("atlas", "Read the repo, map it and trace the main flow", (cfg) =>
    chatJSON(cfg, {
      prefix: p.prefix,
      task: ATLAS_TASK,
      schema: atlasSchema,
      jsonSchema: atlasJsonSchema,
      name: "codetrail_atlas",
      cacheKey: `codetrail:${p.info.owner}/${p.info.repo}@${p.info.sha}`,
      effort: "medium",
      maxTokens: 24_000,
      stream,
      // Unknown paths are dropped in finishAtlas and unverifiable steps when the tour is saved: neither is
      // worth a repair turn that resends the whole repo.
    }),
  );

  const { firstTour, ...answer } = result;
  const atlas = finishAtlas(answer, p, record);
  await putJSON(`${base(p.info)}/atlas.json`, atlas);
  if (atlas.tours[0]) {
    // The map's call already paid for this tour, so its own cost is listed as included.
    await saveTour(p, atlas, atlas.tours[0].question, firstTour, record, null).catch(() => null);
  }
  await appendLedger(p.info, record);
  await addRecent(p.info);
  await importCodeTours(p, atlas).catch((e) => console.error("CodeTour import failed", e));
  await carryTours(p, atlas).catch((e) => console.error("Carrying tours failed", e));
  return { atlas, fromCache: false };
}

/** Keeps only real files and known modules, and marks which connections the imports confirm. */
function finishAtlas(a: Omit<typeof atlasSchema._output, "firstTour">, p: Prepared, call: CallRecord): Atlas {
  const nodes = a.nodes
    .map((n) => ({ ...n, files: [...new Set(n.files.map((f) => resolvePath(f, p.files)).filter((f): f is string => !!f))] }))
    .filter((n) => n.files.length > 0);
  const ids = new Set(nodes.map((n) => n.id));

  // Module-level import edges: every file goes to the module that lists it or shares its folder.
  const moduleOf = new Map<string, string | null>();
  const mod = (f: string) => {
    if (!moduleOf.has(f)) moduleOf.set(f, nodeForFile(f, nodes));
    return moduleOf.get(f)!;
  };
  const imported = new Map<string, number>();
  for (const [from, to] of p.graph.edges) {
    if (!p.files.has(from) || !p.files.has(to)) continue;
    const a1 = mod(from);
    const b1 = mod(to);
    if (a1 && b1 && a1 !== b1) imported.set(`${a1}>${b1}`, (imported.get(`${a1}>${b1}`) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const edges: Atlas["edges"] = [];
  for (const e of a.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to || seen.has(`${e.from}>${e.to}`)) continue;
    seen.add(`${e.from}>${e.to}`);
    edges.push({ ...e, verified: imported.has(`${e.from}>${e.to}`) });
  }
  // Import links the model left out still belong on the map (only the strong ones when the map is busy).
  const minImports = edges.length >= 10 ? 2 : 1;
  for (const [k, n] of [...imported].sort((x, y) => y[1] - x[1]).slice(0, 12)) {
    const [from, to] = k.split(">");
    if (seen.has(k) || seen.has(`${to}>${from}`) || n < minImports) continue;
    seen.add(k);
    edges.push({ from, to, label: "imports", verified: true });
  }
  return { ...a, nodes, edges, call };
}

// --- Tours -----------------------------------------------------------------------------------------
/** In a follow-up: the conversation so far (sent after the cached repo) and the thread the tour belongs to. */
export type Followed = { context: string; scope: string };

export async function getTour(p: Prepared, atlas: Atlas, question: string, who: string, follow?: Followed): Promise<{ tour: Tour; fromCache: boolean }> {
  const q = question.trim().slice(0, 300);
  const id = questionId(follow ? `${follow.scope}:${q}` : q);
  const stored = await getStoredTour(p.info, id);
  if (stored) return { tour: stored, fromCache: true };
  return shared(`${base(p.info)}/tours/${id}`, () => traceTour(p, atlas, q, id, who, follow));
}

async function traceTour(p: Prepared, atlas: Atlas, q: string, id: string, who: string, follow?: Followed): Promise<{ tour: Tour; fromCache: boolean }> {
  await checkLimits(who, "asks");
  const nodes = atlas.nodes.map((n) => ({ id: n.id, label: n.label, files: n.files }));
  const { result, record } = await tracked("tour", q, (cfg) =>
    chatJSON(cfg, {
      prefix: p.prefix,
      task: follow ? `${follow.context}\n\n${tourTask(q, nodes)}` : tourTask(q, nodes),
      schema: tourSchema,
      jsonSchema: tourJsonSchema,
      name: "codetrail_tour",
      cacheKey: `codetrail:${p.info.owner}/${p.info.repo}@${p.info.sha}`,
      effort: "medium",
      // A repair turn resends the repo, so only ask for one when too much of the tour would be dropped.
      check: (t) => {
        const g = groundSteps(t.steps, p.files, nodes);
        return g.steps.length < 3 || g.dropped / t.steps.length > 0.3 ? g.problems : [];
      },
    }),
  );

  const tour = await saveTour(p, atlas, q, result, record, record.cost, follow ? id : undefined);
  await appendLedger(p.info, record);
  if (!tour) throw new AIError("The model's steps couldn't be matched to real code, so no tour was saved. Try asking more specifically.", "invalid_output");
  return { tour, fromCache: false };
}

/**
 * Checks a tour's steps against the code and stores it for everyone. Null when fewer than 2 steps hold up. A tour
 * inside a conversation (`scopedId` given) is stored under that id and left out of the repo's tour list.
 */
async function saveTour(p: Prepared, atlas: Atlas, question: string, answer: TourAnswer, record: CallRecord, cost: number | null, scopedId?: string): Promise<Tour | null> {
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const grounded = groundSteps(answer.steps, p.files, nodes);
  if (grounded.steps.length < 2) return null;
  const id = scopedId ?? questionId(question);
  const tour: Tour = {
    id,
    question,
    title: answer.title,
    summary: answer.summary,
    steps: grounded.steps,
    check: { corrected: grounded.corrected, dropped: grounded.dropped },
    calls: [record],
    ...(answer.followUps?.length ? { followUps: answer.followUps } : {}),
  };
  await putJSON(`${base(p.info)}/tours/${id}.json`, tour);
  if (scopedId) return tour;
  const index = await getTourIndex(p.info);
  await putJSON(`${base(p.info)}/tours.json`, [
    ...index.filter((t) => t.id !== id),
    { id, title: tour.title, question, steps: tour.steps.length, cost, at: record.at },
  ]);
  return tour;
}

// --- Recently traced --------------------------------------------------------------------------------
type RecentRepo = { owner: string; repo: string; description: string | null; stars: number; at: number; sha?: string; private?: boolean; scope?: string };

export const getRecent = () => getJSON<RecentRepo[]>("recent.json").then((r) => r ?? []);
/** One entry per repo (its newest read), for lists that link by repo name: a folder-scoped read shares the repo's link. */
export const newestPerRepo = (list: RecentRepo[]) =>
  list.filter((r, i) => list.findIndex((x) => `${x.owner}/${x.repo}`.toLowerCase() === `${r.owner}/${r.repo}`.toLowerCase()) === i);

async function addRecent(info: RepoInfo) {
  const list = await getRecent();
  const next = [
    { owner: info.owner, repo: info.repo, description: info.description, stars: info.stars, at: Date.now(), sha: info.sha, private: info.private, ...(info.scope ? { scope: info.scope } : {}) },
    ...list.filter((r) => `${r.owner}/${r.repo}~${r.scope ?? ""}`.toLowerCase() !== `${info.owner}/${info.repo}~${info.scope ?? ""}`.toLowerCase()),
  ].slice(0, 24);
  await putJSON("recent.json", next);
}

// --- The landing page's featured trail -----------------------------------------------------------------
export type Featured = { owner: string; repo: string; sha: string; question: string; terrain: string[]; waypoints: { title: string; where: string }[] };

let featured: { at: number; value: Promise<Featured | null> } | undefined;

/**
 * Real code and a real stored tour for the landing hero: the most recent repo that has one. Cached for ten
 * minutes per server instance; null when nothing has been traced yet (the page then uses its built-in one).
 */
export function getFeatured(): Promise<Featured | null> {
  if (featured && Date.now() - featured.at < 10 * 60 * 1000) return featured.value;
  const value = (async () => {
    for (const r of await getRecent()) {
      if (!r.sha) continue;
      const info = { owner: r.owner, repo: r.repo, sha: r.sha };
      const index = await getJSON<TourIndexEntry[]>(`${base(info)}/tours.json`);
      const first = index?.[0];
      if (!first) continue;
      const tour = await getJSON<Tour>(`${base(info)}/tours/${first.id}.json`);
      if (!tour) continue;
      const steps = tour.steps.filter(onCode);
      if (!steps.length) continue;
      const stepFiles = [...new Set(steps.map((s) => s.file))];
      const texts = await Promise.all(stepFiles.map((f) => fileFromStore(base(info), f)));
      const lines = texts.flatMap((t) => t?.split("\n") ?? []).map((l) => l.replace(/\t/g, "  ").slice(0, 90));
      if (lines.length < 20) continue;
      const pick = [0, 0.25, 0.5, 0.75, 1].map((p) => steps[Math.round(p * (steps.length - 1))]);
      return {
        owner: r.owner,
        repo: r.repo,
        sha: r.sha,
        question: tour.question,
        terrain: lines.slice(0, 400),
        waypoints: pick.map((s) => ({ title: s.title, where: `${s.file.split("/").slice(-2).join("/")}:${s.startLine}` })),
      };
    }
    return null;
  })().catch(() => null);
  featured = { at: Date.now(), value };
  return value;
}

// --- The data page ------------------------------------------------------------------------------------------
type RepoSpend = {
  owner: string;
  repo: string;
  description: string | null;
  sha: string;
  scope?: string;
  calls: number;
  input: number;
  cached: number;
  output: number;
  paid: number;
  saved: number;
  /** The models behind these calls, by name. */
  models: string[];
  tours: number;
  at: number;
};

/** Every traced repo with its real spend, from the stored ledgers. Savings use each call's own model's prices. */
export async function getRepoSpend(): Promise<RepoSpend[]> {
  const prices = await getPrices();
  const out: RepoSpend[] = [];
  // Every read on this instance (not just the recent list), so nothing drops off the page.
  for (const r of await listReads()) {
    const info = { owner: r.owner, repo: r.repo, sha: r.sha, scope: r.scope };
    const [ledger, tours] = await Promise.all([getCalls(base(info)), getJSON<TourIndexEntry[]>(`${base(info)}/tours.json`)]);
    const l = ledger ?? [];
    const input = l.reduce((a, c) => a + c.usage.input, 0);
    const cached = l.reduce((a, c) => a + c.usage.cached, 0);
    out.push({
      owner: r.owner,
      repo: r.repo,
      description: r.description,
      sha: r.sha,
      ...(r.scope ? { scope: r.scope } : {}),
      calls: l.length,
      input,
      cached,
      output: l.reduce((a, c) => a + c.usage.output, 0),
      paid: l.reduce((a, c) => a + (c.cost ?? 0), 0),
      saved: l.reduce((a, c) => a + (c.saved ?? savedBy(c.usage, prices?.models[c.model] ?? null) ?? 0), 0),
      models: modelsOf(l),
      tours: tours?.length ?? 0,
      at: r.at,
    });
  }
  return out;
}

// --- CodeTour files written by the maintainers ------------------------------------------------------------
type CodeTourStep = { file?: string; directory?: string; line?: number; pattern?: string; title?: string; description?: string; selection?: { start?: { line?: number }; end?: { line?: number } } };
export type CodeTourFile = { title?: string; description?: string; isPrimary?: boolean; steps?: CodeTourStep[] };

/** Where CodeTour looks for tours: .tours, .github/tours and .vscode/tours (with subfolders), and main.tour. */
export const CODETOUR_PATH = /^(?:(?:.*\/)?(?:\.tours|\.github\/tours|\.vscode\/tours)\/.+\.tour|main\.tour)$/;

/** CodeTour's own order: the primary tour first, then by title, numbers in titles ("1 - Intro") counted as numbers. */
export function orderCodeTours<T extends { path: string; tour: CodeTourFile }>(tours: T[]): T[] {
  const primary = (t: T) => (t.tour.isPrimary || t.path === "main.tour" ? 0 : 1);
  const title = (t: T) => t.tour.title ?? t.path;
  return [...tours].sort((a, b) => primary(a) - primary(b) || title(a).localeCompare(title(b), "en", { numeric: true }));
}

const safeTest = (pattern: string, line: string) => {
  try {
    return new RegExp(pattern).test(line);
  } catch {
    return false;
  }
};

/** One CodeTour step as ours: a file step checked against the code, or a text step (content and folder steps). */
export function codeTourStep(s: CodeTourStep, i: number, files: Map<string, string>, nodes: { id: string; files: string[] }[]): Step | null {
  const title = (s.title ?? `Step ${i + 1}`).slice(0, 80);
  const narration = (s.description ?? "").trim().slice(0, 1200);
  const file = s.file?.replace(/^\.?\//, "");
  if (!file) {
    if (!narration && !s.directory) return null;
    const dir = s.directory ? `\`${s.directory.replace(/^\.?\//, "").replace(/\/?$/, "/")}\` ` : "";
    return { node: "", title, file: "", startLine: 0, endLine: 0, anchor: "", narration: `${dir}${narration}`.trim(), corrected: false };
  }
  const text = files.get(file)?.split("\n");
  if (!text) return null;
  // A `pattern` step names its line by a regular expression instead of a number.
  const byPattern = !s.line && s.pattern ? text.findIndex((l) => safeTest(s.pattern!, l)) + 1 || undefined : undefined;
  const line = s.line ?? byPattern ?? s.selection?.start?.line ?? 1;
  const start = s.selection?.start?.line ?? line;
  const end = Math.min(text.length, Math.max(start, s.selection?.end?.line ?? start + 4));
  const grounded = groundSteps([{ node: "", title, file, startLine: start, endLine: end, anchor: text[line - 1] ?? "", narration: narration || "No description in the tour file." }], files, nodes);
  return grounded.steps[0] ?? null;
}

/** A CodeTour file as one of our tours, its steps checked against the code; null when fewer than two steps hold up. */
export function codeTourToTour(ct: CodeTourFile, path: string, files: Map<string, string>, nodes: { id: string; files: string[] }[], source: "codetour" | "custom"): Tour | null {
  const raw = Array.isArray(ct.steps) ? ct.steps : [];
  const steps = raw.map((s, i) => codeTourStep(s, i, files, nodes)).filter((s): s is Step => !!s);
  if (steps.length < 2 || !steps.some(onCode)) return null;
  const title = (typeof ct.title === "string" && ct.title.trim() ? ct.title : path.split("/").pop()!.replace(/\.tour$/, "")).slice(0, 100);
  return {
    id: questionId(`${source}:${path}`),
    source,
    ...(ct.isPrimary || path === "main.tour" ? { primary: true } : {}),
    question: title,
    title,
    summary: (typeof ct.description === "string" ? ct.description : source === "codetour" ? "A tour written by the maintainers with CodeTour." : "").slice(0, 600),
    steps,
    check: { corrected: steps.filter((s) => s.corrected).length, dropped: raw.length - steps.length },
    calls: [],
  };
}

/**
 * Turns the repo's own VS Code CodeTour files into tours, checked against the code like ours, in CodeTour's order
 * with the primary tour first. Runs once per commit; free (no model call).
 */
export async function importCodeTours(p: Prepared, atlas: Atlas): Promise<void> {
  const marker = `${base(p.info)}/codetours.json`;
  if (await getJSON<{ done: boolean }>(marker)) return;
  const parsed = p.snapshot.files.filter((f) => CODETOUR_PATH.test(f.path)).flatMap((f) => {
    try {
      return [{ path: f.path, tour: JSON.parse(f.text) as CodeTourFile }];
    } catch {
      return [];
    }
  });
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const index = await getTourIndex(p.info);
  for (const { path, tour: ct } of orderCodeTours(parsed).slice(0, 12)) {
    const tour = codeTourToTour(ct, path, p.files, nodes, "codetour");
    if (!tour) continue;
    await putJSON(`${base(p.info)}/tours/${tour.id}.json`, tour);
    const { id, title } = tour;
    index.push({ id, title, question: title, steps: tour.steps.length, cost: null, at: Date.now(), source: "codetour", ...(tour.primary ? { primary: true } : {}) });
  }
  await putJSON(`${base(p.info)}/tours.json`, index);
  await putJSON(marker, { done: true });
}

// --- Tours that follow the code ----------------------------------------------------------------------------------
/** The most recent other read of this repo (the same folders), whose tours can come along. */
async function earlierRead(info: Pick<RepoInfo, "owner" | "repo" | "sha"> & { scope?: string }): Promise<{ sha: string; commit: string } | null> {
  const here = base(info);
  const prefix = here.slice(0, here.lastIndexOf("/") + 1);
  const scopeOf = (commit: string) => commit.slice(prefix.length).replace(/^[^~]*/, "");
  const reads = (await keysLike(`${prefix}%/atlas.json`))
    .map(({ key, at }) => ({ commit: key.slice(0, -"/atlas.json".length), at }))
    .filter((r) => r.commit.startsWith(prefix) && !r.commit.slice(prefix.length).includes("/") && r.commit !== here && scopeOf(r.commit) === scopeOf(here))
    .sort((a, b) => b.at - a.at);
  return reads[0] ? { commit: reads[0].commit, sha: reads[0].commit.slice(prefix.length).split("~")[0] } : null;
}

/** The earlier read's tours not here yet: generated, hand-written and opened from links (CodeTour files are read again). */
async function toursToCarry(p: Prepared) {
  const prev = await earlierRead(p.info);
  if (!prev) return null;
  const have = new Set((await getTourIndex(p.info)).map((t) => t.id));
  const entries = ((await getJSON<TourIndexEntry[]>(`${prev.commit}/tours.json`)) ?? []).filter((e) => !have.has(e.id) && e.source !== "codetour");
  return { prev, entries };
}

/** How many tours "Bring tours from the earlier read" would bring, and from which commit. */
export async function carryable(p: Prepared): Promise<{ from: string; count: number } | null> {
  const c = await toursToCarry(p);
  return c?.entries.length ? { from: c.prev.sha, count: c.entries.length } : null;
}

/**
 * Brings the earlier read's tours to this commit, each step checked again: steps whose quoted line is still there
 * move with it, the rest are kept and marked stale. Runs after every new read, and from "Bring tours". Free.
 */
export async function carryTours(p: Prepared, atlas: Atlas): Promise<{ from: string; count: number } | null> {
  const c = await toursToCarry(p);
  if (!c?.entries.length) return null;
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const index = await getTourIndex(p.info);
  let count = 0;
  for (const e of c.entries) {
    const tour = await getJSON<Tour>(`${c.prev.commit}/tours/${e.id}.json`);
    if (!tour || tour.pull) continue;
    const paths = [...new Set(tour.steps.filter(onCode).map((s) => s.file))];
    const old = await Promise.all(paths.map(async (f) => [f, await fileFromStore(c.prev.commit, f)] as const));
    const oldFiles = new Map(old.filter((x): x is [string, string] => x[1] !== null));
    await putJSON(`${base(p.info)}/tours/${e.id}.json`, carryTour(tour, oldFiles, p.files, nodes, c.prev.sha));
    index.push(e);
    count++;
  }
  if (count) await putJSON(`${base(p.info)}/tours.json`, index);
  return { from: c.prev.sha, count };
}

// --- Shared with the Ask answers module ------------------------------------------------------------------------
export const answerBase = (p: Prepared) => base(p.info);
export const questionIdOf = questionId;
export const checkLimitsFor = checkLimits;

/** Runs a model call, prices it and appends it to the repo's ledger. */
export async function trackedCall<T>(p: Prepared, kind: CallRecord["kind"], label: string, run: (cfg: ReturnType<typeof nebius>) => Promise<T>) {
  const out = await tracked(kind, label, run);
  await appendLedger(p.info, out.record);
  return out;
}

/** The key a commit's rows are stored under. */
export const commitKey = (p: Prepared) => base(p.info);
export const storeKey = (owner: string, repo: string, sha: string) => base({ owner, repo, sha });

export type Newer = { sha: string; branch: string; ahead: number | null };
const aheadCache = new Map<string, Promise<number | null>>();

/**
 * Opening a repo by name when its branch has moved on since the last read: open that read (free) and say how far
 * behind it is, instead of asking everyone to pay for a new read. Returns the ref to open and what's newer.
 */
export async function freshestRead(ref: RepoRef): Promise<{ ref: RepoRef; newer: Newer | null }> {
  if (ref.ref || ref.owner === LOCAL_OWNER || ref.scope) return { ref, newer: null };
  const [head, readSha] = await Promise.all([repoInfo(ref), latestReadSha(ref.owner, ref.repo)]);
  if (!readSha || readSha === head.sha || (await getStoredAtlas(head))) return { ref, newer: null };
  const key = `${head.owner}/${head.repo}:${readSha}...${head.sha}`;
  let ahead = aheadCache.get(key);
  if (!ahead) {
    ahead = commitsAhead(head, readSha, head.sha, env.GITHUB_TOKEN).catch(() => null);
    remember(aheadCache, key, ahead, 500);
  }
  return { ref: { ...ref, ref: readSha }, newer: { sha: head.sha, branch: head.ref, ahead: await ahead } };
}

/** One read on this instance, for the Browse page and llms.txt. */
export type ReadEntry = { owner: string; repo: string; sha: string; scope?: string; description: string | null; stars: number; private: boolean; modules: number; tours: number; docs: boolean; at: number };

/** Every read stored on this instance (every commit with a map), newest first. Private reads are marked. */
export async function listReads(): Promise<ReadEntry[]> {
  const maps = await keysLike("repos/%/atlas.json");
  const out = await Promise.all(
    maps.map(async ({ key, at }) => {
      const sha = key.split("/")[3].split("~")[0];
      const commit = key.slice(0, -"/atlas.json".length);
      const [info, atlas, tours, docs] = await Promise.all([getJSON<RepoInfo>(`${commit}/info.json`), getJSON<Atlas>(`${commit}/atlas.json`), getJSON<TourIndexEntry[]>(`${commit}/tours.json`), keysLike(`${commit}/docs.json`)]);
      if (!info || !atlas) return null;
      return { owner: info.owner, repo: info.repo, sha, ...(info.scope ? { scope: info.scope } : {}), description: info.description, stars: info.stars, private: !!info.private || info.owner === LOCAL_OWNER, modules: atlas.nodes.length, tours: tours?.length ?? 0, docs: docs.length > 0, at };
    }),
  );
  return out.filter((r): r is ReadEntry => !!r).sort((a, b) => b.at - a.at);
}

/** The commit of a repo's most recent read, so a PR can be toured on top of it without reading again. */
export const latestReadSha = async (owner: string, repo: string) =>
  (await getRecent()).find((r) => !r.scope && `${r.owner}/${r.repo}`.toLowerCase() === `${owner}/${repo}`.toLowerCase())?.sha;

/** What's stored about a repo's latest read, for search engines and link previews (no GitHub call). */
export async function storedOverview(owner: string, repo: string): Promise<{ summary: string; modules: string[]; tours: string[] } | null> {
  const r = (await getRecent()).find((x) => `${x.owner}/${x.repo}`.toLowerCase() === `${owner}/${repo}`.toLowerCase());
  if (!r?.sha || r.private) return null;
  const info = { owner: r.owner, repo: r.repo, sha: r.sha };
  const [atlas, tours] = await Promise.all([getJSON<Atlas>(`${base(info)}/atlas.json`), getJSON<TourIndexEntry[]>(`${base(info)}/tours.json`)]);
  if (!atlas) return null;
  return { summary: atlas.summary.replace(/`/g, ""), modules: atlas.nodes.map((n) => n.label), tours: (tours ?? []).map((t) => t.question) };
}
