import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { BrowseList } from "@/components/browse/browse-list";
import { env } from "@/env";
import { listReads } from "@/server/trail/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Browse",
  description: "Every repo read on this Codetrail instance: architecture, tours and docs, free to open.",
  alternates: { canonical: "/browse" },
};

export default async function BrowsePage() {
  // Private repos and local folders only show where nobody else can see them (self-hosted, no sign-in).
  const reads = (await listReads().catch(() => [])).filter((r) => env.AUTH_MODE === "none" || !r.private);
  // One row per repo: its latest read.
  const latest = [...new Map([...reads].reverse().map((r) => [`${r.owner}/${r.repo}~${r.scope ?? ""}`.toLowerCase(), r])).values()].reverse();
  return (
    <div className="min-h-dvh bg-ink text-fg">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1240px] px-4 pt-10 pb-20 sm:px-6">
        <h1 className="font-display text-[40px] leading-none font-light tracking-[-0.05em] [font-stretch:78%] sm:text-[56px]">
          Browse <span className="font-extrabold text-trail [font-stretch:110%]">repos.</span>
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-fg-2">Every repo read on this Codetrail. Opening one is free: its architecture, tours, docs and answers are already stored.</p>
        <BrowseList reads={latest} />
      </main>
    </div>
  );
}
