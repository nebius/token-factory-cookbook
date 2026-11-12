// /llms.txt: what this Codetrail has read, each with its Markdown page, for AI tools.
import { env } from "@/env";
import { llmsTxt } from "@/server/trail/markdown";
import { listReads } from "@/server/trail/service";

export async function GET() {
  return new Response(llmsTxt(await listReads(), env.SITE_URL), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=600" } });
}
