import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveRoutes, validateConfig } from "./validate-config.mjs";

const config = JSON.parse(
  await readFile(new URL("./config.json", import.meta.url), "utf8"),
);

test("manifest represents Cherry Studio custom Chat Completions setup", () => {
  assert.deepEqual(validateConfig(config), []);
  assert.equal(config.model.id, "moonshotai/Kimi-K2.7-Code");
  assert.equal(Object.hasOwn(config, "apiKey"), false);
  assert.equal(Object.hasOwn(config, "apiKeys"), false);
});

test("canonical base URL produces Cherry Studio request and discovery routes", () => {
  assert.deepEqual(deriveRoutes(config), {
    chatCompletions: "https://api.tokenfactory.nebius.com/v1/chat/completions",
    models: "https://api.tokenfactory.nebius.com/v1/models",
  });
});

test("validator rejects Responses, prefixed models, wrong routes, and secrets", () => {
  const invalid = structuredClone(config);
  invalid.providerName = "AI Studio";
  invalid.defaultChatEndpoint = "openai-responses";
  invalid.endpointConfigs["openai-chat-completions"].baseUrl =
    "https://api.studio.nebius.ai/v1";
  invalid.endpointConfigs["openai-responses"] = {
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
  };
  invalid.model.id = "openai/moonshotai/Kimi-K2.7-Code";
  invalid.model.endpointTypes = ["openai-responses"];
  invalid.apiKey = "secret";

  assert.deepEqual(validateConfig(invalid), [
    "providerName must be Nebius Token Factory",
    "defaultChatEndpoint must use OpenAI Chat Completions",
    "Chat Completions baseUrl must be https://api.tokenfactory.nebius.com/v1",
    "do not configure a Responses endpoint in this recipe",
    "model.id must be the raw Token Factory model ID",
    "model.endpointTypes must contain only OpenAI Chat Completions",
    "do not store API keys in the checked-in manifest",
  ]);
});
