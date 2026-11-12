"use client";

// The hero's code terrain: a repo's real source, barely visible, with a headlamp beam that follows the
// cursor. Touch screens get a light that wanders on its own; reduced motion keeps it still.
import { useEffect, useRef } from "react";

const ROUTE = "M780 800 C 850 770, 860 650, 900 610 S 1000 440, 1060 390 S 1250 330, 1300 470 S 1260 660, 1170 710";
// Stops sit on the right half, clear of the headline and the input.
const STOPS = [
  [780, 800],
  [900, 610],
  [1060, 390],
  [1300, 470],
  [1170, 710],
] as const;

export function Headlamp({ terrain, waypoints, children }: { terrain: string[]; waypoints: { title: string; where: string }[]; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  // Three columns of source, repeated to fill the hero: the map is the repo itself.
  const rows: string[] = [];
  const n = terrain.length || 1;
  for (let r = 0; r < 60; r++) {
    const col = (k: number) => (terrain[(r + k) % n] ?? "").padEnd(64, " ").slice(0, 64);
    rows.push(col(0) + col(Math.floor(n / 3)) + (terrain[(r + Math.floor((2 * n) / 3)) % n] ?? ""));
  }
  const text = rows.join("\n");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (x: number, y: number) => {
      el.style.setProperty("--lamp-x", `${x}%`);
      el.style.setProperty("--lamp-y", `${y}%`);
    };
    set(62, 40);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(hover: none)").matches;
    let raf = 0;
    let lastMove = 0;
    const onMove = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      lastMove = performance.now();
      set(((e.clientX - box.left) / box.width) * 100, ((e.clientY - box.top) / box.height) * 100);
    };
    // A slow wander when nobody is pointing (touch screens, or the cursor is elsewhere).
    const wander = (t: number) => {
      if (t - lastMove > 2500) set(50 + Math.sin(t / 3100) * 24, 46 + Math.sin(t / 2300) * 18);
      raf = requestAnimationFrame(wander);
    };
    if (!reduce) {
      if (!touch) el.addEventListener("pointermove", onMove);
      raf = requestAnimationFrame(wander);
    }
    return () => {
      el.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={ref} className="relative overflow-hidden border-b border-line" style={{ ["--lamp-x" as string]: "62%", ["--lamp-y" as string]: "40%" }}>
      <pre aria-hidden className="pointer-events-none absolute -inset-5 m-0 overflow-hidden font-mono text-[13px] leading-[19px] whitespace-pre text-fg/[0.07] select-none">
        {text}
      </pre>
      <pre
        aria-hidden
        className="pointer-events-none absolute -inset-5 m-0 overflow-hidden font-mono text-[13px] leading-[19px] whitespace-pre text-trail/85 select-none"
        style={{
          maskImage: "radial-gradient(circle 240px at var(--lamp-x) var(--lamp-y), #000 0%, rgba(0,0,0,0.5) 45%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(circle 240px at var(--lamp-x) var(--lamp-y), #000 0%, rgba(0,0,0,0.5) 45%, transparent 75%)",
        }}
      >
        {text}
      </pre>

      <svg viewBox="0 0 1440 860" preserveAspectRatio="xMidYMid slice" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
        <g fill="none" stroke="var(--color-contour)" strokeWidth="1.2">
          <path d="M640 600 C 660 480, 820 440, 900 520 S 980 720, 860 760 S 620 720, 640 600 Z" />
          <path d="M690 610 C 710 520, 820 495, 870 550 S 930 700, 850 720 S 680 690, 690 610 Z" />
          <path d="M740 620 C 750 570, 820 555, 845 590 S 880 670, 830 680 S 735 665, 740 620 Z" />
          <path d="M960 250 C 1060 150, 1300 170, 1330 300 S 1220 470, 1080 440 S 880 350, 960 250 Z" />
          <path d="M1010 270 C 1090 205, 1260 220, 1280 305 S 1200 420, 1090 400 S 960 335, 1010 270 Z" />
          <path d="M1070 290 C 1120 255, 1215 265, 1225 310 S 1180 370, 1110 360 S 1035 325, 1070 290 Z" />
          <path d="M820 640 C 900 580, 1080 600, 1100 690 S 980 800, 880 780 S 760 700, 820 640 Z" />
          <path d="M880 660 C 930 625, 1040 640, 1050 695 S 970 760, 910 748 S 845 700, 880 660 Z" />
        </g>
        <path d={ROUTE} fill="none" stroke="var(--color-trail)" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 12" className="route-draw" />
        {STOPS.map(([x, y], i) => {
          const w = waypoints[i];
          if (!w) return null;
          const end = i === 0 || i === STOPS.length - 1;
          // Labels near the right edge read leftwards so they stay on screen.
          const left = x > 1150;
          return (
            <g key={i} transform={`translate(${x},${y})`}>
              <circle r="7" className="waypoint" style={{ fill: end ? "var(--color-trail)" : "var(--color-fg)", stroke: "var(--color-ink)", animationDelay: `${0.8 + i * 0.55}s` }} strokeWidth="3" />
              <text x={left ? -14 : 14} y="-10" textAnchor={left ? "end" : "start"} fontSize="11" letterSpacing="1.5" className="font-mono uppercase max-md:hidden" style={{ fill: "var(--color-fg)" }}>
                {w.title.length > 28 ? `${w.title.slice(0, 27)}…` : w.title}
              </text>
              <text x={left ? -14 : 14} y="5" textAnchor={left ? "end" : "start"} fontSize="10" className="font-mono max-md:hidden" style={{ fill: "var(--color-fg-3)" }}>
                {w.where}
              </text>
            </g>
          );
        })}
      </svg>
      {children}
    </section>
  );
}
