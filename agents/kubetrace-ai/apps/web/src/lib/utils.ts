import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtTime(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDuration(seconds?: number | null) {
  if (seconds == null) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} m ${Math.round(seconds % 60)} s`;
}

export function ago(ts?: number | null) {
  if (!ts) return "never";
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 5 ? "just now" : s < 60 ? `${Math.round(s)} s ago` : `${Math.round(s / 60)} min ago`;
}
