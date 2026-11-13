import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

// Inkling 2 Small on Nebius Token Factory's OpenAI-compatible endpoint, or replay
// (stored responses from fixtures/replays, so tests and UI work need no network or key).

export type Provider = "nebius" | "replay";
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Tool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;

type Settings = {
  provider: Provider;
  model: string;
  baseURL: string;
  apiKey: string;
  keyName: string;
  // USD per million tokens. Only set when you know the real price; the run log shows "no price" otherwise.
  price: { input: number; cached: number; output: number } | null;
  record: boolean;
};

export function settings(env: NodeJS.ProcessEnv = process.env): Settings {
  const provider: Provider = env.INKLING_PROVIDER === "replay" ? "replay" : "nebius";
  const input = Number(env.INKLING_PRICE_INPUT);
  const output = Number(env.INKLING_PRICE_OUTPUT);
  const cached = env.INKLING_PRICE_CACHED ? Number(env.INKLING_PRICE_CACHED) : input;
  const keyName = "NEBIUS_API_KEY";
  return {
    provider,
    model: env.INKLING_MODEL || "thinkingmachines/Inkling-2-Small",
    baseURL: env.NEBIUS_BASE_URL || "https://api.tokenfactory.eu-west2.nebius.com/v1/",
    apiKey: provider === "replay" ? "" : (env[keyName] ?? ""),
    keyName,
    price: input > 0 && output > 0 && cached >= 0 ? { input, cached, output } : null,
    record: env.INKLING_RECORD === "1",
  };
}

export type Usage = { input: number; cachedInput: number; output: number; reasoning: number };

export type ToolCall = { id: string; name: string; arguments: string };

export type Reply = {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: Usage;
};

// One entry per model call, shown in the run log.
export type CallLog = {
  step: number;
  // "agent" calls are the tool loop; "transcribe" calls read a scanned page before it starts.
  stage?: "agent" | "transcribe";
  page?: number;
  doc?: "A" | "B";
  provider: Provider;
  model: string;
  startedAt: string;
  ms: number;
  usage: Usage;
  cost: number | null;
  finishReason: string | null;
  error?: string;
};

class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "provider" | "output",
  ) {
    super(message);
    this.name = "ModelError";
  }
}

const REPLAY_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "fixtures", "replays");

function replayFile(key: string) {
  return path.join(REPLAY_DIR, `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`);
}

export function costOf(s: Settings, u: Usage): number | null {
  if (!s.price) return null;
  const fresh = Math.max(0, u.input - u.cachedInput);
  return (fresh * s.price.input + u.cachedInput * s.price.cached + u.output * s.price.output) / 1e6;
}

type StreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
};

export function toUsage(u: StreamUsage): Usage {
  return {
    input: u.prompt_tokens ?? 0,
    cachedInput: u.prompt_tokens_details?.cached_tokens ?? 0,
    output: u.completion_tokens ?? 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

let api: { key: string; client: OpenAI } | undefined;

function clientFor(s: Settings): OpenAI {
  if (!s.apiKey) throw new ModelError(`Set ${s.keyName} in .env.local, or use INKLING_PROVIDER=replay.`, "config");
  const key = `${s.baseURL}|${s.apiKey}`;
  if (api?.key !== key) {
    api = {
      key,
      client: new OpenAI({
        apiKey: s.apiKey,
        baseURL: s.baseURL,
        maxRetries: 1,
        timeout: 15 * 60_000,
      }),
    };
  }
  return api.client;
}

type Delta = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
};

export async function ask(o: {
  step: number;
  // Name of the stored response used in replay mode and written when recording.
  replayKey: string;
  messages: Message[];
  tools?: Tool[];
  maxTokens?: number;
  onProgress?: (chars: number) => void;
  settings?: Settings;
}): Promise<{ reply: Reply; log: CallLog }> {
  const s = o.settings ?? settings();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  if (s.provider === "replay") {
    let raw: string;
    try {
      raw = await fs.readFile(replayFile(o.replayKey), "utf8");
    } catch {
      throw new ModelError(`No stored response "${o.replayKey}" in fixtures/replays.`, "config");
    }
    const stored = JSON.parse(raw) as Reply & { model?: string; ms?: number; cost?: number | null };
    const reply: Reply = { text: stored.text, reasoning: stored.reasoning ?? "", toolCalls: stored.toolCalls, finishReason: stored.finishReason, usage: stored.usage };
    return {
      reply,
      log: { step: o.step, provider: "replay", model: stored.model ?? s.model, startedAt, ms: stored.ms ?? 0, usage: reply.usage, cost: stored.cost ?? null, finishReason: reply.finishReason },
    };
  }

  const client = clientFor(s);
  let text = "";
  let reasoning = "";
  let finishReason: string | null = null;
  // Some providers send a running total on every chunk, others only on the last: keep the latest, never add.
  let usage: StreamUsage = {};
  const calls = new Map<number, ToolCall>();

  try {
    const stream = await client.chat.completions.create({
      model: s.model,
      messages: o.messages,
      tools: o.tools,
      max_tokens: o.maxTokens ?? 16_000,
      stream: true,
      stream_options: { include_usage: true },
    });
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage as StreamUsage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta as Delta | undefined;
      if (delta?.content) text += delta.content;
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
      else if (delta?.reasoning) reasoning += delta.reasoning;
      for (const tc of delta?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: "", name: "", arguments: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        calls.set(tc.index, cur);
      }
      o.onProgress?.(text.length + reasoning.length + [...calls.values()].reduce((n, c) => n + c.arguments.length, 0));
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const log: CallLog = { step: o.step, provider: s.provider, model: s.model, startedAt, ms: Date.now() - t0, usage: toUsage(usage), cost: null, finishReason, error: message };
    throw Object.assign(new ModelError(message, "provider"), { log });
  }

  const toolCalls = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${o.step}_${i}` }));
  const reply: Reply = { text, reasoning, toolCalls, finishReason, usage: toUsage(usage) };
  const ms = Date.now() - t0;
  const cost = costOf(s, reply.usage);
  if (s.record) {
    await fs.mkdir(REPLAY_DIR, { recursive: true });
    await fs.writeFile(replayFile(o.replayKey), JSON.stringify({ ...reply, model: s.model, ms, cost }, null, 2));
  }
  return { reply, log: { step: o.step, provider: s.provider, model: s.model, startedAt, ms, usage: reply.usage, cost, finishReason } };
}

export function imagePart(dataUrl: string): OpenAI.Chat.Completions.ChatCompletionContentPartImage {
  return { type: "image_url", image_url: { url: dataUrl } };
}
