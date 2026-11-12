// Nebius Token Factory adapter: one model, structured JSON calls, usage for pricing.
// Every call sends the same leading messages for a repo (system prompt + packed repo), so Token Factory's
// prompt cache can serve them after the first few calls. Only the last message changes.
import OpenAI from "openai";
import type { z } from "zod";
import { callSignal, CancelledError } from "@/server/cancel";
import type { TokenUsage } from "./pricing";

export type CallUsage = TokenUsage & { model: string; ms: number };

export type NebiusConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  /** Called after every model call with its tokens and time (the app prices and shows them). */
  onUsage?: (usage: CallUsage) => void;
};

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Content = OpenAI.Chat.Completions.ChatCompletionContentPart[];
type ReasoningEffort = "low" | "medium" | "high";

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: "provider" | "invalid_output" | "truncated" | "config",
  ) {
    super(message);
    this.name = "AIError";
  }
}

let cached: { key: string; client: OpenAI } | undefined;
function getClient({ apiKey, baseURL }: NebiusConfig) {
  if (!apiKey) throw new AIError("No Nebius key is set. Add NEBIUS_API_KEY (from tokenfactory.nebius.com) to .env, or pass it to docker run with -e, then restart.", "config");
  const key = `${baseURL}|${apiKey}`;
  if (cached?.key !== key) {
    cached = { key, client: new OpenAI({ apiKey, baseURL, maxRetries: 2, timeout: 300_000 }) };
  }
  return cached.client;
}

/**
 * An answer that only has the schema's shape, with "..." where the content should be. DeepSeek does this
 * now and then under load; it's treated as invalid and asked for again.
 */
export function isPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return /^\s*(\.{3}|…)\s*$/.test(value);
  if (Array.isArray(value)) return value.some(isPlaceholder);
  if (value && typeof value === "object") return Object.values(value).some(isPlaceholder);
  return false;
}

/** Token counts from a usage block; cached prompt tokens are reported as `prompt_tokens_details.cached_tokens`. */
function usageOf(u: OpenAI.Completions.CompletionUsage | undefined | null): TokenUsage {
  const extra = u as { prompt_cache_hit_tokens?: number } | undefined;
  return { input: u?.prompt_tokens ?? 0, cached: u?.prompt_tokens_details?.cached_tokens ?? extra?.prompt_cache_hit_tokens ?? 0, output: u?.completion_tokens ?? 0 };
}

/** Reasoning arrives as `reasoning` (DeepSeek on Token Factory), `reasoning_content` or inline <think> text. */
function reasoningOf(message: unknown): string {
  const m = message as { reasoning_content?: string | null; reasoning?: string | null; content?: string | null };
  if (m.reasoning_content) return m.reasoning_content;
  if (m.reasoning) return m.reasoning;
  return m.content?.match(/<think>([\s\S]*?)(<\/think>|$)/i)?.[1]?.trim() ?? "";
}

/**
 * Pulls the JSON object out of a model reply: drops reasoning blocks and markdown fences, then returns the
 * last {...} block that actually parses (reasoning written before the answer can contain stray braces).
 */
export function cleanModelJson(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // An unterminated think block (thinking cut short): drop everything before the first "{".
  if (/<think>/i.test(text)) text = text.slice(text.indexOf("{"));
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const end = text.lastIndexOf("}");
  if (end < 0) return text;
  for (let start = text.indexOf("{"); start >= 0 && start < end; start = text.indexOf("{", start + 1)) {
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Not valid from here: try the next "{".
    }
  }
  const start = text.indexOf("{");
  return start >= 0 ? text.slice(start, end + 1) : text;
}

const providerError = (error: unknown) =>
  error instanceof AIError || error instanceof CancelledError
    ? error
    : error instanceof OpenAI.APIUserAbortError
      ? new CancelledError()
    : new AIError(
        error instanceof OpenAI.APIError ? `The AI service returned ${error.status ?? "an error"}: ${error.message}` : "Could not reach the AI service",
        "provider",
      );

type JSONOptions<T> = {
  /** The shared leading messages (system prompt + repo). Identical for every call on one repo commit. */
  prefix: Message[];
  /** The task for this call, sent after the prefix. */
  task: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  name: string;
  /** Groups calls that share a prefix on Token Factory's side (routing hint only). */
  cacheKey?: string;
  effort?: ReasoningEffort;
  maxTokens?: number;
  /** Extra checks after the schema parses (file paths, line ranges). Return problems to send back once. */
  check?: (value: T) => string[];
  /** Stream the first attempt (repair turns don't stream). */
  stream?: StreamHooks;
};

export type StreamHooks = {
  /** The reply so far, as it streams (throttled by the caller). */
  onContent?: (soFar: string) => void;
  /** Reasoning characters so far, while the model thinks before answering. */
  onReasoning?: (chars: number) => void;
};

