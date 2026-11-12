// A scripted stand-in for a real model, used when NEBIUS_API_KEY is missing.
// It streams a short reply and exercises the same paths a real model does:
// "remember …" calls the memory tool, "search …" calls web search, "ask me …"
// asks a question card, and "open <url>" drives the browser (which asks first).
// Briefs and check-ins get a canned reply, so the schedule can be tried too, and
// "send a mail to … about …" drafts an email that waits for your OK.
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
        const sent = content && typeof content === "object" && (content as { sent?: boolean }).sent;
        if (sent || /declin|denied|not approved|reject/i.test(result)) {
          const text = sent
            ? `Sent to ${(content as { to?: string }).to}. ✓\n\n*(Mock mode: nothing actually left this machine.)*`
            : "Okay, I didn't send it. The draft is above if you want to change anything.";
          return { stream: streamOf([...start, ...textParts(text), { type: "finish", finishReason: "stop", usage }]) };
        }
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

      const asked = lastUserText(prompt);
      const reply = (text: string) => ({ stream: streamOf([...start, ...textParts(text), { type: "finish", finishReason: "stop", usage }]) });
      if (asked.startsWith("[Brief]")) {
        return reply(
          `**Your brief from ${botName}**\n\n` +
            "1. **Nothing urgent overnight.** Your connected apps would show up here, most important first, with a next step for each.\n" +
            "2. **One reply you owe.** On a real model I'd offer a draft and wait for your OK before sending it.\n\n" +
            "*(Mock model. Set NEBIUS_API_KEY for a real brief.)*",
        );
      }
      if (asked.startsWith("[Check-in]")) {
        // A scheduled check-in finds nothing, so it leaves no message (see NOTHING_TO_REPORT in runtime.ts).
        return reply(asked.includes("NOTHING_TO_REPORT") ? "NOTHING_TO_REPORT" : "Nothing needs you right now. *(Mock model.)*");
      }

      // Room turns wrap the room's new lines; use the person's latest line.
      const lines = asked.split("\n").filter(Boolean);
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
      // "send a mail to maya@harbor.vc about the deck": draft it, then ask before sending.
      const mail = said.match(/\b(?:send|write|draft)\b.*?\b(?:e-?mail|mail)\b.*?\bto\s+(.+?)(?:\s+(?:about|re|regarding)\s+(.+?))?[.!]?$/i);
      if (mail && tools.has("send_email")) {
        const to = mail[1].trim();
        const topic = mail[2]?.trim() || "a quick update";
        const first = to.split(/[@\s.]/)[0];
        const name = first.charAt(0).toUpperCase() + first.slice(1);
        return {
          stream: streamOf([
            ...start,
            ...textParts("Drafted it. Send from you?"),
            {
              type: "tool-call",
              toolCallId: `mock-${Date.now()}`,
              toolName: "send_email",
              input: JSON.stringify({
                to,
                subject: topic.replace(/^(the|a|an|our|my)\s+/i, "").replace(/^./, (c) => c.toUpperCase()),
                body: `Hi ${name},\n\nSharing ${topic} ahead of Thursday. Happy to walk you through it whenever suits you.\n\nBest,`,
              }),
            },
            { type: "finish", finishReason: "tool-calls", usage },
          ]),
        };
      }
      const url = said.match(/\bopen (https?:\/\/\S+)/i);
      if (url && tools.has("browser_goto")) return toolCall("browser_goto", { url: url[1] });
      const search = said.match(/(?:search|look up|find)\s+(?:for\s+)?(.+)/i);
      if (search && tools.has("web_search")) return toolCall("web_search", { query: search[1], maxResults: 3 });

      return reply(
        `Hi, I'm **${botName}**, running on the *mock model* because no \`NEBIUS_API_KEY\` is set yet.\n\n` +
          `You said: "${said.slice(0, 200)}"\n\n` +
          "Try `remember that I like short answers`, `search for Nebius Token Factory`, or `ask me something` to see tools run.",
      );
    }) as never,
  });
}
