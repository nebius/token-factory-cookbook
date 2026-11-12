// /owner/repo/diagram.svg: the architecture of a repo's latest read as an image for its README, like GitDiagram's.
// Laid out on the server with the same engine as the app; light by default, ?theme=dark for dark pages. Free.
import { env } from "@/env";
import { architectureSpec, diagramSvg, layoutDiagram } from "@/lib/diagram";
import { LOCAL_OWNER } from "@/lib/ref";
import type { Atlas } from "@/lib/schemas";
import type { RepoInfo } from "@/server/repo/github";
import { getJSON } from "@/server/store";
import { latestReadSha, storeKey } from "@/server/trail/service";

const svg = (body: string, status = 200, maxAge = 3600) => new Response(body, { status, headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": `public, max-age=${maxAge}` } });

export async function GET(req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const theme = new URL(req.url).searchParams.get("theme") === "dark" ? "dark" : "light";
  const sha = owner === LOCAL_OWNER ? undefined : await latestReadSha(owner, repo);
  const commit = sha ? storeKey(owner, repo, sha) : null;
  const [atlas, info] = commit ? await Promise.all([getJSON<Atlas>(`${commit}/atlas.json`), getJSON<RepoInfo>(`${commit}/info.json`)]) : [null, null];
  if (!atlas || (info?.private && env.AUTH_MODE !== "none")) {
    const text = `${owner}/${repo} hasn't been read on Codetrail yet`;
    return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="60"><rect width="100%" height="100%" rx="8" fill="${theme === "dark" ? "#121418" : "#f6f3ec"}"/><text x="20" y="35" font-family="ui-monospace, monospace" font-size="13" fill="${theme === "dark" ? "#8b8f98" : "#6b6e76"}">${text.replace(/[<&]/g, "")}</text></svg>`, 404, 60);
  }
  const layout = await layoutDiagram(architectureSpec(atlas));
  return svg(diagramSvg(layout, theme, `${owner}/${repo} @ ${sha!.slice(0, 7)} · architecture by Codetrail`));
}
