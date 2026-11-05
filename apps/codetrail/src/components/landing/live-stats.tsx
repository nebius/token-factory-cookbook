"use client";

// Site-wide totals with DeepSeek as the subject, counting up when they change.
import { useEffect, useRef, useState } from "react";
import { formatTokens, formatUsd } from "@/lib/format";
import type { SiteTotals } from "@/server/stats";

function useCountUp(target: number, ms = 1200) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(a + (target - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function Stat({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  const v = useCountUp(value);
  return (
    <div className="border-line py-6 pl-5 sm:border-r">
      <div className="font-mono text-[10.5px] tracking-[0.2em] text-fg-3 uppercase">{label}</div>
      <div className="mt-2 font-display text-[32px] font-medium tracking-tight [font-stretch:80%]">{format(v)}</div>
    </div>
  );
}

export function LiveStats({ initial }: { initial: SiteTotals | null }) {
  const [totals, setTotals] = useState(initial);
  useEffect(() => {
    const load = () =>
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((t) => t && setTotals(t))
        .catch(() => {});
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);
  const t = totals ?? { reads: 0, tours: 0, calls: 0, replays: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, savedUsd: 0, byModel: [] };
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <p className="pt-6 font-mono text-[11px] tracking-[0.2em] text-trail uppercase">{t.byModel.map((m) => m.label).join(" + ") || "Open models"} on Codetrail, live</p>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Stat label="Repos read whole" value={t.reads} format={(n) => Math.round(n).toLocaleString()} />
          <Stat label="Tours traced" value={t.tours} format={(n) => Math.round(n).toLocaleString()} />
          <Stat label="Tokens read" value={t.inputTokens} format={(n) => formatTokens(Math.round(n))} />
          <Stat label="Saved with cached input" value={t.savedUsd} format={(n) => formatUsd(n)} />
        </div>
      </div>
    </section>
  );
}
