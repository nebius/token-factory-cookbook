import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

// Exercise the protocol through the exact browser dependency used by Mastra.
// These checks need no browser session, credentials, or network access.
const require = createRequire(import.meta.url);
const adapterRequire = createRequire(require.resolve("@mastra/agent-browser"));
const browserEntry = pathToFileURL(adapterRequire.resolve("agent-browser"));
const { parseCommand } = await import(new URL("./protocol.js", browserEntry));

test("Mastra's CDP adapter exposes browser tools without mobile dependencies", async () => {
  const { AgentBrowser } = await import("@mastra/agent-browser");
  const browser = new AgentBrowser({ cdpUrl: "ws://127.0.0.1:9222" });
  const tools = browser.getTools();
  assert.equal(typeof tools.browser_goto.execute, "function");
  assert.equal(typeof tools.browser_snapshot.execute, "function");
});

test("browser commands retain typed header records after the Zod upgrade", () => {
  const parsed = parseCommand(JSON.stringify({
    id: "navigate-1", action: "navigate", url: "https://example.com",
    headers: { "x-example": "value" },
  }));
  assert.equal(parsed.success, true);
  const invalid = parseCommand(JSON.stringify({
    id: "headers-1", action: "headers", headers: { "x-example": 7 },
  }));
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /Validation error/);
  assert.equal(invalid.id, "headers-1");
});

test("invalid commands return errors rather than throwing", () => {
  for (const input of ["{", "null", '{"id":"bad","action":"unknown"}']) {
    assert.equal(parseCommand(input).success, false);
  }
});

test("cross-field browser validation still rejects an unspecified frame", () => {
  const parsed = parseCommand('{"id":"frame-1","action":"frame"}');
  assert.equal(parsed.success, false);
  assert.match(parsed.error, /frame command requires/);
});
