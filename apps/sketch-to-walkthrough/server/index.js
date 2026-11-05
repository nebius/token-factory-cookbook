import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { completeLines, joinContinuation, lastNonEmptyLine, moduleParses, recoverReviewResponses, streamIsComplete } from './stitch.js';

const app = new Hono();
const API_KEY = process.env.NEBIUS_API_KEY;
const BASE_URL = (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/$/, '');
const MODEL = process.env.MODEL || 'moonshotai/Kimi-K3.1-Pro';
const GENERATE_REASONING_EFFORT = process.env.GENERATE_REASONING_EFFORT || 'low';
const REVIEW_REASONING_EFFORT = process.env.REVIEW_REASONING_EFFORT || 'medium';
// Budgets cover reasoning plus the full module. A large plan's review rewrites ~40k characters after
// ~20k reasoning tokens; running out of budget is not a network drop, and resuming it re-reasons from scratch.
const GENERATE_MAX_TOKENS = Number(process.env.GENERATE_MAX_TOKENS || 64000);
const REVIEW_MAX_TOKENS = Number(process.env.REVIEW_MAX_TOKENS || 96000);
const generatePrompt = await readFile(new URL('../prompts/generate.md', import.meta.url), 'utf8');
const reviewPrompt = await readFile(new URL('../prompts/review.md', import.meta.url), 'utf8');
const imagePart = (data) => ({ type: 'image_url', image_url: { url: data } });

function checkRequest(image) {
  if (!API_KEY) throw new Error('Set NEBIUS_API_KEY in .env to use Kimi.');
  if (typeof image !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(image) || image.length > 18_000_000) {
    throw new Error('Upload a PNG, JPEG, or WebP image smaller than 12 MB.');
  }
}

async function completion(messages, kind, maxTokens = 18000) {
  const started = performance.now();
  let prefix = '';
  // A network drop must not discard a long generation. Continue from the exact partial content.
  let stitched = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Nebius has no true assistant prefill for Kimi, so resume on a clean line boundary and join defensively.
    const head = completeLines(prefix);
    const requestMessages = prefix ? [
      ...messages,
      { role: 'assistant', content: head },
      { role: 'user', content: `Your previous answer was cut off. The last complete line was:\n${lastNonEmptyLine(head)}\nContinue with the line that comes right after it. Output only the remaining text: no code fence, no explanation, no repeated lines.` },
    ] : messages;
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: requestMessages, stream: true, stream_options: { include_usage: true }, reasoning_effort: kind === 'generate' ? GENERATE_REASONING_EFFORT : REVIEW_REASONING_EFFORT, max_tokens: maxTokens, temperature: 0.2 }),
      signal: AbortSignal.timeout(Number(process.env.MODEL_REQUEST_TIMEOUT_MS || 1200000)),
    });
    if (!response.ok) throw new Error(`Model API ${response.status}: ${(await response.text()).slice(0, 600)}`);
    if (!response.body) throw new Error('Model returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', finishReason = null, usage = null, completed = false, failure = null;
    const consume = (line) => {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { completed = true; return; }
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (choice?.delta?.content) content += choice.delta.content;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (json.usage) usage = json.usage;
      } catch { /* SSE keepalive or non-JSON event. */ }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) consume(line);
      }
      buffer += decoder.decode();
      if (buffer) consume(buffer);
      reader.releaseLock();
    } catch (error) { failure = error; }
    if (head && content) { prefix = joinContinuation(head, content); stitched = true; }
    else prefix += content;
    if (!prefix) {
      console.warn(`[${MODEL}] ${kind}: no content returned (${failure?.message || finishReason || 'incomplete response'}); retrying (${attempt + 1}/3).`);
      continue;
    }
    if (streamIsComplete(completed, finishReason, failure)) {
      const elapsed = (performance.now() - started) / 1000;
      const tokens = usage?.completion_tokens ?? 0;
      const tokensPerSecond = elapsed ? Math.round(tokens / elapsed * 10) / 10 : 0;
      const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? null;
      console.log(`[${MODEL}] ${kind}: ${tokens} completion tokens (${reasoning ?? 'unknown'} reasoning), ${tokensPerSecond} tokens/sec, ${elapsed.toFixed(1)}s`);
      return { text: prefix, stitched, usage: { prompt: usage?.prompt_tokens ?? 0, completion: tokens, total: usage?.total_tokens ?? 0, reasoning }, elapsed: Math.round(elapsed * 100) / 100, tokensPerSecond, model: MODEL, reasoningEffort: kind === 'generate' ? GENERATE_REASONING_EFFORT : REVIEW_REASONING_EFFORT };
    }
    const why = failure ? `stream error: ${failure.message}` : finishReason === 'length' ? `hit max_tokens ${maxTokens}` : 'stream ended without [DONE]';
    console.warn(`[${MODEL}] ${kind}: interrupted response (${why}), continuing ${prefix.length} characters (${attempt + 1}/3).`);
  }
  throw new Error('Model stream was interrupted three times. Please try again.');
}

