import { readFile } from "node:fs/promises";
import process from "node:process";

const EXPECTED_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const EXPECTED_ENV_KEY = "NEBIUS_API_KEY";

export function validateConfig(config) {
  const errors = [];
  const models = config.modelProviders?.openai;

  if (!Array.isArray(models) || models.length !== 1) {
    errors.push("modelProviders.openai must contain exactly one model");
    return errors;
  }

  const [model] = models;
  if (model.baseUrl !== EXPECTED_BASE_URL) {
    errors.push(`baseUrl must be ${EXPECTED_BASE_URL}`);
  }
  if (model.envKey !== EXPECTED_ENV_KEY) {
    errors.push(`envKey must be ${EXPECTED_ENV_KEY}`);
  }
  if (!model.id || model.id.startsWith("openai/")) {
    errors.push("id must be the raw Token Factory model ID");
  }
  if (config.security?.auth?.selectedType !== "openai") {
    errors.push("security.auth.selectedType must be openai");
  }
  if (config.model?.name !== model.id) {
    errors.push("model.name must match the configured model id");
  }
  if ("env" in config) {
    errors.push("do not store API keys in settings.json");
  }

  return errors;
}

async function main() {
  const configUrl = new URL("./settings.json", import.meta.url);
  const config = JSON.parse(await readFile(configUrl, "utf8"));
  const errors = validateConfig(config);

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("Qwen Code Token Factory configuration is valid.");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main();
}
