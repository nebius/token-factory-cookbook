import { InputError, boot } from "./service";

/** Run a route body after boot; input mistakes become 400s with a readable message. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    await boot();
    const result = await fn();
    if (result instanceof Response) return result;
    return Response.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[openduet]", error);
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new InputError("Expected a JSON body.");
  }
}

export const conversationParam = (raw: string) => decodeURIComponent(raw);
