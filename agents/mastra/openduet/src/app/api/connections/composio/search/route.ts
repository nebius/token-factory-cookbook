import { handle } from "@/lib/server/http";
import { listApps } from "@/lib/server/composio";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return handle(async () => ({ apps: q ? await listApps(q) : [] }));
}
