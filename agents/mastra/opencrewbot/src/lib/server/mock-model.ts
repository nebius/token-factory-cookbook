// A scripted stand-in for a real model, used when NEBIUS_API_KEY is missing.
// It streams a short reply and exercises the same paths a real model does:
// "remember …" calls the memory tool, "search …" calls web search, "ask me …"
// asks a question card, and "open <url>" drives the browser (which asks first).
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

type Part = Record<string, unknown>;
type PromptMessage = { role: string; content: unknown };

function lastUserText(prompt: PromptMessage[]): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((p: { type?: string }) => p.type === "text")
        .map((p: { text?: string }) => p.text ?? "")
        .join("\n");
    }
  }
  return "";
}

function streamOf(parts: Part[], delayMs = 25): ReadableStream<Part> {
  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
        if (part.type === "text-delta") await new Promise((r) => setTimeout(r, delayMs));
      }
      controller.close();
    },
  });
}

function textParts(text: string): Part[] {
  const words = text.match(/\S+\s*/g) ?? [text];
  return [
    { type: "text-start", id: "t" },
    ...words.map((delta) => ({ type: "text-delta", id: "t", delta })),
    { type: "text-end", id: "t" },
  ];
}

const usage = { inputTokens: 120, outputTokens: 40, totalTokens: 160 };

export function createMockModel(botName: string) {
  return new MastraLanguageModelV2Mock({
    provider: "mock",
    modelId: "mock-model",
    // The mock's stream-part type isn't exported, so the scripted parts are cast.
    doStream: (async (options: { prompt: unknown; tools?: Array<{ name: string }> }) => {
      const prompt = options.prompt as PromptMessage[];
      const tools = new Set((options.tools ?? []).map((t) => t.name));
      const last = prompt[prompt.length - 1];
      const start = [{ type: "stream-start", warnings: [] }];

      if (last?.role === "tool") {
        // Tool results arrive wrapped as { type, value }; show the value plainly.
        const output = (last.content as Array<{ output?: { value?: unknown } }>)?.[0]?.output;
        const value = output && typeof output === "object" && "value" in output ? output.value : output;
        const content = value && typeof value === "object" && "content" in value ? (value as { content: unknown }).content : value;
        const result = (typeof content === "string" ? content : JSON.stringify(content ?? "")).slice(0, 160);
        return {
          stream: streamOf([
            ...start,
            ...textParts(`Done. The tool returned: ${result}\n\n*(Mock model. The tool really ran.)*`),
            { type: "finish", finishReason: "stop", usage },
          ]),
        };
      }

      const toolCall = (toolName: string, input: unknown) => ({
        stream: streamOf([
          ...start,
          { type: "tool-call", toolCallId: `mock-${Date.now()}`, toolName, input: JSON.stringify(input) },
          { type: "finish", finishReason: "tool-calls", usage },
        ]),
      });

      // Room turns wrap the room's new lines; use the person's latest line.
      const lines = lastUserText(prompt).split("\n").filter(Boolean);
      const personLine = lines.filter((l) => l.startsWith("Person: ")).pop();
      const said = personLine ? personLine.slice("Person: ".length) : (lines.pop() ?? "");
      const remember = said.match(/remember (?:that )?(.+)/i);
      if (remember && tools.has("memory_add")) return toolCall("memory_add", { note: remember[1] });
      if (/\bask me\b/i.test(said) && tools.has("ask_user")) {
        return toolCall("ask_user", {
          question: "Do you want short answers or detailed ones?",
          options: [{ label: "Short" }, { label: "Detailed", description: "With sources and caveats" }],
        });
      }
      const url = said.match(/\bopen (https?:\/\/\S+)/i);
      if (url && tools.has("browser_goto")) return toolCall("browser_goto", { url: url[1] });
      const search = said.match(/(?:search|look up|find)\s+(?:for\s+)?(.+)/i);
      if (search && tools.has("web_search")) return toolCall("web_search", { query: search[1], maxResults: 3 });

      const reply =
        `Hi, I'm **${botName}**, running on the *mock model* because no \`NEBIUS_API_KEY\` is set yet.\n\n` +
        `You said: "${said.slice(0, 200)}"\n\n` +
        "Try `remember that I like short answers`, `search for Nebius Token Factory`, or `ask me something` to see tools run.";
      return { stream: streamOf([...start, ...textParts(reply), { type: "finish", finishReason: "stop", usage }]) };
    }) as never,
  });
}
