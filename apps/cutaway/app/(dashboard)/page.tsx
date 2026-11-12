import Link from "next/link";
import { BuildingNow } from "@/components/dashboard/BuildingNow";
import { ExampleLinks } from "@/components/dashboard/ExampleLinks";
import { StartCard } from "@/components/dashboard/StartCard";
import { TeardownCard } from "@/components/dashboard/TeardownCard";
import styles from "@/components/dashboard/dashboard.module.css";
import { listInProgress, listLibrary } from "@/lib/db/teardowns";

const HOW = [
  ["Show it", "A photo of any machine, or just its name."],
  ["Kimi designs it", "Kimi K3.1 Pro works out every part inside and builds each one in 3D. About half an hour; you can leave while it works."],
  ["Take it apart", "Pull it apart, slice it open, follow the steps, then test yourself."],
];

export default function Home() {
  const all = listLibrary();
  const unfinished = listInProgress();
  const featured = all.find((c) => c.has_thumb) ?? null;

  return (
    <div className={styles.sheet}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1>
            What&apos;s inside <mark className={styles.mark}>a machine?</mark>
          </h1>
          <p className={styles.lead}>Show Kimi any machine. It builds every part inside in 3D, so you can pull it apart, peek inside and find out how it works.</p>
          <StartCard />
          <ExampleLinks />
        </div>

        <div className={styles.heroSide}>
          {featured ? (
            <Link href={`/t/${featured.slug}`} className={styles.figure}>
              <span className={styles.figCap}>{featured.name}</span>
              <span className={styles.figCount}>{featured.part_count} parts</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/thumb/${featured.id}?v=${encodeURIComponent(featured.updated_at)}`} alt={`${featured.name}, pulled apart into its parts`} />
              <span className={styles.figOpen}>Open it →</span>
            </Link>
          ) : (
            <div className={styles.figure}>
              <span className={styles.figCap}>Your first machine</span>
              <span className={styles.figEmpty}>Your first machine appears here, pulled apart.</span>
            </div>
          )}
          <ol className={styles.how}>
            {HOW.map(([title, text], i) => (
              <li key={title}>
                <span className={styles.howNum}>{i + 1}</span>
                <b>{title}</b>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <BuildingNow saved={unfinished.map((u) => ({ id: u.id, name: u.name, status: u.status, error: u.error }))} />

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Your machines</h2>
          {all.length > 6 && <Link href="/library">See all {all.length} →</Link>}
        </div>
        {all.length ? (
          <div className={styles.grid}>
            {all.slice(0, 6).map((c) => (
              <TeardownCard key={c.slug} c={c} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>Nothing here yet. Your first machine will show up here.</p>
        )}
      </section>
    </div>
  );
}
