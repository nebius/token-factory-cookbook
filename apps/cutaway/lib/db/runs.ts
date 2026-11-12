import { db } from "./index";

export type RunKind = "identify" | "design" | "repair" | "diagrams" | "review";

export type RunRecord = {
  teardownId: number | null;
  kind: RunKind;
  provider: string;
  model: string;
  status: "ok" | "error";
  tokensIn?: number | null;
  tokensOut?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  costUsd?: number | null;
  latencyMs: number;
  error?: string | null;
  rawResponse?: string | null;
};

export function logRun(r: RunRecord): void {
  db()
    .prepare(
      `INSERT INTO runs (teardown_id, kind, provider, model, status, tokens_in, tokens_out, cached_tokens, reasoning_tokens, cost_usd, latency_ms, error, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.teardownId,
      r.kind,
      r.provider,
      r.model,
      r.status,
      r.tokensIn ?? null,
      r.tokensOut ?? null,
      r.cachedTokens ?? null,
      r.reasoningTokens ?? null,
      r.costUsd ?? null,
      r.latencyMs,
      r.error ?? null,
      r.rawResponse ?? null,
    );
}

export type RunRow = {
  id: number;
  teardown_id: number | null;
  device: string | null;
  slug: string | null;
  kind: RunKind;
  provider: string;
  model: string;
  status: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number;
  error: string | null;
  created_at: string;
};

/** The run log shows one provider's calls (Nebius by default); older calls through other providers stay in the database. */
export function listRuns(limit = 200, provider = "nebius"): RunRow[] {
  return db()
    .prepare(
      `SELECT r.id, r.teardown_id, t.name AS device, t.slug, r.kind, r.provider, r.model, r.status, r.tokens_in, r.tokens_out,
              r.cached_tokens, r.reasoning_tokens, r.cost_usd, r.latency_ms, r.error, r.created_at
       FROM runs r LEFT JOIN teardowns t ON t.id = r.teardown_id
       WHERE r.provider = ?
       ORDER BY r.id DESC LIMIT ?`,
    )
    .all(provider, limit) as RunRow[];
}

/** Totals over one provider's real calls (Nebius by default). Unpriced calls are counted so the page can say so. */
export function runTotals(provider = "nebius"): { calls: number; tokens_in: number; tokens_out: number; cached: number; reasoning: number; errors: number; cost_usd: number; unpriced: number; latency_ms: number } {
  return db()
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(tokens_in), 0) AS tokens_in, COALESCE(SUM(tokens_out), 0) AS tokens_out,
              COALESCE(SUM(cached_tokens), 0) AS cached, COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
              COALESCE(SUM(status = 'error'), 0) AS errors, COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(status = 'ok' AND tokens_out IS NOT NULL AND cost_usd IS NULL), 0) AS unpriced,
              COALESCE(SUM(latency_ms), 0) AS latency_ms
       FROM runs WHERE provider = ?`,
    )
    .get(provider) as never;
}
