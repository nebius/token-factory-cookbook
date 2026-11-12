// Credential-free checks for the proxy. No request reaches Token Factory.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let child;
let base;

before(async () => {
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", NEBIUS_API_KEY: "", NEBIUS_BASE_URL: "", NEBIUS_MODEL: "" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  base = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => child?.kill());

const chat = (headers, body = { messages: [{ role: "user", content: "hi" }] }) =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("serves the app", async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>/);
});

test("reports config without exposing a key", async () => {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(Object.keys(cfg).sort(), ["baseUrl", "hasServerKey", "model"]);
  assert.equal(cfg.hasServerKey, false);
  assert.equal(cfg.model, "moonshotai/Kimi-K3.1-Pro");
});

test("asks for a key when neither the server nor the user has one", async () => {
  assert.equal((await chat({})).status, 401);
});

test("refuses base URLs outside https://*.nebius.com", async () => {
  for (const url of ["https://example.com/v1", "http://api.tokenfactory.nebius.com/v1", "https://nebius.com.evil.io/v1"]) {
    const r = await chat({ "x-nebius-key": "test-key", "x-nebius-base-url": url });
    assert.equal(r.status, 400, url);
  }
});

test("requires messages", async () => {
  assert.equal((await chat({ "x-nebius-key": "test-key" }, {})).status, 400);
});

test("does not serve files outside public/", async () => {
  for (const path of ["/../server.js", "/..%2fserver.js", "/../.env"]) {
    const r = await fetch(`${base}${path}`);
    assert.notEqual(r.status, 200, path);
  }
});
