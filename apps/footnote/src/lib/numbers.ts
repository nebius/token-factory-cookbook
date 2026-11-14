import type { Box, PageText } from "@/lib/pdf";

// Finding the numbers a report prints, so every input cell can be tied to the text it came from.

export type Token = {
  raw: string;
  value: number;
  decimals: number; // digits after the point, as printed
  sig: number; // significant digits, as printed ("0.0" has none, "2" one, "13.7" three)
  percent: boolean; // "2.4%" or "2.4 percent"
  start: number; // offset in PageText.text
  end: number;
};

// Some text layers space out decimals ("4 . 1 percent", "1 .3 to 4 .7 percent"), so " . " or " ." between
// digits counts as a point. ". " alone does not: that is usually a sentence ending before a number.
const NUMBER = /(?<![\w.])[-−–]?\(?\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?\)?|(?<![\w.,])[-−–]?\(?\$?\d+(?:\.\d+| \. \d+| \.\d+)?%?\)?/g;

export function tokens(raw: string): Token[] {
  // Blank out dot leaders, keeping offsets, so "Average......71.07" still yields 71.07.
  const text = raw.replace(/(?:\s*\.){4,}/g, (m) => " ".repeat(m.length));
  const out: Token[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    const negative = /^[-−–]/.test(raw) || (raw.includes("(") && raw.includes(")"));
    const digits = raw.replace(/[^\d.]/g, "");
    if (!digits || digits === ".") continue;
    const value = Number(digits) * (negative ? -1 : 1);
    if (!Number.isFinite(value)) continue;
    const dot = digits.indexOf(".");
    const end = m.index! + raw.length;
    out.push({
      raw,
      value,
      decimals: dot < 0 ? 0 : digits.length - dot - 1,
      sig: digits.replace(".", "").replace(/^0+/, "").length,
      percent: raw.includes("%") || /^\s?percent\b/i.test(text.slice(end, end + 9)),
      start: m.index!,
      end,
    });
  }
  return out;
}

type Match = { token: Token; how: "exact" | "rounded" | "percent" | "scaled"; scale?: number };

