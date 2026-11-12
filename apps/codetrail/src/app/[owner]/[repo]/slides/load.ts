// The slides of a repo's latest read, for the page and the HTML download. Stored data only: never starts a read.
import { env } from "@/env";
import { LOCAL_OWNER } from "@/lib/ref";
import { buildSlides } from "@/server/trail/slides";
import { latestReadSha, prepare } from "@/server/trail/service";

/** `at`: a commit read on this instance (?sha=); the latest read otherwise. */
export async function loadSlides(owner: string, repo: string, at?: string) {
  const sha = at && /^[0-9a-f]{40}$/.test(at) ? at : await latestReadSha(owner, repo);
  if (!sha || (owner === LOCAL_OWNER && env.AUTH_MODE !== "none")) return null;
  const p = await prepare({ owner, repo, ref: sha }).catch(() => null);
  if (!p || (p.info.private && env.AUTH_MODE !== "none")) return null;
  const page = `${env.SITE_URL.replace(/\/$/, "")}/${p.info.owner}/${p.info.repo}`;
  const slides = await buildSlides(p, page);
  return slides && { slides, name: `${p.info.owner}/${p.info.repo}`, sha: p.info.sha };
}
