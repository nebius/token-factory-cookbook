#!/usr/bin/env node
/**
 * Nebius Realtime Webcam — tiny zero-dependency proxy.
 *
 * The browser never sees the API key: it POSTs frames here, and this server
 * forwards them to Nebius Token Factory's OpenAI-compatible chat/completions,
 * relaying the token stream back as Server-Sent Events.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const PORT = Number(process.env.PORT ?? 8080);
const API_KEY = process.env.NEBIUS_API_KEY;
const BASE_URL = (process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.us-north1.nebius.com/v1').replace(/\/$/, '');
// Pinned: DeepSeek V4.1 Flash is the one vision model here that answers in
// well under a second with thinking off. Override only if you know it's faster.
const MODEL = process.env.NEBIUS_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * DeepSeek V4.1 Flash is a hybrid reasoner, and on a webcam loop the chain of
 * thought is pure latency: it ate the whole max_tokens budget and left
 * `content` empty — the "(empty response)" rows. These two switches turn
 * thinking off; different model families read different ones, so send both.
 */
const REASONING_OFF = { reasoning_effort: 'none', chat_template_kwargs: { thinking: false } };

/** Models that 400 on the switches above; we stop sending them after the first try. */
const rejectsReasoningOff = new Set();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJsonBody(req, limitBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Forward to Nebius, returning { ok, status, data }. */
async function nebius(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text.slice(0, 500) || res.statusText };
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Node drops an idle HTTP/2 connection after ~4 seconds, and re-establishing
 * TCP+TLS to Nebius costs the better part of a second — which the demo then
 * pays on *every* frame at a 2 s or 5 s interval. A token-free GET on a 2 s
 * timer keeps the socket hot. Measured time-to-first-token after a 6 s gap:
 * 1835 ms cold, 1020 ms warm, against 992 ms back-to-back.
 */
function pingUpstream() {
  fetch(`${BASE_URL}/models`, { headers: { authorization: `Bearer ${API_KEY}` } })
    .then((res) => res.arrayBuffer())
    .catch(() => {}); // a failed ping is not worth reporting; the next frame will say so
}

let warmTimer = null;
let warmUntil = 0;

/** Hold the upstream connection open for a while after the last frame. */
function keepWarm(forMs = 30_000) {
  warmUntil = Date.now() + forMs;
  if (warmTimer) return;

  warmTimer = setInterval(() => {
    if (Date.now() > warmUntil) {
      clearInterval(warmTimer);
      warmTimer = null;
      return;
    }
    pingUpstream();
  }, 2000);
  warmTimer.unref(); // never hold the process open just for this
}

/** Nebius reports failures as {error:{message}}, {detail}, or a bare string. */
function errorMessage(data, fallback) {
  const candidates = [data?.error?.message, data?.error, data?.detail, data?.message];
  const found = candidates.find((c) => typeof c === 'string' && c);
  return found ?? (data ? JSON.stringify(data).slice(0, 500) : fallback);
}

/**
 * Nebius reports modality as e.g. "text->text" or "text+image->text".
 * Anything with an image on the input side can take webcam frames.
 */
function isVisionModel(model) {
  const modality = model?.architecture?.modality;
  if (typeof modality !== 'string') return false;
  const [input = ''] = modality.split('->');
  return input.includes('image');
}

async function handleModel(res) {
  const { ok, status, data } = await nebius('/models?verbose=true');
  if (!ok) return send(res, status, { error: { message: errorMessage(data, 'Could not list models.') } });

  const all = Array.isArray(data?.data) ? data.data : [];
  const configured = all.find((m) => m.id === MODEL);

  send(res, 200, {
    model: MODEL,
    // Surfaced so the UI can warn when the pinned model isn't servable here.
    exists: Boolean(configured),
    isVision: isVisionModel(configured),
  });
}

function completionPayload({ model, prompt, image, maxTokens, detail, thinking }) {
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true },
    ...(thinking ? {} : REASONING_OFF),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image, detail } },
        ],
      },
    ],
  });
}

