import type { APIRoute } from "astro";

const backendUrl = import.meta.env.BACKEND_URL ?? "http://127.0.0.1:18765";

function targetUrl(request: Request, path?: string) {
  const source = new URL(request.url);
  const target = new URL(`${backendUrl.replace(/\/$/, "")}/${path ?? ""}`);
  target.search = source.search;
  return target;
}

async function proxy({ request, params }: Parameters<APIRoute>[0]) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const response = await fetch(targetUrl(request, params.path), {
    method,
    headers,
    body,
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const GET: APIRoute = proxy;
export const POST: APIRoute = proxy;
export const PUT: APIRoute = proxy;
export const PATCH: APIRoute = proxy;
export const DELETE: APIRoute = proxy;
