import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

function requireEnvironmentVariable(
  name: "NEBIUS_API_KEY" | "NEBIUS_MODEL",
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Copy example.env to .env and set it.`,
    );
  }
  return value;
}

const tokenFactory = createOpenAICompatible({
  name: "nebius-token-factory",
  apiKey: requireEnvironmentVariable("NEBIUS_API_KEY"),
  baseURL: "https://api.tokenfactory.nebius.com/v1",
});

const weather = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({
    city: z.string().min(1).describe("City name"),
  }),
  execute: async ({ city }) => ({
    city,
    condition: "clear",
    temperatureCelsius: 18,
  }),
});

const result = streamText({
  model: tokenFactory.chatModel(requireEnvironmentVariable("NEBIUS_MODEL")),
  prompt:
    "Use the weather tool for Helsinki, then summarize the result in one sentence.",
  tools: { weather },
  stopWhen: stepCountIs(3),
});

for await (const textPart of result.textStream) {
  process.stdout.write(textPart);
}
process.stdout.write("\n");
