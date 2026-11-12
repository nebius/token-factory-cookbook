import { notFound } from "next/navigation";
import { StudyView } from "@/components/study/StudyView";
import { getBySlug, getDiagrams, getInput, getParts, getThumbnail, listVersions } from "@/lib/db/teardowns";
import { getNotes, getProgress, isBookmarked } from "@/lib/db/user";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string; from?: string }> };

export async function generateMetadata({ params }: Props) {
  const t = getBySlug((await params).slug);
  return { title: t?.name ?? "Teardown" };
}

export default async function TeardownPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = getBySlug(slug, sp.v ? Number(sp.v) : undefined);
  // A machine opens as soon as its parts are built; diagrams and the self-review can still be on the way.
  const working = !!t && (t.status === "designed" || t.status === "reviewing");
  if (!t || !t.meta || (t.status !== "ready" && !working)) notFound();
  const parts = getParts(t.id);
  if (working && !parts.length) notFound();
  const input = getInput(t.id);
  return (
    <StudyView
      teardown={{
        id: t.id,
        slug: t.slug,
        version: t.version,
        provider: t.provider,
        model: t.model,
        createdAt: t.created_at,
        hasPhoto: !!input?.image,
        hasThumb: !!getThumbnail(t.id),
      }}
      meta={t.meta}
      parts={parts.map((p) => ({ id: p.part_id, code: p.code }))}
      working={working}
      diagrams={getDiagrams(t.id)}
      versions={listVersions(t.slug).filter((v) => v.status === "ready")}
      notes={getNotes(t.slug)}
      progress={getProgress(t.slug)}
      bookmarked={isBookmarked(t.slug)}
      fromLibrary={sp.from === "library"}
    />
  );
}
