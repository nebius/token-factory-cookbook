// Kimi Image → 3D — tiny zero-dependency server.
// Serves the UI and proxies streaming chat completions to Nebius Token Factory.
// Key resolution: user's BYOK header (x-nebius-key) → NEBIUS_API_KEY from env/.env.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* .env is optional */ }

const PORT = Number(process.env.PORT || 5173);
const DEFAULT_BASE_URL = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.NEBIUS_MODEL || "moonshotai/Kimi-K3.1-Pro";
const SERVER_KEY = (process.env.NEBIUS_API_KEY || "").trim();
const PUBLIC_DIR = join(ROOT, "public");
const MAX_BODY = 12 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

// Only allow BYOK base URLs that point at Nebius (keeps the proxy from being an open relay).
function resolveBaseUrl(requested) {
  if (!requested) return DEFAULT_BASE_URL;
  try {
    const u = new URL(requested);
    if (u.protocol === "https:" && /(^|\.)nebius\.com$/.test(u.hostname)) return requested.replace(/\/+$/, "");
  } catch { /* fall through */ }
  return null;
}

// Pull a readable message out of an upstream error body.
function upstreamMessage(text) {
  let msg = text.slice(0, 600);
  try { const j = JSON.parse(text); msg = j.error?.message || j.detail || j.message || msg; } catch { /* raw text */ }
  return typeof msg === "string" ? msg : JSON.stringify(msg);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large (max 12 MB)."), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleConfig(_req, res) {
  sendJson(res, 200, { hasServerKey: Boolean(SERVER_KEY), model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL });
}

// Lightweight key check for the BYOK dialog.
async function handleVerify(req, res) {
  const key = (req.headers["x-nebius-key"] || "").toString().trim() || SERVER_KEY;
  const base = resolveBaseUrl((req.headers["x-nebius-base-url"] || "").toString());
  if (!key) return sendJson(res, 400, { ok: false, error: "No API key provided." });
  if (!base) return sendJson(res, 400, { ok: false, error: "Base URL must be an https://*.nebius.com endpoint." });
  try {
    const r = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return sendJson(res, 200, { ok: false, error: `Token Factory replied ${r.status}: ${upstreamMessage(await r.text())}` });
    const data = await r.json();
    const ids = (data.data || []).map((m) => m.id);
    sendJson(res, 200, { ok: true, models: ids.filter((id) => /kimi|moonshot/i.test(id)), total: ids.length });
  } catch (e) {
    sendJson(res, 200, { ok: false, error: `Could not reach Token Factory: ${e.message}` });
  }
}

// Streams Token Factory SSE straight through to the browser.
async function handleChat(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const key = (req.headers["x-nebius-key"] || "").toString().trim() || SERVER_KEY;
  const base = resolveBaseUrl((req.headers["x-nebius-base-url"] || "").toString());
  if (!key) return sendJson(res, 401, { error: "No API key. Add your Nebius Token Factory key via “Bring your own key”, or set NEBIUS_API_KEY in .env." });
  if (!base) return sendJson(res, 400, { error: "Base URL must be an https://*.nebius.com endpoint." });
  if (!Array.isArray(body.messages) || body.messages.length === 0) return sendJson(res, 400, { error: "messages[] is required." });

  const payload = {
    model: (body.model || DEFAULT_MODEL).toString(),
    messages: body.messages,
    stream: true,
    max_tokens: Math.min(Number(body.max_tokens) || 24000, 64000),
    temperature: typeof body.temperature === "number" ? body.temperature : 0.6,
  };

  const upstreamAbort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) upstreamAbort.abort(); });

  let upstream;
  try {
    upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(payload),
      signal: upstreamAbort.signal,
    });
  } catch (e) {
    return sendJson(res, 502, { error: `Could not reach Token Factory: ${e.message}` });
  }

  if (!upstream.ok || !upstream.body) {
    const msg = upstreamMessage(await upstream.text().catch(() => ""));
    const hint = upstream.status === 401 || upstream.status === 403 ? " — check your API key." : upstream.status === 404 ? ` — is “${payload.model}” available on your account?` : "";
    return sendJson(res, upstream.status, { error: `Token Factory ${upstream.status}: ${msg}${hint}` });
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  try {
    for await (const chunk of upstream.body) res.write(chunk);
  } catch (e) {
    if (e.name !== "AbortError") res.write(`data: ${JSON.stringify({ error: { message: `Stream interrupted: ${e.message}` } })}\n\n`);
  }
  res.end();
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/config") return await handleConfig(req, res);
    if (req.method === "GET" && req.url === "/api/verify") return await handleVerify(req, res);
    if (req.method === "POST" && req.url === "/api/chat") return await handleChat(req, res);
    if (req.method === "GET") return await serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n  Kimi Image → 3D  ·  http://localhost:${server.address().port}`);
  console.log(`  model: ${DEFAULT_MODEL}  ·  base: ${DEFAULT_BASE_URL}`);
  console.log(`  server key: ${SERVER_KEY ? "configured" : "not set (users must bring their own key)"}\n`);
});