// No CORS headers: the browser reaches /api through the Vite proxy (same origin), so other sites cannot spend the key.
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});
app.get('/api/health', (c) => c.json({ ok: true, configured: Boolean(API_KEY), model: MODEL, baseUrl: BASE_URL, generateReasoningEffort: GENERATE_REASONING_EFFORT, reviewReasoningEffort: REVIEW_REASONING_EFFORT }));

app.post('/api/generate', async (c) => {
  try {
    const { image } = await c.req.json(); checkRequest(image);
    const messages = [{ role: 'system', content: generatePrompt }, { role: 'user', content: [imagePart(image), { type: 'text', text: 'Read this floor plan and return the complete generator module.' }] }];
    let result = await completion(messages, 'generate', GENERATE_MAX_TOKENS);
    // A resumed stream that still does not parse would waste a whole review round; regenerate once instead.
    if (result.stitched && !moduleParses(result.text)) {
      console.warn(`[${MODEL}] generate: resumed module has a syntax error; regenerating once.`);
      result = await completion(messages, 'generate', GENERATE_MAX_TOKENS);
    }
    return c.json({ ...result, code: result.text });
  } catch (error) { console.error(error); return c.json({ error: error.message }, 500); }
});

app.post('/api/review', async (c) => {
  try {
    const body = await c.req.json(); checkRequest(body.sketch);
    if (typeof body.code !== 'string' || body.code.length > 200000) throw new Error('Missing or oversized generator code.');
    const checks = Array.isArray(body.failures) ? body.failures.slice(0, 40).map((x) => String(x).slice(0, 500)).join('\n') : 'No deterministic failures. The plan passed every check.';
    const content = [
      imagePart(body.sketch),
      { type: 'text', text: `DETERMINISTIC RESULTS:\n${checks}\n\nCURRENT GENERATOR:\n${body.code}\n\n${body.buildError ? `BUILD OR VALIDATION ERROR: ${String(body.buildError).slice(0, 1000)}` : 'The generator executed and validated. The following image is the top-down orthographic capture from the app canvas.'}` },
    ];
    if (typeof body.render === 'string' && body.render.startsWith('data:image/png')) content.push(imagePart(body.render));
    const result = await completion([{ role: 'system', content: reviewPrompt }, { role: 'user', content }], 'review', REVIEW_MAX_TOKENS);
    const candidates = recoverReviewResponses(result.text), selected = candidates.at(-1);
    if (!selected) return c.json({ ...result, error: 'The model returned malformed review JSON. Please try again.', malformedResponse: result.text, recoveredReviewCount: 0 }, 502);
    const review = selected.review;
    if (!['PASS', 'REVISE'].includes(review.verdict)) return c.json({ ...result, error: 'Review verdict must be PASS or REVISE.' }, 502);
    return c.json({ ...result, recoveredReviewCount: candidates.length, recoveredReviewOffset: selected.offset, verdict: review.verdict, issues: Array.isArray(review.issues) ? review.issues.map(String) : [], improvements: Array.isArray(review.improvements) ? review.improvements.map(String) : [], code: review.code || '' });
  } catch (error) { console.error(error); return c.json({ error: error.message }, 500); }
});

const port = Number(process.env.PORT || 8787);
// Localhost only by default: the API spends your Token Factory key and has no authentication.
const hostname = process.env.HOST || '127.0.0.1';
serve({ fetch: app.fetch, port, hostname }, (info) => console.log(`Sketch API listening on http://${hostname}:${info.port} using ${MODEL}`));
