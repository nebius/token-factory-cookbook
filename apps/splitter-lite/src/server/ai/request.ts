import "server-only";
import { env, features } from "@/env";
import type { NebiusConfig } from "./nebius";
import { sniffImageType } from "@/lib/image-sniff";

export { sniffImageType };

const MAX_BYTES = 4 * 1024 * 1024; // per request; Vercel's body limit is 4.5 MB.
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const apiError = (status: number, message: string, extra?: Record<string, unknown>) =>
  Response.json({ error: message, ...extra }, { status });

export const aiConfig = (): NebiusConfig => ({
  apiKey: env.NEBIUS_API_KEY!,
  baseURL: env.NEBIUS_BASE_URL,
  model: env.NEBIUS_MODEL,
});

// A small in-memory limit per visitor, so a shared demo can't be hammered. No accounts, no credits.
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

export function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** True if this visitor may make another AI request now (and records it). */
export function allowRequest(key: string, limit = env.AI_REQUESTS_PER_10_MIN, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Shared gate for every AI endpoint: an API key must be configured, and the visitor must be under the limit. */
export function aiGuard(request: Request): { ok: true } | { ok: false; response: Response } {
  if (!features.scanning) {
    return { ok: false, response: apiError(503, "AI is not configured. Set NEBIUS_API_KEY in .env, then restart the server.") };
  }
  if (!allowRequest(clientKey(request))) {
    return { ok: false, response: apiError(429, "Too many AI requests. Wait a few minutes and try again.") };
  }
  return { ok: true };
}

/** Reads `image` fields from multipart form data and returns base64 data URLs. */
export async function readImages(
  request: Request,
  max: number,
): Promise<{ ok: true; dataUrls: string[]; form: FormData } | { ok: false; response: Response }> {
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("image") ?? []).filter((f): f is File => f instanceof File);
  if (!form || files.length === 0) return { ok: false, response: apiError(400, "Attach an image") };
  if (files.length > max) return { ok: false, response: apiError(400, `At most ${max} images at a time`) };
  let total = 0;
  for (const f of files) {
    if (!TYPES.has(f.type)) return { ok: false, response: apiError(415, "Use JPEG, PNG or WebP images") };
    if (f.size === 0) return { ok: false, response: apiError(400, "An image is empty") };
    total += f.size;
  }
  if (total > MAX_BYTES) return { ok: false, response: apiError(413, "The images are too large (4 MB max in total).") };
  const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  // Check the real file signature, not just the declared type, so renamed files are rejected.
  if (buffers.some((b, i) => sniffImageType(b) !== files[i].type)) {
    return { ok: false, response: apiError(415, "That file isn't a real JPEG, PNG or WebP image") };
  }
  const dataUrls = buffers.map((b, i) => `data:${files[i].type};base64,${b.toString("base64")}`);
  return { ok: true, dataUrls, form };
}
