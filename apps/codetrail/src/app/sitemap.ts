// The landing page, the guide, the browse and data pages, and every repo read on this instance with its slides (public ones only).
import type { MetadataRoute } from "next";
import { env } from "@/env";
import { getRecent, newestPerRepo } from "@/server/trail/service";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const recent = await getRecent().catch(() => []);
  return [
    { url: env.SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${env.SITE_URL}/guide`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${env.SITE_URL}/browse`, changeFrequency: "daily", priority: 0.6 },
    { url: `${env.SITE_URL}/data`, changeFrequency: "daily", priority: 0.5 },
    ...newestPerRepo(recent).filter((r) => !r.private).map((r) => ({ url: `${env.SITE_URL}/${r.owner}/${r.repo}`, lastModified: new Date(r.at), changeFrequency: "weekly" as const, priority: 0.8 })),
    ...recent.filter((r) => !r.private && !r.scope).map((r) => ({ url: `${env.SITE_URL}/${r.owner}/${r.repo}/slides`, lastModified: new Date(r.at), changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