function sameSign(value: number, t: Token) {
  return value === 0 || t.value === 0 || Math.sign(value) === Math.sign(t.value) || !/^[-−–(]/.test(t.raw);
}

function equal(value: number, t: Token) {
  return Math.abs(Math.abs(value) - Math.abs(t.value)) <= 1e-9 * Math.max(1, Math.abs(t.value)) && sameSign(value, t);
}

// Does `value` print as `t`? Rounded matches allow half a unit in the last printed digit, but only for
// numbers printed with two or more significant digits: a lone "0" or "2" (an axis tick, a footnote
// mark) matches only exactly.
function fits(value: number, t: Token): boolean {
  if (equal(value, t)) return true;
  if (t.sig < 2) return false;
  return Math.abs(Math.abs(value) - Math.abs(t.value)) <= 0.5 * 10 ** -t.decimals + 1e-9 && sameSign(value, t);
}

// percentCell: the cell is formatted as a percentage, so 0.044 may stand for a "4.4" printed under a "Percent" header.
export function matchValue(value: number, toks: Token[], percentCell = false): Match | null {
  let best: Match | null = null;
  for (const t of toks) {
    if (equal(value, t)) return { token: t, how: "exact" };
    if (!best && fits(value, t)) best = { token: t, how: "rounded" };
  }
  if (best) return best;
  // 0.024 written for "2.4%".
  for (const t of toks) if ((t.percent || percentCell) && fits(value * 100, t)) return { token: t, how: "percent" };
  // 25.2 (million) written for "25,200" (thousand), and the reverse.
  for (const scale of [1000, 0.001, 1e6, 1e-6]) for (const t of toks) if (t.decimals === 0 || Math.abs(t.value) >= 1) if (fits(value * scale, t) && Math.abs(t.value) >= 1) return { token: t, how: "scaled", scale };
  return null;
}

// Typographic ligatures some PDFs print ("inﬂation"), spelled out.
const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

function norm(s: string) {
  return s
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Offsets in the page text where `quote` appears, ignoring case, spacing and dash/quote styles.
// Dot leaders ("Crude oil ....... 13.32") and an ellipsis standing in for them count as one space.
const LEADER = /(?:\s*\.){4,}\s*|…/g;

export function findQuote(page: PageText, quote: string): { start: number; end: number } | null {
  const q = norm(quote.replace(LEADER, " "));
  if (q.length < 3) return null;
  const leader = new Uint8Array(page.text.length);
  for (const m of page.text.matchAll(LEADER)) leader.fill(1, m.index!, m.index! + m[0].length);
  // Build a normalised copy with a map back to original offsets.
  const map: number[] = [];
  let flat = "";
  let space = false;
  for (let i = 0; i < page.text.length; i++) {
    const c = page.text[i];
    if (/\s/.test(c) || leader[i]) {
      if (!space && flat.length) (flat += " "), map.push(i);
      space = true;
      continue;
    }
    space = false;
    // One source character can stand for several ("ﬂ" is "fl"); each maps back to it.
    for (const ch of norm(c) || c) {
      flat += ch;
      map.push(i);
    }
  }
  let at = flat.indexOf(q);
  if (at < 0) {
    // Text layers often split hyphenated words or drop spaces; try without spaces.
    const tight = flat.replace(/ /g, "");
    const tq = q.replace(/ /g, "");
    const t = tight.indexOf(tq);
    if (t < 0) return null;
    let seen = -1;
    let startOrig = -1;
    let endOrig = -1;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] === " ") continue;
      seen++;
      if (seen === t) startOrig = map[i];
      if (seen === t + tq.length - 1) {
        endOrig = map[i] + 1;
        break;
      }
    }
    return startOrig >= 0 && endOrig > startOrig ? { start: startOrig, end: endOrig } : null;
  }
  // Trim a match that starts or ends on a collapsed leader back to real text.
  let start = map[at];
  let end = map[at + q.length - 1] + 1;
  while (start < end && (leader[start] || /\s/.test(page.text[start]))) start++;
  while (end > start && (leader[end - 1] || /\s/.test(page.text[end - 1]))) end--;
  return { start, end };
}

// Boxes covering text[start, end), one per printed line. A match inside a longer text run is clipped
// in proportion to its characters, which is close enough to mark a number or phrase in a line.
export function boxesFor(page: PageText, start: number, end: number): Box[] {
  let offset = 0;
  const hit: Box[] = [];
  for (const run of page.runs) {
    const runStart = offset;
    const runEnd = offset + run.s.length;
    if (runEnd > start && runStart < end && run.s.length) {
      const a = Math.max(0, start - runStart) / run.s.length;
      const b = Math.min(run.s.length, end - runStart) / run.s.length;
      const [x, y, w, h] = run.box;
      hit.push([x + w * a, y, w * (b - a), h]);
    }
    offset = runEnd + 1;
    if (offset > end) break;
  }
  const lines: Box[] = [];
  for (const b of hit) {
    const line = lines.find((l) => Math.abs(l[1] - b[1]) < Math.min(l[3], b[3]) * 0.6);
    if (!line) {
      lines.push([...b]);
      continue;
    }
    const x0 = Math.min(line[0], b[0]);
    const y0 = Math.min(line[1], b[1]);
    const x1 = Math.max(line[0] + line[2], b[0] + b[2]);
    const y1 = Math.max(line[1] + line[3], b[1] + b[3]);
    line.splice(0, 4, x0, y0, x1 - x0, y1 - y0);
  }
  return lines;
}

// The first line's box: enough to point at a number.
export function boxFor(page: PageText, start: number, end: number): Box | null {
  return boxesFor(page, start, end)[0] ?? null;
}
