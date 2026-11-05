"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "codetrail-theme";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };

function apply(mode: Mode) {
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
}

/**
 * Runs before paint (inline in <head>) so a saved theme never flashes the other one. It also tells OpenUI not
 * to mount its development inspector, which would sit over the player controls (production never loads it).
 */
export const themeScript = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}globalThis[Symbol.for("openui.devtools.autoMount")]=true;`;

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setMode(saved);
    } catch {
      // Storage blocked: follow the system.
    }
  }, []);
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button
      onClick={() => {
        const next = NEXT[mode];
        setMode(next);
        apply(next);
        try {
          if (next === "system") localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch {
          // Not saved; the choice still applies for this visit.
        }
      }}
      aria-label={`Theme: ${mode}. Switch to ${NEXT[mode]}`}
      title={`Theme: ${mode}`}
      className="toon-sm toon-press grid size-9 shrink-0 place-items-center rounded-[10px] bg-panel text-fg-2 hover:text-fg"
    >
      <Icon className="size-4" />
    </button>
  );
}
