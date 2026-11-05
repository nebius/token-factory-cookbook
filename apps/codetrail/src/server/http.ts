// Shared bits for the API routes: client IP, request parsing and error → status mapping.
import { NextResponse } from "next/server";
import { z } from "zod";
import { AIError } from "@/server/ai/nebius";
import { RepoError } from "@/server/repo/github";
import { LimitError } from "@/server/trail/service";
import { AuthRequiredError, QuotaError } from "@/server/quota";
import { viewerOf } from "@/server/auth";
import { asRun, CancelledError } from "@/server/cancel";

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

export const repoAt = z.object({
  owner: z.string().regex(/^[\w.-]+$/),
  repo: z.string().regex(/^[\w.-]+$/),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  /** A read of only some folders (src/lib/scope.ts), stored apart from the full read. */
  scope: z
    .string()
    .max(800)
    .regex(/^[\w./*,;=@ -]*$/)
    .optional(),
});

/** The repo, commit and folders a request is about, for `prepare`. */
export const refOf = (at: { owner: string; repo: string; sha: string; scope?: string }) => ({ owner: at.owner, repo: at.repo, ref: at.sha, scope: at.scope || undefined });

/** A follow-up names its conversation, or the stored answer or tour that starts one. */
export const threadStart = z.object({
  thread: z.string().regex(/^[0-9a-f]{12}$/).optional(),
  root: z.object({ kind: z.enum(["answer", "tour"]), id: z.string().regex(/^[0-9a-f]{12}$/) }).optional(),
});

export function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (error instanceof RepoError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof LimitError) return NextResponse.json({ error: error.message }, { status: 429 });
  if (error instanceof AuthRequiredError) return NextResponse.json({ error: error.message, code: "auth_required" }, { status: 401 });
  if (error instanceof QuotaError) return NextResponse.json({ error: error.message, code: "quota" }, { status: 429 });
  if (error instanceof CancelledError) return NextResponse.json({ error: "Stopped.", code: "cancelled" }, { status: 499 });
  if (error instanceof AIError) return NextResponse.json({ error: error.message }, { status: error.kind === "config" ? 500 : 502 });
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** Who is asking for new model work: a signed-in account, or an anonymous visitor by IP. */
export async function callerOf(req: Request): Promise<string> {
  const viewer = await viewerOf(req.headers);
  return viewer ? `user:${viewer.id}` : `anon:${clientIp(req)}`;
}

type Send = (event: Record<string, unknown>) => void;

/**
 * A server-sent event stream around `run`. Errors become an "error" event. If the visitor leaves, nothing more is
 * sent but the work carries on: a model call already paid for still finishes and is stored for the next visit.
 * Only an explicit Stop for `runId` (POST /api/cancel) stops it.
 */
export function sse(run: (send: Send) => Promise<void>, runId?: string): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const send: Send = (event) => write(`data: ${JSON.stringify(event)}\n\n`);
      // Keeps proxies from closing a quiet connection while the model thinks.
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      try {
        await asRun(runId, () => run(send));
      } catch (error) {
        const data = (await errorResponse(error)
          .json()
          .catch(() => ({}))) as { error?: string; code?: string };
        send({ type: "error", error: data.error ?? "Something went wrong.", code: data.code });
      } finally {
        clearInterval(heartbeat);
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
