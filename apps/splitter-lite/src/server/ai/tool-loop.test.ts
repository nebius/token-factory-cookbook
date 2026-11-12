import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// A scripted model: each call returns the next reply.
const replies: unknown[] = [];
const seen: unknown[] = [];
vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
  }
  class OpenAI {
    static APIError = APIError;
    chat = {
      completions: {
        create: async (body: unknown) => {
          seen.push(JSON.parse(JSON.stringify(body)));
          return replies.shift();
        },
      },
    };
  }
  return { default: OpenAI, APIError };
});

const { chatWithTools } = await import("./nebius");
const reply = (message: Record<string, unknown>) => ({ choices: [{ finish_reason: "stop", message }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

describe("chatWithTools", () => {
  it("runs the model's tool calls, then asks once for corrected JSON when a field is missing", async () => {
    replies.push(
      reply({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":2,"b":3}' } }] }),
      reply({ content: '{"sum":5}' }), // missing "note"
      reply({ content: '{"sum":5,"note":"done"}' }),
    );
    const ran: string[] = [];
    const out = await chatWithTools(
      { apiKey: "k", baseURL: "http://x", model: "m" },
      {
        system: "s",
        user: "u",
        schema: z.object({ sum: z.number(), note: z.string() }),
        tools: [],
        runTool: (name, args) => {
          ran.push(`${name}${args}`);
          return { sum: 5 };
        },
      },
    );
    expect(out).toEqual({ sum: 5, note: "done" });
    expect(ran).toEqual(['add{"a":2,"b":3}']);
    // The repair turn tells the model what was wrong and turns tools off.
    const repair = seen[2] as { messages: { content: string }[]; tool_choice: string };
    expect(repair.tool_choice).toBe("none");
    expect(repair.messages.at(-1)?.content).toMatch(/note/);
  });

  it("sends no reasoning or sampling fields, so Token Factory's defaults apply (reasoning on)", () => {
    for (const body of seen as Record<string, unknown>[]) {
      for (const field of ["temperature", "top_p", "reasoning_effort", "chat_template_kwargs"]) expect(body).not.toHaveProperty(field);
      expect(body.max_tokens).toBe(16384);
    }
  });
});
