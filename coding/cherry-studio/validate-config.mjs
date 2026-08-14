import { readFile } from "node:fs/promises";
import process from "node:process";

const BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const CHAT_ENDPOINT = "openai-chat-completions";

export function deriveRoutes(config) {
  const baseUrl = config.endpointConfigs?.[CHAT_ENDPOINT]?.baseUrl?.replace(
    /\/+$/,
    "",
  );
  return {
    chatCompletions: baseUrl ? `${baseUrl}/chat/completions` : "",
    models: baseUrl ? `${baseUrl}/models` : "",
  };
}

export function validateConfig(config) {
  const errors = [];
  const endpoint = config.endpointConfigs?.[CHAT_ENDPOINT];

  if (config.providerName !== "Nebius Token Factory") {
    errors.push("providerName must be Nebius Token Factory");
  }
  if (config.defaultChatEndpoint !== CHAT_ENDPOINT) {
    errors.push("defaultChatEndpoint must use OpenAI Chat Completions");
  }
  if (endpoint?.baseUrl !== BASE_URL) {
    errors.push(`Chat Completions baseUrl must be ${BASE_URL}`);
  }
  if (
    Object.keys(config.endpointConfigs ?? {}).some((key) =>
      key.includes("responses"),
    )
  ) {
    errors.push("do not configure a Responses endpoint in this recipe");
  }
  if (!config.model?.id || config.model.id.startsWith("openai/")) {
    errors.push("model.id must be the raw Token Factory model ID");
  }
  if (
    !Array.isArray(config.model?.endpointTypes) ||
    config.model.endpointTypes.length !== 1 ||
    config.model.endpointTypes[0] !== CHAT_ENDPOINT
  ) {
    errors.push(
      "model.endpointTypes must contain only OpenAI Chat Completions",
    );
  }
  if ("apiKey" in config || "apiKeys" in config) {
    errors.push("do not store API keys in the checked-in manifest");
  }

  return errors;
}

async function main() {
  const config = JSON.parse(
    await readFile(new URL("./config.json", import.meta.url), "utf8"),
  );
  const errors = validateConfig(config);

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const routes = deriveRoutes(config);
  console.log(`Chat route: ${routes.chatCompletions}`);
  console.log(`Model discovery: ${routes.models}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main();
}
