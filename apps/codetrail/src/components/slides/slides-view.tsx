"use client";

// The slides of a read: ← → (or Space) to move, F for full screen, the slide number kept in the link (#3). Each
// diagram is drawn once per theme and the page shows the one that matches.
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Rich } from "@/components/rich";
import type { Slide } from "@/server/trail/slides";

export function SlidesView({ slides, name, sha }: { slides: Slide[]; name: string; sha: string }) {
  const [i, setI] = useState(0);
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))), [slides.length]);

  // Open at the slide in the link, and keep the link on the slide shown.
  useEffect(() => {
    const n = Number(window.location.hash.slice(1));
    if (n >= 1) go(n - 1);
  }, [go]);
  useEffect(() => {
    window.history.replaceState(null, "", `#${i + 1}`);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !(e.target as HTMLElement).closest("button, a"))) {
        e.preventDefault();
        go(i + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(slides.length - 1);
      else if (e.key === "f" || e.key === "F") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, slides.length]);

  const s = slides[i];
  const button = "grid size-9 place-items-center rounded-[10px] border border-line text-fg-2 hover:border-outline hover:text-fg disabled:opacity-30";
  return (
    <main id="main" className="flex h-dvh flex-col bg-ink">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <a href={`/${name}`} className="inline-flex min-w-0 items-center gap-2 font-mono text-[12.5px] text-fg-2 hover:text-fg">
          <ArrowLeft className="size-3.5 shrink-0" /> <span className="truncate">{name} @{sha.slice(0, 7)}</span>
        </a>
        <div className="flex items-center gap-1.5">
          <a href={`/${name}/slides.html?sha=${sha}`} download className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-2.5 py-1.5 font-mono text-[11px] text-fg-2 hover:text-fg">
            <Download className="size-3.5" /> Download as HTML
          </a>
          <button onClick={() => void document.documentElement.requestFullscreen()} aria-label="Full screen (F)" title="Full screen (F)" className={button}>
            <Maximize2 className="size-4" />
          </button>
        </div>
      </header>

      <section aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}: ${s.title}`} className="flex min-h-0 flex-1 flex-col px-[6vw] py-[5vh]">
        <p className="font-mono text-[12px] tracking-[0.14em] text-trail uppercase">{s.kicker}</p>
        <h1 className="mt-3 font-display text-[clamp(28px,4vw,52px)] leading-[1.08] font-medium tracking-[-0.03em] [font-stretch:82%]">{s.title}</h1>
        <div className={`mt-6 flex min-h-0 flex-1 gap-[4vw] max-md:flex-col ${s.kind === "diagram" ? "justify-center" : ""}`}>
          {s.kind !== "diagram" && (
            <div className="min-w-0 flex-1 overflow-y-auto">
              {s.text && (s.kind === "end" ? <a href={s.text} className="text-[1.25rem] text-trail hover:underline">{s.text}</a> : <p className="text-[1.2rem] leading-relaxed text-fg-2">
                    <Rich text={s.text} />
                  </p>)}
              {s.bullets && s.bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-[1.05rem] leading-relaxed text-fg-2">
                  {s.bullets.map((b) => (
                    <li key={b}>
                      <Rich text={b} />
                    </li>
                  ))}
                </ul>
              )}
              {s.files && s.files.length > 0 && (
                <p className="mt-5 flex flex-wrap gap-1.5">
                  {s.files.map((f) => (
                    <code key={f} className="rounded bg-raised-2 px-1.5 py-0.5 font-mono text-[12.5px] text-fg">
                      {f}
                    </code>
                  ))}
                </p>
              )}
            </div>
          )}
          {s.image && (
            <div className="flex min-h-0 min-w-0 flex-[1.4] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image.dark} alt={s.image.alt} className="theme-dark-img h-full w-full rounded-[12px] object-contain" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image.light} alt={s.image.alt} className="theme-light-img h-full w-full rounded-[12px] object-contain" />
            </div>
          )}
        </div>
      </section>

      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-line px-4 py-2.5">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label={i > 0 ? `Previous slide: ${slides[i - 1].title} (←)` : "Previous slide (←)"} className={button}>
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-20 text-center font-mono text-[12px] text-fg-3" aria-live="polite">
          {i + 1} / {slides.length}
        </span>
        <button onClick={() => go(i + 1)} disabled={i === slides.length - 1} aria-label={i < slides.length - 1 ? `Next slide: ${slides[i + 1].title} (→)` : "Next slide (→)"} className={button}>
          <ChevronRight className="size-4" />
        </button>
      </footer>
    </main>
  );
}
