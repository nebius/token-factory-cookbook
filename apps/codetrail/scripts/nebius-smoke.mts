// Checks the model on Token Factory: context, prices, and one small JSON call. pnpm smoke:nebius
import "dotenv/config";
import { env } from "../src/env";
import { fetchPrices } from "../src/server/ai/pricing";

const res = await fetch(new URL("models?verbose=true", env.NEBIUS_BASE_URL), { headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}` } });
const model = ((await res.json()) as { data: { id: string; context_length?: number; architecture?: unknown }[] }).data.find((m) => m.id === env.NEBIUS_MODEL);
if (!model) throw new Error(`${env.NEBIUS_MODEL} isn't on ${env.NEBIUS_BASE_URL}`);
const price = (await fetchPrices(env.NEBIUS_API_KEY ?? "", env.NEBIUS_BASE_URL)).models[env.NEBIUS_MODEL];
console.log(model.id, { context: model.context_length, architecture: model.architecture });
console.log("per 1M tokens:", { input: price.input * 1e6, cached: price.cached * 1e6, output: price.output * 1e6 });

const chat = await fetch(new URL("chat/completions", env.NEBIUS_BASE_URL), {
  method: "POST",
  headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ model: env.NEBIUS_MODEL, messages: [{ role: "user", content: 'Reply with {"ok": true}' }], response_format: { type: "json_object" }, max_tokens: 200 }),
});
const body = (await chat.json()) as { choices?: { message: { content: string } }[]; usage?: unknown };
console.log(chat.status, body.choices?.[0]?.message.content, body.usage);
