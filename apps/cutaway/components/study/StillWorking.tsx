"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { JobView } from "@/lib/jobs/runner";
import styles from "./study.module.css";

/** Shown while a machine is explorable but Kimi is still drawing diagrams and checking its work; refreshes the page when done. */
export function StillWorking({ id }: { id: number }) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        const j = ((await r.json()) as { job: JobView }).job;
        if (!alive) return;
        if (j.done) return router.refresh();
      } catch {
        /* try again */
      }
      timer = setTimeout(tick, document.hidden ? 15_000 : 5_000);
    };
    timer = setTimeout(tick, 5_000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, router]);
  return (
    <div className={styles.working} role="status">
      <LoaderCircle size={16} className="spin" aria-hidden="true" />
      <span>
        <b>Kimi is still drawing the diagrams and checking its work.</b>{" "}Explore away: this page updates by itself when it&apos;s done.
      </span>
      <Link href={`/new?id=${id}`}>See progress</Link>
    </div>
  );
}
