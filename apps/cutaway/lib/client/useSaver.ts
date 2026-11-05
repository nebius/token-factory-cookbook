"use client";

import { useEffect, useRef } from "react";

/** Debounced fire-and-forget PUT to /api/study. Flushes on unmount. */
export function useStudySaver(slug: string, delay = 600) {
  const pending = useRef(new Map<string, unknown>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (const body of pending.current.values()) {
      void fetch("/api/study", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    }
    pending.current.clear();
  };

  useEffect(() => flush, []);

  return {
    save(key: string, body: Record<string, unknown>, immediate = false) {
      pending.current.set(key, { slug, ...body });
      if (immediate) return flush();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    flush,
  };
}
