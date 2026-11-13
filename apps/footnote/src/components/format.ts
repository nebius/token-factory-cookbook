import type { CellCheck, CheckedCell, Format, Status } from "@/lib/book";

export function fmtValue(v: number | string | undefined, format?: Format): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (format === "percent") return `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (format === "currency") {
    const digits = Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", digits)}`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 });
}

const RANK: Record<Status, number> = { fail: 4, warn: 3, scan: 2, info: 1, ok: 0 };

export function worst(checks: CellCheck[]): Status | null {
  if (!checks.length) return null;
  return checks.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a)).status;
}

export function cellText(c: CheckedCell) {
  return c.formula ? (c.result === undefined ? "…" : fmtValue(c.result, c.format)) : fmtValue(c.value, c.format);
}


export function money(n: number | null | undefined) {
  if (n === null || n === undefined) return "no price set";
  if (n === 0) return "$0 (free)";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

export function int(n: number) {
  return n.toLocaleString("en-US");
}

export function secs(ms: number) {
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
