import Link from "next/link";
import { CategoryIcon } from "@/components/shell/categoryIcon";
import { isTestData } from "@/lib/provenance";
import { categoryLabel } from "@/lib/schema/teardown";
import { type LibraryCard } from "@/lib/db/teardowns";
import styles from "./dashboard.module.css";

/** A machine as a numbered entry in the manual: black figure, name, parts found. */
export function TeardownCard({ c }: { c: LibraryCard }) {
  const found = Math.min(c.parts_opened, c.part_count);
  return (
    <Link href={`/t/${c.slug}`} className={styles.tcard}>
      <div className={styles.thumb}>
        {c.has_thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/thumb/${c.id}?v=${encodeURIComponent(c.updated_at)}`} alt="" loading="lazy" />
        ) : (
          <div className={styles.thumbEmpty}>
            <CategoryIcon category={c.category} size={36} />
          </div>
        )}
      </div>
      <div className={styles.tbody}>
        <div className={styles.tcat}>
          No. {String(c.id).padStart(3, "0")} · {categoryLabel(c.category)}
          {isTestData(c.provider) && " · sample"}
          {!!c.bookmarked && " · saved"}
        </div>
        <div className={styles.tname}>{c.name}</div>
        <div className={styles.tmeta}>
          <span className={styles.tbar}>
            <span style={{ width: `${(found / Math.max(1, c.part_count)) * 100}%` }} />
          </span>
          {found} of {c.part_count} parts found
        </div>
      </div>
    </Link>
  );
}
