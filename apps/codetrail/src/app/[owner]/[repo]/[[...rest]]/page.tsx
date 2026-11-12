// /owner/repo, /owner/repo/tree/<ref>/…, /owner/repo/blob/<ref>/…, /owner/repo/pull/<n> — the same paths as
// github.com, so swapping the domain in a GitHub URL opens the trail.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrailApp } from "@/components/trail/trail-app";
import { env } from "@/env";
import { normalScope, scopeString } from "@/lib/scope";
import { parseRepoInput } from "@/lib/ref";
import { storedPull } from "@/server/trail/pulls";
import { storedOverview } from "@/server/trail/service";

type Params = { owner: string; repo: string; rest?: string[] };

export async function generateMetadata({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ tour?: string }> }): Promise<Metadata> {
  const { owner, repo, rest } = await params;
  const { tour } = await searchParams;
  const pull = parseRepoInput([owner, repo, ...(rest ?? [])].map(decodeURIComponent).join("/"))?.pull;
  if (pull) {
    const stored = await storedPull(owner, repo, pull).catch(() => null);
    const title = stored ? `PR #${pull}: ${stored.title} · ${owner}/${repo}` : `PR #${pull} in ${owner}/${repo}, explained`;
    const description = `A guided tour through pull request #${pull} in ${owner}/${repo}: what it changes, in the order it runs, with notes for the reviewer tied to the lines they're about.`;
    const image = `/${owner}/${repo}/trail-card${stored ? `?tour=${stored.id}` : ""}`;
    const url = `/${owner}/${repo}/pull/${pull}`;
    return {
      title,
      description,
      alternates: { canonical: url },
      openGraph: { title, description, url, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  }
  const overview = await storedOverview(owner, repo).catch(() => null);
  // A tour link previews as its share card; the repo itself as its architecture diagram.
  const image = tour && /^[0-9a-f]{12}$/.test(tour) ? `/${owner}/${repo}/trail-card?tour=${tour}` : overview ? `/${owner}/${repo}/diagram.png` : `/${owner}/${repo}/trail-card`;
  const title = `${owner}/${repo}: architecture diagram, wiki and code tours`;
  const description = overview
    ? `${overview.summary.slice(0, 150).replace(/\s+\S*$/, "")}… Architecture diagram, wiki docs, code tours and Q&A.`
    : `How ${owner}/${repo} works: architecture diagram, wiki docs, code tours and Q&A, read whole in one prompt.`;
  return {
    title,
    description,
    alternates: { canonical: `/${owner}/${repo}` },
    openGraph: { title, description, url: `/${owner}/${repo}`, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function TrailPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ only?: string; skip?: string }> }) {
  const { owner, repo, rest } = await params;
  const { only, skip } = await searchParams;
  // ?only=src,lib&skip=docs: a read of just those folders.
  const scope = scopeString(normalScope({ only: only?.split(",") ?? [], skip: skip?.split(",") ?? [] }));
  const parsed = parseRepoInput([owner, repo, ...(rest ?? [])].map(decodeURIComponent).join("/"));
  if (!parsed) notFound();
  const overview = await storedOverview(parsed.owner, parsed.repo).catch(() => null);
  // Structured data for search engines: what this page explains, from the stored map (no GitHub call).
  const jsonLd = overview && {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `How ${parsed.owner}/${parsed.repo} works`,
    description: overview.summary,
    about: { "@type": "SoftwareSourceCode", name: `${parsed.owner}/${parsed.repo}`, codeRepository: `https://github.com/${parsed.owner}/${parsed.repo}` },
    articleSection: overview.modules,
    keywords: overview.tours.join(", "),
  };
  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <TrailApp owner={parsed.owner} repo={parsed.repo} gitRef={parsed.ref} initialFile={parsed.path} pull={parsed.pull} siteUrl={env.SITE_URL} scope={scope} />
    </>
  );
}
