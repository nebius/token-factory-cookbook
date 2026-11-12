import type { KimiConfig } from "./client";

/** Dollars per token. */
export type Price = { input: number; cachedInput: number; output: number; source: "nebius" | "settings" };

type RichModel = { id: string; pricing?: { prompt?: string | null; input_cache_read?: string | null; completion?: string | null } };

let cache: { key: string; price: Price | null; at: number } | null = null;

/**
 * Kimi's price, read from Nebius's model list (`GET /models?verbose=true`, per-token USD strings), so the run log
 * matches what Nebius bills. Falls back to KIMI_PRICE_INPUT / KIMI_PRICE_OUTPUT (dollars per million) when the list
 * can't be read. Cached for an hour.
 */
export async function kimiPrice(c: KimiConfig): Promise<Price | null> {
  if (c.provider !== "nebius") return null;
  const key = `${c.baseURL}|${c.model}`;
  if (cache?.key === key && Date.now() - cache.at < 3_600_000) return cache.price;
  let price: Price | null = null;
  try {
    const r = await fetch(new URL("models?verbose=true", c.baseURL.endsWith("/") ? c.baseURL : `${c.baseURL}/`), {
      headers: { Authorization: `Bearer ${c.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const list = ((await r.json()) as { data?: RichModel[] }).data ?? [];
      const m = list.find((x) => x.id.toLowerCase() === c.model.toLowerCase());
      const input = Number(m?.pricing?.prompt);
      const output = Number(m?.pricing?.completion);
      const cached = Number(m?.pricing?.input_cache_read);
      if (input > 0 && output > 0) price = { input, output, cachedInput: cached > 0 ? cached : input, source: "nebius" };
    }
  } catch {
    /* fall back to settings */
  }
  if (!price && c.price) price = { input: c.price.input / 1e6, output: c.price.output / 1e6, cachedInput: c.price.input / 1e6, source: "settings" };
  cache = { key, price, at: Date.now() };
  return price;
}

/** Cost of one call. Cached input tokens are part of prompt_tokens and billed at the cached rate. */
export function callCost(price: Price, u: { prompt_tokens: number; completion_tokens: number; cached?: number | null }): number {
  const cached = Math.min(u.cached ?? 0, u.prompt_tokens);
  return (u.prompt_tokens - cached) * price.input + cached * price.cachedInput + u.completion_tokens * price.output;
}
