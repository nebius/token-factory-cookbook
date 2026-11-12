"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { JobView } from "@/lib/jobs/runner";
import styles from "./dashboard.module.css";

type Saved = { id: number; name: string | null; status: string; error: string | null };

/** Machines that are building now (live) or stopped part-way (saved), with a way back to each. */
export function BuildingNow({ saved }: { saved: Saved[] }) {
  const [live, setLive] = useState<JobView[]>([]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch("/api/jobs", { cache: "no-store" });
        const j = ((await r.json()) as { jobs: JobView[] }).jobs ?? [];
        if (alive) setLive(j);
        timer = setTimeout(tick, j.some((x) => x.running) ? 2000 : 15_000);
      } catch {
        timer = setTimeout(tick, 15_000);
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const byId = new Map(live.map((j) => [j.id, j]));
  const rows = saved
    .map((s) => ({ s, j: byId.get(s.id) }))
    .filter(({ j }) => !j?.done);
  if (!rows.length) return null;
  const anyRunning = rows.some(({ j }) => j?.running);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{anyRunning ? "Building now" : "Not finished"}</h2>
        <span className={styles.sectionNote}>{anyRunning ? "These keep going even if you leave." : "Finished steps are saved, so trying again carries on from there."}</span>
      </div>
      <ul className={styles.rows}>
        {rows.map(({ s, j }) => {
          const running = !!j?.running;
          const failed = !running && (j?.error || s.status === "failed");
          const label = j?.waiting ? "Kimi has a question" : running ? `Building · ${Math.round((j?.progress ?? 0) * 100)}%` : failed ? "Stopped part-way" : "Paused";
          return (
            <li key={s.id}>
              <Link href={`/new?id=${s.id}`} className={styles.row}>
                <span className={styles.rowName}>{j?.name ?? s.name ?? "Your photo"}</span>
                <span className={styles.rowStatus} data-failed={!!failed}>
                  {label}
                </span>
                <span className={styles.rowBar} data-empty={!running}>
                  {running && <span style={{ width: `${Math.max(3, (j?.progress ?? 0) * 100)}%` }} data-running />}
                </span>
                <span className={styles.rowGo}>
                  {failed ? "Try again" : "View"} <ArrowRight size={15} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
