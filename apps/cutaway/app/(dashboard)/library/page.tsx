import { Suspense } from "react";
import { LibraryFilters } from "@/components/dashboard/LibraryFilters";
import { TeardownCard } from "@/components/dashboard/TeardownCard";
import styles from "@/components/dashboard/dashboard.module.css";
import { listLibrary } from "@/lib/db/teardowns";
import { categoryLabel } from "@/lib/schema/teardown";

export const metadata = { title: "Machines" };

type Sort = "recent" | "name" | "parts" | "studied";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; sort?: string }> }) {
  const sp = await searchParams;
  const items = listLibrary({ q: sp.q, category: sp.category, sort: (sp.sort as Sort) ?? "recent" });
  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h1>{sp.category ? categoryLabel(sp.category) : "Machines"}</h1>
        <p>Everything you have looked inside.</p>
      </div>
      <Suspense>
        <LibraryFilters />
      </Suspense>
      {items.length ? (
        <div className={styles.grid}>
          {items.map((c) => (
            <TeardownCard key={c.slug} c={c} />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>Nothing matches. Try another word.</p>
      )}
    </div>
  );
}
