import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { logRun, type RunKind } from "@/lib/db/runs";
import { callCost, kimiPrice } from "./pricing";

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

export type Provider = "nebius" | "replay";

const DEFAULTS: Record<Provider, { baseURL: string; model: string; keyVar: string }> = {
  // Kimi K3.1 Pro on Nebius Token Factory.
  nebius: { baseURL: "https://api.tokenfactory.us-north1.nebius.com/v1/", model: "moonshotai/Kimi-K3.1-Pro", keyVar: "NEBIUS_API_KEY" },
  // Development only: streams stored answers from fixtures/kimi instead of calling a model.
  replay: { baseURL: "fixtures/kimi", model: "stored-desk-fan", keyVar: "" },
};

export type KimiConfig = {
  provider: Provider;
  baseURL: string;
  model: string;
  apiKey: string;
  keyVar: string;
  maxTokens: number;
  /** Dollars per million input / output tokens, for the run log. Nebius doesn't report cost per call, so it comes from settings. */
  price: { input: number; output: number } | null;
};

export function kimiConfig(env: NodeJS.ProcessEnv = process.env): KimiConfig {
  const provider: Provider = env.KIMI_PROVIDER === "replay" ? "replay" : "nebius";
  const d = DEFAULTS[provider];
  const input = Number(env.KIMI_PRICE_INPUT);
  const output = Number(env.KIMI_PRICE_OUTPUT);
  return {
    provider,
    baseURL: env.KIMI_BASE_URL || d.baseURL,
    model: env.KIMI_MODEL || d.model,
    apiKey: provider === "replay" ? "replay" : (env[d.keyVar] ?? ""),
    keyVar: d.keyVar,
    maxTokens: Number(env.KIMI_MAX_TOKENS) || 64_000,
    price: input > 0 && output > 0 ? { input, output } : null,
  };
}

export class KimiError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "provider" | "invalid_output" | "truncated",
  ) {
    super(message);
    this.name = "KimiError";
  }
}

