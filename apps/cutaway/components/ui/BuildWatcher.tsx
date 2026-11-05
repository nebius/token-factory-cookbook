"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { JobView } from "@/lib/jobs/runner";
import styles from "./watcher.module.css";

export const JOB_STARTED = "cutaway:job-started";

/**
 * Follows server-side builds from any page: a small indicator while something is building and a toast
 * when it's ready or needs you. Polls only while there is something to follow.
 */
export function BuildWatcher() {
  const router = useRouter();
  const path = usePathname();
  const [jobs, setJobs] = useState<JobView[]>([]);
  const seen = useRef(new Map<number, { running: boolean; waiting: boolean }>());
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      let list: JobView[] = [];
      try {
        const r = await fetch("/api/jobs", { cache: "no-store" });
        list = ((await r.json()) as { jobs: JobView[] }).jobs ?? [];
      } catch {
        /* offline for a moment */
      }
      if (!alive) return;
      for (const j of list) {
        const before = seen.current.get(j.id);
        if (!first.current && before) {
          const name = j.name ?? "Your machine";
          if (before.running && !j.running && j.done && !j.done.existing) {
            toast.success(`${name} is ready to explore`, { action: { label: "Open", onClick: () => router.push(`/t/${j.done!.slug}`) }, duration: 10_000 });
          } else if (before.running && !j.running && j.error && !/^Stopped/.test(j.error)) {
            toast.error(`${name} stopped`, { description: "Open it to see why and try again.", action: { label: "Open", onClick: () => router.push(`/new?id=${j.id}`) }, duration: 10_000 });
          } else if (!before.waiting && j.waiting) {
            toast(`Kimi has a question about ${name}`, { action: { label: "Answer", onClick: () => router.push(`/new?id=${j.id}`) }, duration: 15_000 });
          }
        }
        seen.current.set(j.id, { running: j.running, waiting: !!j.waiting });
      }
      first.current = false;
      setJobs(list);
      const busy = list.some((j) => j.running || j.waiting);
      timer = setTimeout(tick, busy ? (document.hidden ? 6000 : 2500) : 20_000);
    };
    void tick();
    const kick = () => void tick();
    window.addEventListener(JOB_STARTED, kick);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener(JOB_STARTED, kick);
    };
  }, [router]);

  const watchingId = path === "/new" && typeof window !== "undefined" ? Number(new URLSearchParams(window.location.search).get("id")) : null;
  const active = jobs.filter((j) => (j.running || j.waiting) && j.id !== watchingId);
  if (!active.length) return null;

  return (
    <div className={styles.dock} role="status" aria-live="polite">
      {active.slice(0, 3).map((j) => (
        <Link key={j.id} href={`/new?id=${j.id}`} className={styles.item}>
          <span className={styles.dot} data-waiting={!!j.waiting} />
          <span className={styles.text}>
            <b>{j.name ?? "Your machine"}</b>
            <span>{j.waiting ? "Kimi has a question" : `Building · ${Math.round(j.progress * 100)}%`}</span>
          </span>
          <span className={styles.bar}>
            <span style={{ width: `${Math.max(4, j.progress * 100)}%` }} />
          </span>
        </Link>
      ))}
    </div>
  );
}
