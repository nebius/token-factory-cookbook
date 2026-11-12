import Link from "next/link";
import { TeardownCard } from "@/components/dashboard/TeardownCard";
import styles from "@/components/dashboard/dashboard.module.css";
import { listLibrary } from "@/lib/db/teardowns";

export const metadata = { title: "Saved" };

export default function BookmarksPage() {
  const items = listLibrary({ bookmarked: true, sort: "studied" });
  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h1>Saved</h1>
        <p>Machines you saved to come back to.</p>
      </div>
      {items.length ? (
        <div className={styles.grid}>
          {items.map((c) => (
            <TeardownCard key={c.slug} c={c} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <p>Nothing saved yet. Press Save on any machine to keep it here.</p>
          <Link href="/library" className="btn btn-primary">
            Browse my machines →
          </Link>
        </div>
      )}
    </div>
  );
}
