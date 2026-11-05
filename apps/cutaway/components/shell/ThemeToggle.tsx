"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function useTheme(): ["light" | "dark", (t: "light" | "dark") => void] {
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const obs = new MutationObserver(() => setThemeState(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const setTheme = (t: "light" | "dark") => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("cutaway-theme", t);
    } catch {
      /* private mode */
    }
  };
  return [theme, setTheme];
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className={`btn btn-ghost ${compact ? "btn-sm btn-icon" : "btn-sm"}`} onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      {!compact && <span>{theme === "dark" ? "Light" : "Dark"} mode</span>}
    </button>
  );
}