/** True when the upstream 4xx is complaining about the thinking switches specifically. */
function isReasoningParamError(text) {
  return /reasoning_effort|chat_template_kwargs|thinking/i.test(text);
}

async function handleAnalyze(req, res) {
  const body = await readJsonBody(req);
  const { image, prompt, maxTokens = 128, detail = 'auto' } = body;
  const model = MODEL; // pinned server-side; the client doesn't get to pick

  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return send(res, 400, { error: { message: 'Expected `image` as a data: URL.' } });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return send(res, 400, { error: { message: 'Expected a non-empty `prompt`.' } });
  }

  keepWarm(); // the next frame is ~1 s away; don't let the socket go cold

  const startedAt = Date.now();
  const controller = new AbortController();
  req.on('close', () => controller.abort()); // browser hung up (Stop, or a new frame)

  const open = (thinking) =>
    fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: completionPayload({ model, prompt, image, maxTokens, detail, thinking }),
    });

  let upstream = await open(rejectsReasoningOff.has(model));

  // Some models (MiniCPM) reject `reasoning_effort: none` outright. Retry once
  // plain, and remember, so the demo never dies on an unsupported switch.
  if (!upstream.ok && upstream.status >= 400 && upstream.status < 500 && !rejectsReasoningOff.has(model)) {
    const text = await upstream.text();
    if (isReasoningParamError(text)) {
      rejectsReasoningOff.add(model);
      upstream = await open(true);
    } else {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 500) };
      }
      return send(res, upstream.status, { error: { message: errorMessage(data, 'Inference request failed.') } });
    }
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 500) || upstream.statusText };
    }
    return send(res, upstream.status, { error: { message: errorMessage(data, 'Inference request failed.') } });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  let usage = null;
  let finishReason = null;
  let servedModel = model;
  let firstTokenMs = null;
  let sawContent = false;

  try {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.usage) usage = parsed.usage;
        if (parsed.model) servedModel = parsed.model;

        const choice = parsed.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta ?? {};
        // Kimi calls it `reasoning`, DeepSeek/GLM call it `reasoning_content`.
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (typeof thought === 'string' && thought) emit({ reasoning: thought });

        if (typeof delta.content === 'string' && delta.content) {
          if (firstTokenMs == null) firstTokenMs = Date.now() - startedAt;
          sawContent = true;
          emit({ delta: delta.content });
        }
      }
    }

    emit({
      done: true,
      model: servedModel,
      usage,
      finishReason,
      sawContent,
      firstTokenMs,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    if (err.name !== 'AbortError') emit({ error: { message: err.message } });
  } finally {
    res.end();
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').slice(1);
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: { message: 'Forbidden' } });

  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    send(res, 404, { error: { message: 'Not found' } });
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname.startsWith('/api/') && !API_KEY) {
      return send(res, 500, { error: { message: 'NEBIUS_API_KEY is not set. Copy .env.example to .env and add your key.' } });
    }
    if (pathname === '/api/model' && req.method === 'GET') return await handleModel(res);
    if (pathname === '/api/analyze' && req.method === 'POST') return await handleAnalyze(req, res);
    if (req.method === 'GET') return await serveStatic(req, res);

    send(res, 404, { error: { message: 'Not found' } });
  } catch (err) {
    if (res.headersSent) return res.end();
    const status = err instanceof SyntaxError || err.message === 'Payload too large' ? 400 : 500;
    send(res, status, { error: { message: err.message } });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Nebius realtime webcam → http://localhost:${PORT}`);
  console.log(`  model:    ${MODEL}`);
  console.log(`  upstream: ${BASE_URL}`);
  if (!API_KEY) {
    console.log('\n  ⚠ NEBIUS_API_KEY is not set — requests will fail until you add it.\n');
  } else {
    pingUpstream(); // open the TLS connection now, so the first frame isn't the slow one
    console.log('');
  }
});