/** One completion. Streams when hooks are given, so the UI can show the answer as it's written. */
async function complete(config: NebiusConfig, body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, hooks?: StreamHooks) {
  const started = Date.now();
  // Aborted when everyone waiting on this call pressed Stop.
  const signal = callSignal();
  if (signal?.aborted) throw new CancelledError();
  if (!hooks) {
    const r = await getClient(config).chat.completions.create(body, { signal });
    if (r.usage) config.onUsage?.({ model: body.model, ms: Date.now() - started, ...usageOf(r.usage) });
    return { content: r.choices[0]?.message?.content ?? "", reasoning: reasoningOf(r.choices[0]?.message), finish: r.choices[0]?.finish_reason };
  }
  const stream = await getClient(config).chat.completions.create({ ...body, stream: true, stream_options: { include_usage: true } }, { signal });
  let content = "";
  let reasoning = "";
  let finish: string | null | undefined;
  // Usage (cached tokens included) comes on the last chunk for some models and as a running total on every chunk
  // for others (Kimi), so keep the latest and report it once, even when the stream stops part-way.
  let usage: OpenAI.CompletionUsage | undefined;
  try {
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta as { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
      const r = delta.reasoning_content ?? delta.reasoning;
      if (r) {
        reasoning += r;
        hooks.onReasoning?.(reasoning.length);
      }
      if (delta.content) {
        content += delta.content;
        hooks.onContent?.(content);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  } finally {
    if (usage) config.onUsage?.({ model: body.model, ms: Date.now() - started, ...usageOf(usage) });
  }
  // An aborted stream can end quietly, part-way through: that's a Stop, never a finished reply to store.
  if (signal?.aborted) throw new CancelledError();
  if (!finish) throw new AIError("The reply stopped before it finished.", "truncated");
  return { content, reasoning, finish };
}

/**
 * One structured call: strict JSON-schema output (falling back to JSON mode on a 400), validated with zod
 * and the caller's own checks. A reply that fails gets repair turns with the problems and its own answer.
 */
export async function chatJSON<T>(config: NebiusConfig, opts: JSONOptions<T>): Promise<T> {
  const messages: Message[] = [...opts.prefix, { role: "user", content: opts.task }];
  let mode: "json_schema" | "json_object" = "json_schema";
  let lastError: unknown;
  let checked = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    let reply;
    try {
      reply = await complete(config, {
        model: config.model,
        max_tokens: opts.maxTokens ?? 16_384,
        response_format:
          mode === "json_schema"
            ? { type: "json_schema", json_schema: { name: opts.name, schema: opts.jsonSchema, strict: true } }
            : { type: "json_object" },
        messages,
        reasoning_effort: opts.effort ?? "medium",
        ...(opts.cacheKey ? { prompt_cache_key: opts.cacheKey } : {}),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, attempt === 0 ? opts.stream : undefined);
    } catch (error) {
      // A 400 usually means this response_format is unsupported: retry in JSON mode. The schema goes in the
      // task (the last message) so the cached prefix stays the same.
      if (error instanceof OpenAI.APIError && error.status === 400 && mode === "json_schema") {
        mode = "json_object";
        messages[messages.length - 1] = { role: "user", content: `${opts.task}\n\nReply with one JSON object matching this schema:\n${JSON.stringify(opts.jsonSchema)}` };
        continue;
      }
      throw providerError(error);
    }
    if (reply.finish === "length") throw new AIError("The answer was cut off before it finished.", "truncated");
    let problems: string[];
    try {
      const parsed = opts.schema.parse(JSON.parse(cleanModelJson(reply.content)));
      if (isPlaceholder(parsed)) throw new Error('Some values are only "..." placeholders. Write the real content.');
      // The caller's checks get one repair turn; after that, the caller decides what to keep.
      problems = checked || attempt === 2 ? [] : (opts.check?.(parsed) ?? []);
      if (problems.length === 0) return parsed;
      checked = true;
    } catch (error) {
      lastError = error;
      problems = [`That JSON didn't match the schema: ${String((error as Error).message).slice(0, 1500)}`];
    }
    console.warn(`[${opts.name}] repair turn ${attempt + 1}: ${problems[0].slice(0, 300)}`);
    messages.push(
      { role: "assistant", content: reply.content },
      { role: "user", content: `${problems.join("\n").slice(0, 4000)}\nReply again with the corrected JSON object only.` },
    );
  }
  console.error(`AI call "${opts.name}" produced invalid output`, lastError);
  throw new AIError("The AI response couldn't be understood. Please try again.", "invalid_output");
}

/** One plain-text call on the cached repo prefix (generative UI answers stream as OpenUI Lang text). */
export async function chatText(
  config: NebiusConfig,
  opts: { prefix: Message[]; task: string; cacheKey?: string; effort?: ReasoningEffort; maxTokens?: number; stream?: StreamHooks },
): Promise<string> {
  try {
    const reply = await complete(
      config,
      {
        model: config.model,
        max_tokens: opts.maxTokens ?? 8_192,
        messages: [...opts.prefix, { role: "user", content: opts.task }],
        reasoning_effort: opts.effort ?? "low",
        ...(opts.cacheKey ? { prompt_cache_key: opts.cacheKey } : {}),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      opts.stream,
    );
    if (reply.finish === "length") throw new AIError("The answer was cut off before it finished.", "truncated");
    return reply.content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```[a-z-]*\s*/i, "").replace(/\s*```\s*$/, "").trim();
  } catch (error) {
    throw providerError(error);
  }
}
