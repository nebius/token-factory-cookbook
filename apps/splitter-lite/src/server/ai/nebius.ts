// Nebius Token Factory adapter. Every model-specific option lives in this file, so swapping the model
// (NEBIUS_MODEL) or moving to another OpenAI-compatible provider means editing only here.
//
// Reasoning and sampling: no reasoning or sampling fields are sent. Token Factory runs
// nvidia/Nemotron-3.5-Super-VL with reasoning on by default (the same as reasoning_effort "medium"; the
// reasoning comes back in `reasoning_content`) and lists no tunable sampling parameters for it.
import OpenAI from "openai";
import { z } from "zod";
import { RECEIPT_SYSTEM_PROMPT, receiptJsonSchema, receiptSchema, type ExtractedReceipt } from "./receipt";

export type NebiusConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  /** Optional token meter (used by evals to report cost). */
  onUsage?: (usage: OpenAI.Completions.CompletionUsage) => void;
  /** The model's reasoning for each call, as Token Factory returns it in `reasoning_content`. */
  onReasoning?: (text: string) => void;
};

/** Token Factory returns the reasoning next to the answer, in `reasoning_content` (some servers say `reasoning`). */
function reportReasoning(config: NebiusConfig, message: unknown) {
  const m = message as { reasoning_content?: string | null; reasoning?: string | null } | undefined;
  const text = (m?.reasoning_content ?? m?.reasoning ?? "").trim();
  if (text) config.onReasoning?.(text);
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly kind: "provider" | "invalid_output" | "truncated" | "refused" | "multiple_bills",
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

let cached: { key: string; client: OpenAI } | undefined;
function getClient({ apiKey, baseURL }: NebiusConfig) {
  const key = `${baseURL}|${apiKey}`;
  if (cached?.key !== key) {
    cached = { key, client: new OpenAI({ apiKey, baseURL, maxRetries: 2, timeout: 180_000 }) };
  }
  return cached.client;
}

/**
 * Pulls the JSON object out of a model reply: drops reasoning blocks and markdown fences, then returns the
 * last {...} block that actually parses (reasoning written before the answer can contain stray braces).
 */
export function cleanModelJson(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // An unterminated think block (thinking cut short) — drop everything before the first "{".
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

type Content = OpenAI.Chat.Completions.ChatCompletionContentPart[];

/** Output budget per call. Reasoning tokens count against it, so it is generous. */
export const MAX_TOKENS = 16_384;

const imageParts = (images: string[]): Content =>
  images.map((url) => ({ type: "image_url", image_url: { url } }));

/**
 * One structured call: tries strict JSON-schema output, falls back to JSON mode (schema in the prompt)
 * and validates with zod either way.
 */
export async function chatJSON<T>(
  config: NebiusConfig,
  opts: {
    system: string;
    content: Content;
    schema: z.ZodType<T>;
    jsonSchema: Record<string, unknown>;
    name: string;
    maxTokens?: number;
    /** Shown when the model runs out of output tokens. */
    truncatedMessage?: string;
  },
): Promise<T> {
  const client = getClient(config);
  let lastError: unknown;

  for (const mode of ["json_schema", "json_object"] as const) {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.model,
        max_tokens: opts.maxTokens ?? MAX_TOKENS,
        response_format:
          mode === "json_schema"
            ? { type: "json_schema", json_schema: { name: opts.name, schema: opts.jsonSchema, strict: true } }
            : { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.content },
        ],
      });
    } catch (error) {
      lastError = error;
      // A 400 usually means this response_format is unsupported: try the next mode.
      if (error instanceof OpenAI.APIError && error.status === 400 && mode === "json_schema") continue;
      throw new ExtractionError(
        error instanceof OpenAI.APIError
          ? `The AI service returned ${error.status ?? "an error"}: ${error.message}`
          : "Could not reach the AI service",
        "provider",
      );
    }

    if (completion.usage) config.onUsage?.(completion.usage);
    const choice = completion.choices[0];
    const message = choice?.message as { content?: string | null; refusal?: string | null } | undefined;
    reportReasoning(config, message);
    if (message?.refusal) throw new ExtractionError(message.refusal, "refused");
    if (choice?.finish_reason === "length") {
      throw new ExtractionError(opts.truncatedMessage ?? "That was too much to read in one go. Try fewer or closer photos.", "truncated");
    }
    try {
      return opts.schema.parse(JSON.parse(cleanModelJson(message?.content ?? "")));
    } catch (error) {
      lastError = error;
    }
  }
  console.error(`AI call "${opts.name}" produced invalid output`, lastError);
  throw new ExtractionError("The AI response couldn't be understood. Please try again.", "invalid_output");
}

