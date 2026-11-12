// /owner/repo.md (rewritten here): the latest read of a repo as one Markdown page, for AI tools. Free, stored data only.
import { env } from "@/env";
import { LOCAL_OWNER } from "@/lib/ref";
import { repoMarkdown } from "@/server/trail/markdown";
import { latestReadSha, prepare, withActuals, getLedger } from "@/server/trail/service";

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const sha = await latestReadSha(owner, repo);
  const notFound = () => new Response(`# ${owner}/${repo}\n\nNot read on this Codetrail yet. Open ${env.SITE_URL}/${owner}/${repo} to read it.\n`, { status: 404, headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (!sha) return notFound();
  // A local folder or private repo stays on this instance: no public page, unless sign-in is off (self-hosted).
  if (owner === LOCAL_OWNER && env.AUTH_MODE !== "none") return notFound();
  const p = await prepare({ owner, repo, ref: sha }).catch(() => null);
  if (p?.info.private && env.AUTH_MODE !== "none") return notFound();
  const summary = p ? withActuals(p.summary, await getLedger(p.info)) : undefined;
  const md = await repoMarkdown({ owner: p?.info.owner ?? owner, repo: p?.info.repo ?? repo, sha }, env.SITE_URL, summary);
  if (!md) return notFound();
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=600" } });
}
