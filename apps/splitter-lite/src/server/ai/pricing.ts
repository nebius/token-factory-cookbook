// Prices and model facts straight from Nebius Token Factory's catalog (GET /v1/models?verbose=true),
// so the cost shown for every AI call uses the endpoint's own published per-token price.
import type OpenAI from "openai";

export type ModelInfo = {
  id: string;
  /** USD per 1M tokens, from the catalog's per-token `pricing`. */
  inputPerM: number;
  outputPerM: number;
  features: string[];
  modality: string | null;
  contextLength: number | null;
  /** Where the numbers came from, for the UI and the CLI. */
  source: string;
  fetchedAt: string;
};

export type Usage = { input: number; output: number; reasoning: number; calls: number };
export type UsageReport = Usage & {
  ms: number;
  costUsd: number | null;
  /** The model's reasoning text for this call (each model turn, in order), trimmed for display. */
  reasoningText?: string;
};

/** Collects reasoning from every model turn of one AI call, capped so responses stay small. */
export function reasoningLog(max = 6000) {
  const parts: string[] = [];
  return {
    add: (text: string) => parts.push(text),
    text: () => {
      const joined = parts.map((p, i) => (parts.length > 1 ? `[turn ${i + 1}]\n${p}` : p)).join("\n\n");
      return joined.length > max ? `${joined.slice(0, max)}\n… (${joined.length - max} more characters)` : joined;
    },
  };
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, reasoning: 0, calls: 0 });

/** Adds one completion's usage to a running total (reasoning tokens are part of completion tokens). */
export function addUsage(total: Usage, u: OpenAI.Completions.CompletionUsage) {
  total.input += u.prompt_tokens ?? 0;
  total.output += u.completion_tokens ?? 0;
  total.reasoning += u.completion_tokens_details?.reasoning_tokens ?? 0;
  total.calls += 1;
}

export const costOf = (u: Usage, info: ModelInfo | null) =>
  info ? (u.input * info.inputPerM + u.output * info.outputPerM) / 1_000_000 : null;

const TTL = 60 * 60 * 1000;
let cache: { key: string; at: number; info: ModelInfo | null } | undefined;

/** The model's catalog entry, cached for an hour. Returns null if the catalog can't be reached. */
export async function modelInfo(cfg: { apiKey: string; baseURL: string; model: string }): Promise<ModelInfo | null> {
  const key = `${cfg.baseURL}|${cfg.model}`;
  if (cache?.key === key && Date.now() - cache.at < TTL) return cache.info;
  let info: ModelInfo | null = null;
  try {
    const url = new URL("models?verbose=true", cfg.baseURL.endsWith("/") ? cfg.baseURL : `${cfg.baseURL}/`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const body = (await res.json()) as {
        data?: {
          id: string;
          pricing?: { prompt?: string; completion?: string };
          supported_features?: string[];
          architecture?: { modality?: string };
          context_length?: number;
        }[];
      };
      const m = body.data?.find((d) => d.id === cfg.model);
      const input = Number(m?.pricing?.prompt);
      const output = Number(m?.pricing?.completion);
      if (m && Number.isFinite(input) && Number.isFinite(output)) {
        info = {
          id: m.id,
          inputPerM: Math.round(input * 1e6 * 1e6) / 1e6,
          outputPerM: Math.round(output * 1e6 * 1e6) / 1e6,
          features: m.supported_features ?? [],
          modality: m.architecture?.modality ?? null,
          contextLength: m.context_length ?? null,
          source: `${url.origin}${url.pathname}?verbose=true`,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Catalog unreachable: costs are shown as unknown rather than guessed.
  }
  cache = { key, at: Date.now(), info };
  return info;
}
