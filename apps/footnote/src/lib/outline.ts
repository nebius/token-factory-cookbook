import type { PageText } from "@/lib/pdf";

// How the model finds its way around a long document: a one-line outline per page with the running
// headers and footers removed, the figure and table captions pulled out, and a text search.

// Text runs printed on many pages (running heads, footers, the report title) carry no information
// about the page. Digits are folded so "page 12" and "page 13" count as the same run.
export function boilerplate(pages: PageText[]): Set<string> {
  const out = new Set<string>();
  if (pages.length < 4) return out;
  const seen = new Map<string, number>();
  for (const p of pages) {
    const mine = new Set(p.runs.map((r) => fold(r.s)).filter((s) => s.length >= 3));
    for (const s of mine) seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.2));
  for (const [s, n] of seen) if (n >= min) out.add(s);
  return out;
}

function fold(s: string) {
  return s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

// Table of contents and table cells use dot leaders: "Crude oil ........ 13.32". Ligatures ("inﬂation")
// are spelled out so searches and the model's quotes see plain letters.
const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

export function squeezeLeaders(s: string) {
  return s.replace(/(?:\s*\.){4,}\s*/g, " … ").replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c);
}

// Axis ticks, quarter labels and bare numbers that often open a chart or table page.
const NOISE = /^(?:[-−–$]?[\d.,]+%?|Q[1-4]|[1-4]Q\d{2}|[A-Z][a-z]{2}-?\d{0,2}|#)$/;

// "Figure 31. Federal receipts and expenditures", "Table 2. Energy Prices". Captions are capitalised;
// narrative references ("(figure 31)") are not.
const CAPTIONS = /\b(?:Figure|Table|Chart|Exhibit) \d+(?:\.[A-Z])?\.?\s+\S(?:(?!\b(?:Figure|Table|Chart|Exhibit) \d).){2,90}/g;
// Where a caption's title ends and the chart's labels or the table's data begin.
const CAPTION_END = /\s(?:Note|Notes|Sources?|Data source|Monthly|Annual|Weekly|Quarterly|Daily|Percent|Index|Billions|Millions|Thousands|U\.S\. Energy Information Administration)\b|\s\(?[-−$]?\d[\d.,]*\)?\s+\(?[-−$]?\d/;

export function captions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CAPTIONS)) {
    let c = m[0].replace(/\s+/g, " ").trim();
    const end = c.slice(8).search(CAPTION_END);
    if (end >= 0) c = c.slice(0, end + 8).trim();
    if (!out.some((o) => o.startsWith(c.slice(0, 12)))) out.push(c.length > 80 ? `${c.slice(0, 80)}…` : c);
    if (out.length >= 3) break;
  }
  return out;
}

export function pageSummary(p: PageText, skip: Set<string>, width = 140) {
  const words: string[] = [];
  let started = false;
  for (const r of p.runs) {
    if (skip.has(fold(r.s))) continue;
    const parts = squeezeLeaders(r.s).split(" ");
    for (const w of parts) {
      if (!started && (NOISE.test(w) || w === "…")) continue;
      started = true;
      words.push(w);
    }
    if (words.join(" ").length > width) break;
  }
  let line = words.join(" ");
  if (line.length > width) line = `${line.slice(0, width).replace(/\s\S*$/, "")}…`;
  return line;
}

export function outline(pages: PageText[]) {
  const skip = boilerplate(pages);
  return pages
    .map((p) => {
      const caps = captions(p.text);
      const head = pageSummary(p, skip) || "(no text layer: scanned page, read the image)";
      return `p${p.n}${p.origin === "model" ? " [scanned]" : ""}${p.figures ? " [chart or image]" : ""}: ${head}${caps.length ? ` | ${caps.join(" | ")}` : ""}`;
    })
    .join("\n");
}

export type Hit = { page: number; snippet: string };

// Case-insensitive search across every page. A phrase is tried as a whole first; when it is not
// printed anywhere, pages that contain all of its words are returned instead, most matches first.
export function search(pages: PageText[], query: string, limit = 15): { hits: Hit[]; mode: "phrase" | "words" | "none"; total: number } {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (q.length < 2) return { hits: [], mode: "none", total: 0 };
  const hits: Hit[] = [];
  let total = 0;
  for (const p of pages) {
    const flat = squeezeLeaders(p.text).replace(/\s+/g, " ");
    const lower = flat.toLowerCase();
    let at = lower.indexOf(q);
    let onPage = 0;
    while (at >= 0) {
      total++;
      if (onPage++ < 2 && hits.length < limit) hits.push({ page: p.n, snippet: snippet(flat, at, q.length) });
      at = lower.indexOf(q, at + q.length);
    }
  }
  if (total) return { hits, mode: "phrase", total };

  const words = q.split(" ").filter((w) => w.length >= 2);
  if (words.length < 2) return { hits: [], mode: "none", total: 0 };
  const scored = pages
    .map((p) => {
      const flat = squeezeLeaders(p.text).replace(/\s+/g, " ");
      const lower = flat.toLowerCase();
      if (!words.every((w) => lower.includes(w))) return null;
      const count = words.reduce((n, w) => n + lower.split(w).length - 1, 0);
      const at = lower.indexOf(words[0]);
      return { page: p.n, count, snippet: snippet(flat, at, words[0].length) };
    })
    .filter((x): x is { page: number; count: number; snippet: string } => x !== null)
    .sort((a, b) => b.count - a.count);
  return { hits: scored.slice(0, limit).map(({ page, snippet }) => ({ page, snippet })), mode: scored.length ? "words" : "none", total: scored.length };
}

function snippet(text: string, at: number, len: number) {
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + len + 90);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
