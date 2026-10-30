import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-[oklch(0.86_0.09_45)] text-[oklch(0.35_0.1_45)]",
  "bg-[oklch(0.87_0.08_155)] text-[oklch(0.33_0.08_155)]",
  "bg-[oklch(0.86_0.07_250)] text-[oklch(0.33_0.09_250)]",
  "bg-[oklch(0.88_0.09_95)] text-[oklch(0.38_0.08_95)]",
  "bg-[oklch(0.86_0.08_330)] text-[oklch(0.36_0.1_330)]",
  "bg-[oklch(0.87_0.07_200)] text-[oklch(0.34_0.07_200)]",
  "bg-[oklch(0.86_0.08_20)] text-[oklch(0.36_0.11_20)]",
  "bg-[oklch(0.87_0.06_290)] text-[oklch(0.35_0.09_290)]",
];

export function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30, 2026-99-99). */
export function isRealDate(iso: string | null | undefined): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function formatDate(iso: string) {
  if (!isRealDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
