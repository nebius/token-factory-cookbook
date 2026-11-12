import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatText, type CallUsage } from "./nebius";

// A stand-in for Token Factory's streaming chat endpoint. `everyChunk` sends a running usage total on each chunk
// (as Kimi K3.1 Pro does); otherwise usage comes once, on a final chunk with no choices (as DeepSeek does).
let server: Server;
let baseURL = "";
let everyChunk = false;
const words = ["Koa ", "composes ", "middleware."];

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    words.forEach((w, i) => {
      const last = i === words.length - 1;
      send({
        id: "c",
        object: "chat.completion.chunk",
        created: 0,
        model: "m",
        choices: [{ index: 0, delta: { content: w }, finish_reason: last ? "stop" : null }],
        ...(everyChunk ? { usage: { prompt_tokens: 1000, completion_tokens: (i + 1) * 10, total_tokens: 1000 + (i + 1) * 10, prompt_tokens_details: { cached_tokens: 800 } } } : {}),
      });
    });
    if (!everyChunk) send({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1000, completion_tokens: 30, total_tokens: 1030, prompt_tokens_details: { cached_tokens: 800 } } });
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function run() {
  const usage: CallUsage[] = [];
  const text = await chatText({ apiKey: "test", baseURL, model: "m", onUsage: (u) => usage.push(u) }, { prefix: [], task: "q", stream: {} });
  return { text, usage };
}

describe("streamed usage", () => {
  it("counts usage sent once on the last chunk", async () => {
    everyChunk = false;
    const { text, usage } = await run();
    expect(text).toBe("Koa composes middleware.");
    expect(usage.map(({ input, cached, output }) => ({ input, cached, output }))).toEqual([{ input: 1000, cached: 800, output: 30 }]);
  });

  it("counts a running total sent on every chunk once, at its final value", async () => {
    everyChunk = true;
    const { usage } = await run();
    expect(usage.map(({ input, cached, output }) => ({ input, cached, output }))).toEqual([{ input: 1000, cached: 800, output: 30 }]);
  });
});