let cached: { key: string; client: OpenAI } | undefined;
function client(c: KimiConfig): OpenAI {
  if (!c.apiKey) throw new KimiError(`No API key set. Add ${c.keyVar} to cutaway/.env and restart the dev server.`, "config");
  const key = `${c.baseURL}|${c.apiKey}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new OpenAI({
        apiKey: c.apiKey,
        baseURL: c.baseURL,
        maxRetries: 0,
        timeout: 15 * 60_000,
      }),
    };
  }
  return cached.client;
}

export type ChatResult = { text: string; finishReason: string | null; latencyMs: number };
export type Delta = { text: string; reasoningChars: number };

type Usage = OpenAI.Completions.CompletionUsage & { completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };

/** Reasoning shows up as `reasoning_content` (Nebius and most OpenAI-compatible hosts) or `reasoning`. */
function reasoningOf(delta: unknown): string {
  const d = delta as { reasoning?: unknown; reasoning_content?: unknown } | undefined;
  const r = d?.reasoning ?? d?.reasoning_content;
  return typeof r === "string" ? r : "";
}

/**
 * One streamed chat call to Kimi. Streaming keeps long design calls alive and lets the UI show
 * progress. Every call, good or bad, is written to the run log. Retries once if nothing arrived yet.
 */
export async function kimiChat(o: {
  teardownId: number | null;
  kind: RunKind;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  onDelta?: (d: Delta) => void;
  signal?: AbortSignal;
  config?: KimiConfig;
}): Promise<ChatResult> {
  const c = o.config ?? kimiConfig();
  if (c.provider === "replay") return replayChat(o, c);
  const api = client(c);
  const started = Date.now();
  let text = "";
  let reasoningChars = 0;
  let usage: Usage | undefined;
  let finishReason: string | null = null;

  const attempt = async () => {
    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & { usage?: { include: boolean } } = {
      model: c.model,
      messages: o.messages,
      max_tokens: o.maxTokens ?? c.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };
    // Kimi K3.1 Pro fixes its own temperature, so it is only sent when a caller asks.
    if (o.temperature !== undefined) body.temperature = o.temperature;
    const effort = effortFor(o.kind);
    if (effort) (body as { reasoning_effort?: string }).reasoning_effort = effort;
    const stream = await api.chat.completions.create(body, { signal: o.signal });
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage as Usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const r = reasoningOf(choice.delta);
      const t = choice.delta?.content ?? "";
      if (r) reasoningChars += r.length;
      if (t) text += t;
      if (r || t) o.onDelta?.({ text: t, reasoningChars });
    }
  };

  try {
    try {
      await attempt();
    } catch (e) {
      if (text || reasoningChars || o.signal?.aborted) throw e;
      // If the host won't take the thinking setting, stop sending it and ask again the normal way.
      if (effortFor(o.kind) && /reasoning/i.test(e instanceof Error ? e.message : String(e))) effortRejected = true;
      else if (!retryable(e)) throw e;
      await attempt();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logRun({ teardownId: o.teardownId, kind: o.kind, provider: c.provider, model: c.model, status: "error", latencyMs: Date.now() - started, error: message, rawResponse: text || null });
    throw new KimiError(`Kimi call failed (${o.kind}): ${message}`, "provider");
  }

  const latencyMs = Date.now() - started;
  // A stream can end quietly when it is aborted; that is a cancellation, not an empty answer.
  if (o.signal?.aborted) {
    logRun({ teardownId: o.teardownId, kind: o.kind, provider: c.provider, model: c.model, status: "error", latencyMs, error: "cancelled", rawResponse: text || null });
    throw new KimiError(`Kimi call cancelled (${o.kind})`, "provider");
  }
  logRun({
    teardownId: o.teardownId,
    kind: o.kind,
    provider: c.provider,
    model: c.model,
    status: "ok",
    tokensIn: usage?.prompt_tokens,
    tokensOut: usage?.completion_tokens,
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
    costUsd: await costOf(c, usage),
    latencyMs,
    rawResponse: text,
  });
  if (!text.trim()) throw new KimiError(`Kimi returned an empty answer (${o.kind}, finish: ${finishReason ?? "none"})`, "invalid_output");
  return { text, finishReason, latencyMs };
}

/**
 * How hard Kimi thinks, per kind of call. K3.1 Pro always thinks; `reasoning_effort` is low, high or max (its default).
 * Most of the wait was thinking: the jet engine's self-review was 88% thinking and its diagrams half. The design keeps
 * the default (max) because that's where the quality comes from. Override with KIMI_EFFORT_<KIND>, e.g. KIMI_EFFORT_REVIEW=high,
 * or "max" to send nothing.
 */
const EFFORT: Partial<Record<RunKind, "low" | "high">> = { identify: "low", diagrams: "low", review: "low", repair: "low" };
let effortRejected = false;
function effortFor(kind: RunKind): string | null {
  if (effortRejected) return null;
  const set = process.env[`KIMI_EFFORT_${kind.toUpperCase()}`]?.trim().toLowerCase();
  if (set === "max" || set === "default") return null;
  if (set === "low" || set === "high") return set;
  return EFFORT[kind] ?? null;
}

/** Real token counts from the stream's usage block, times the price Nebius publishes for the model. */
async function costOf(c: KimiConfig, usage: Usage | undefined): Promise<number | null> {
  if (!usage) return null;
  if (typeof usage.cost === "number") return usage.cost;
  const price = await kimiPrice(c);
  return price ? callCost(price, { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cached: usage.prompt_tokens_details?.cached_tokens }) : null;
}

function retryable(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

/** An image for a vision message. */
export function imagePart(dataUrl: string): ContentPart {
  return { type: "image_url", image_url: { url: dataUrl } };
}

const REPLAY: Record<string, string> = {
  identify: JSON.stringify({ device: "oscillating desk fan", category: "home-appliances", confidence: 0.9, visibleClues: ["wire guard", "three blades"], question: null }),
  review: "<verdict>looks right (replayed answer)</verdict>",
};

/** Stream a stored answer like a real call, with small delays, and log it as a replay run. */
async function replayChat(o: Parameters<typeof kimiChat>[0], c: KimiConfig): Promise<ChatResult> {
  const started = Date.now();
  const dir = path.join(process.cwd(), "fixtures", "kimi");
  const file = o.kind === "design" ? "desk-fan.design.txt" : o.kind === "diagrams" ? "desk-fan.diagrams.txt" : null;
  const text = file ? fs.readFileSync(path.join(dir, file), "utf8") : (REPLAY[o.kind] ?? "");
  for (let i = 0; i < text.length; i += 400) {
    if (o.signal?.aborted) throw new KimiError("cancelled", "provider");
    o.onDelta?.({ text: text.slice(i, i + 400), reasoningChars: 0 });
    await new Promise((r) => setTimeout(r, 15));
  }
  const latencyMs = Date.now() - started;
  logRun({ teardownId: o.teardownId, kind: o.kind, provider: c.provider, model: c.model, status: "ok", latencyMs, rawResponse: text });
  return { text, finishReason: "stop", latencyMs };
}
