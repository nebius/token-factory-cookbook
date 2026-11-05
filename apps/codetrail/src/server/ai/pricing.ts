// What a model call costs, from Nebius Token Factory's own price list (GET /v1/models?verbose=true).
// No server-only imports: the MCP server and the eval price their calls with the same functions.

/** Dollars per token. `cached` is the price of prompt tokens served from Token Factory's prompt cache. */
export type ModelPrice = { input: number; cached: number; output: number };
export type PriceList = { fetchedAt: number; models: Record<string, ModelPrice> };
export type TokenUsage = { input: number; cached: number; output: number };

type VerboseModel = { id: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string } };

export async function fetchPrices(apiKey: string, baseURL: string): Promise<PriceList> {
  const res = await fetch(new URL("models?verbose=true", baseURL.endsWith("/") ? baseURL : `${baseURL}/`), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Token Factory price list returned ${res.status}`);
  const body = (await res.json()) as { data?: VerboseModel[] };
  const models: Record<string, ModelPrice> = {};
  for (const m of body.data ?? []) {
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    const cached = Number(m.pricing?.input_cache_read);
    // A model without a cached-input price bills every prompt token at the input price.
    models[m.id] = { input, output, cached: Number.isFinite(cached) ? cached : input };
  }
  return { fetchedAt: Date.now(), models };
}

/** Dollars for one call, or null when the model isn't on the price list. Cached tokens are part of `input`. */
export function costOf(prices: PriceList | null, model: string, usage: TokenUsage): number | null {
  const p = prices?.models[model];
  if (!p) return null;
  const cached = Math.min(usage.cached, usage.input);
  return (usage.input - cached) * p.input + cached * p.cached + usage.output * p.output;
}
