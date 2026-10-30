// Follow the system (the default), or always light or dark. layout.tsx applies the saved
// choice before first paint; this changes it and follows system switches.
export type ThemePreference = "light" | "dark" | "system";

const KEY = "openduet:theme";

export function themePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "dark" || saved === "light" ? saved : "system";
  } catch {
    return "system";
  }
}

function resolve(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePreference = themePreference()) {
  document.documentElement.setAttribute("data-theme", resolve(pref));
}

export function setThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // storage may be unavailable; the choice still applies until reload
  }
  applyTheme(pref);
}

/** Re-apply when the system theme changes, for "system". Returns an unsubscribe. */
export function followSystemTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => themePreference() === "system" && applyTheme("system");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
