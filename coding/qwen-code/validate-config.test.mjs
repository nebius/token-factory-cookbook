import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateConfig } from "./validate-config.mjs";

const config = JSON.parse(
  await readFile(new URL("./settings.json", import.meta.url), "utf8"),
);

test("recipe uses Qwen Code custom OpenAI routing", () => {
  assert.deepEqual(validateConfig(config), []);

  const [model] = config.modelProviders.openai;
  assert.equal(model.id, "moonshotai/Kimi-K2.7-Code");
  assert.equal(model.baseUrl, "https://api.tokenfactory.nebius.com/v1");
  assert.equal(model.envKey, "NEBIUS_API_KEY");
  assert.equal(config.security.auth.selectedType, "openai");
  assert.equal(config.model.name, model.id);
  assert.equal(Object.hasOwn(config, "env"), false);
});

test("validator rejects common routing and secret mistakes", () => {
  const badConfig = structuredClone(config);
  badConfig.modelProviders.openai[0].baseUrl =
    "https://api.tokenfactory.nebius.com";
  badConfig.modelProviders.openai[0].envKey = "OPENAI_API_KEY";
  badConfig.modelProviders.openai[0].id = "openai/moonshotai/Kimi-K2.7-Code";
  badConfig.security.auth.selectedType = "responses";
  badConfig.model.name = "another-model";
  badConfig.env = { NEBIUS_API_KEY: "secret" };

  assert.deepEqual(validateConfig(badConfig), [
    "baseUrl must be https://api.tokenfactory.nebius.com/v1",
    "envKey must be NEBIUS_API_KEY",
    "id must be the raw Token Factory model ID",
    "security.auth.selectedType must be openai",
    "model.name must match the configured model id",
    "do not store API keys in settings.json",
  ]);
});
