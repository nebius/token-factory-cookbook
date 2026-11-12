import { KimiError } from "@/lib/kimi/client";
import { updateTeardown } from "@/lib/db/teardowns";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Map an error to a JSON response; model failures are also saved on the teardown so the UI can offer a retry. */
export function fail(e: unknown, teardownId?: number): Response {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof KimiError ? (e.kind === "config" ? 400 : 502) : 500;
  if (teardownId && !(e instanceof KimiError && e.kind === "config")) {
    try {
      updateTeardown(teardownId, { status: "failed", error: message });
    } catch {
      /* the teardown may not exist */
    }
  }
  if (status === 500) console.error(e);
  return json({ error: message }, status);
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new KimiError("request body must be JSON", "config");
  }
}

export function idParam(v: string | number | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new KimiError("bad teardown id", "config");
  return n;
}
