// Optional API access token (only when the server sets KUBETRACE_API_TOKEN). Held in memory
// for this page load only; never written to browser storage.
let apiToken = "";
export function setApiToken(value: string) { apiToken = value.trim(); }
function token(): string { return apiToken; }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init?.headers as any) } });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* not JSON */ }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export function eventsUrl(runId: string, after = 0) {
  const q = new URLSearchParams({ after: String(after) });
  if (token()) q.set("token", token());
  return `/api/runs/${runId}/events?${q}`;
}
