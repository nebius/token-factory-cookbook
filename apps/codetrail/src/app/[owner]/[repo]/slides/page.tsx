import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SlidesView } from "@/components/slides/slides-view";
import { loadSlides } from "./load";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  const title = `${owner}/${repo} slides: architecture, modules and main flow`;
  const description = `The architecture diagram, every module and the main code tour of ${owner}/${repo}, as slides to present or download.`;
  const image = `/${owner}/${repo}/diagram.png`;
  return {
    title,
    description,
    alternates: { canonical: `/${owner}/${repo}/slides` },
    openGraph: { title, description, url: `/${owner}/${repo}/slides`, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SlidesPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ sha?: string }> }) {
  const { owner, repo } = await params;
  const data = await loadSlides(owner, repo, (await searchParams).sha);
  if (!data) notFound();
  return <SlidesView slides={data.slides} name={data.name} sha={data.sha} />;
}