/** Reads one bill. Pass several images when they are pages of the same bill. */
// Several images: the model also says how many different bills it sees, so unrelated bills aren't merged.
const multiPageSchema = receiptSchema.extend({
  billsShown: z
    .number()
    .int()
    .describe(
      "How many DIFFERENT bills these images show. 1 only if they are pages of ONE document (one header, page 2 continues page 1, one grand total). Count 2+ when images each have their own total, date/time, receipt or trip number — even from the same merchant (two taxi rides are two bills)",
    ),
});
const { $schema: _mp, ...multiPageJsonSchema } = z.toJSONSchema(multiPageSchema, { target: "draft-7" });

export async function extractReceiptWithNebius(config: NebiusConfig, images: string | string[]): Promise<ExtractedReceipt> {
  const pages = Array.isArray(images) ? images : [images];
  const multi = pages.length > 1;
  let result: ExtractedReceipt & { billsShown?: number };
  try {
    result = await chatJSON(config, {
      system: RECEIPT_SYSTEM_PROMPT,
      name: "receipt",
      schema: multi ? multiPageSchema : receiptSchema,
      jsonSchema: (multi ? multiPageJsonSchema : receiptJsonSchema) as Record<string, unknown>,
      content: [
        {
          type: "text",
          text: multi
            ? `These ${pages.length} images should be pages of ONE bill, in order. First check whether they really are one document: separate receipts each have their own total, date/time or receipt number, even from the same merchant. Set billsShown to how many different bills you see. If it is 1, extract the bill once across all pages.`
            : "Extract this bill.",
        },
        ...imageParts(pages),
      ],
    });
  } catch (e) {
    if (e instanceof ExtractionError && e.kind === "invalid_output")
      throw new ExtractionError("The bill could not be read. Try a sharper, well-lit photo.", "invalid_output");
    throw e;
  }
  if (multi && (result.billsShown ?? 1) > 1) {
    throw new ExtractionError(
      `These look like ${result.billsShown} different bills, not pages of one. Upload them as separate bills to combine them.`,
      "multiple_bills",
    );
  }
  const { billsShown: _b, ...receipt } = result;
  return receipt;
}

export { imageParts };

/** Thrown when the route rejects the `tools` parameter, so the caller can run the tools itself. */
export class ToolsUnsupportedError extends Error {}

/**
 * Agent loop with native function calling: the model calls tools (run locally by `runTool`) until it
 * returns its final answer as JSON, which is validated with `schema`. After `maxCalls` tool calls the
 * model is asked to answer without more tools.
 */
export async function chatWithTools<T>(
  config: NebiusConfig,
  opts: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    tools: OpenAI.Chat.Completions.ChatCompletionTool[];
    runTool: (name: string, args: string) => unknown;
    maxTokens?: number;
    maxCalls?: number;
    truncatedMessage?: string;
  },
): Promise<T> {
  const client = getClient(config);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const maxCalls = opts.maxCalls ?? 8;
  let calls = 0;
  let repaired = false;

  for (let turn = 0; turn < maxCalls + 3; turn++) {
    const toolsAllowed = calls < maxCalls;
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.model,
        max_tokens: opts.maxTokens ?? MAX_TOKENS,
        messages,
        tools: opts.tools,
        tool_choice: toolsAllowed ? "auto" : "none",
      });
    } catch (error) {
      if (turn === 0 && error instanceof OpenAI.APIError && error.status === 400) throw new ToolsUnsupportedError(error.message);
      throw new ExtractionError(
        error instanceof OpenAI.APIError ? `The AI service returned ${error.status ?? "an error"}: ${error.message}` : "Could not reach the AI service",
        "provider",
      );
    }
    if (completion.usage) config.onUsage?.(completion.usage);
    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") {
      throw new ExtractionError(opts.truncatedMessage ?? "That was too much to work out in one go.", "truncated");
    }
    const message = choice?.message;
    reportReasoning(config, message);
    const toolCalls = (message?.tool_calls ?? []).filter((c) => c.type === "function");
    if (toolCalls.length && toolsAllowed) {
      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        calls++;
        const result = opts.runTool(call.function.name, call.function.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      if (calls >= maxCalls) messages.push({ role: "user", content: "That's enough checking. Return the final JSON now." });
      continue;
    }
    try {
      return opts.schema.parse(JSON.parse(cleanModelJson(message?.content ?? "")));
    } catch (error) {
      // A format slip (a missing field, a stray word) shouldn't throw away the tool work: show the model what
      // was wrong and ask once for the corrected JSON, with no more tool calls.
      if (!repaired) {
        repaired = true;
        calls = maxCalls;
        const problem = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : "not valid JSON";
        messages.push({ role: "assistant", content: message?.content ?? "" });
        messages.push({ role: "user", content: `That JSON doesn't match the required format (${problem}). Reply with ONLY the corrected JSON object, including every required field.` });
        continue;
      }
      console.error("Tool-using call produced invalid output", error);
      throw new ExtractionError("The AI response couldn't be understood. Please try again.", "invalid_output");
    }
  }
  throw new ExtractionError("The AI kept calling tools without answering.", "invalid_output");
}
