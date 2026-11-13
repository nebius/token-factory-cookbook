// A small Excel formula evaluator, so Footnote can recompute every formula the model writes
// and store the result in the .xlsx. It covers what a figures model needs: arithmetic,
// cell and range references (also across sheets) and SUM, AVERAGE, MIN, MAX, COUNT, ABS, ROUND.
// Anything else is reported as unsupported rather than guessed.

type Ref = { sheet: string | null; col: number; row: number };

export class FormulaError extends Error {}

type Tok = { t: "num"; v: number } | { t: "ref"; v: string } | { t: "fn"; v: string } | { t: "op"; v: string };

const REF = /^(?:(?:'([^']+)'|([A-Za-z_][\w .]*?))!)?\$?([A-Z]{1,3})\$?(\d{1,7})/;

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    let m = rest.match(/^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|^\.\d+/);
    if (m) {
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    m = rest.match(/^([A-Za-z][A-Za-z0-9.]*)\s*\(/);
    if (m) {
      out.push({ t: "fn", v: m[1].toUpperCase() });
      i += m[0].length;
      continue;
    }
    m = rest.match(REF);
    if (m) {
      out.push({ t: "ref", v: m[0].replace(/\$/g, "") });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),:%".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new FormulaError(`Unsupported text "${rest.slice(0, 12)}"`);
  }
  return out;
}

function colNumber(letters: string) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colLetters(n: number) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseRef(text: string): Ref {
  const m = text.match(REF);
  if (!m || m[0].length !== text.length) throw new FormulaError(`Bad reference "${text}"`);
  return { sheet: m[1] ?? m[2] ?? null, col: colNumber(m[3]), row: Number(m[4]) };
}

function refText(r: { col: number; row: number }) {
  return `${colLetters(r.col)}${r.row}`;
}

type Lookup = (sheet: string | null, ref: string) => number | null;

type Value = number | number[];

export function evaluate(formula: string, lookup: Lookup): number {
  const toks = lex(formula.replace(/^=/, ""));
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expectOp = (v: string) => {
    const t = take();
    if (!t || t.t !== "op" || t.v !== v) throw new FormulaError(`Expected "${v}"`);
  };

  const cell = (text: string): number => {
    const r = parseRef(text);
    const v = lookup(r.sheet, refText(r));
    return v ?? 0;
  };

  const range = (a: string, b: string): number[] => {
    const ra = parseRef(a);
    const rb = parseRef(b);
    const sheet = ra.sheet;
    const out: number[] = [];
    for (let row = Math.min(ra.row, rb.row); row <= Math.max(ra.row, rb.row); row++)
      for (let col = Math.min(ra.col, rb.col); col <= Math.max(ra.col, rb.col); col++) {
        const v = lookup(sheet, refText({ col, row }));
        if (v !== null) out.push(v);
      }
    return out;
  };

  const flat = (args: Value[]) => args.flatMap((a) => (Array.isArray(a) ? a : [a]));

  const call = (name: string, args: Value[]): number => {
    const xs = flat(args);
    switch (name) {
      case "SUM":
        return xs.reduce((a, b) => a + b, 0);
      case "AVERAGE":
        if (!xs.length) throw new FormulaError("AVERAGE of nothing");
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      case "MIN":
        return xs.length ? Math.min(...xs) : 0;
      case "MAX":
        return xs.length ? Math.max(...xs) : 0;
      case "COUNT":
        return xs.length;
      case "ABS":
        return Math.abs(xs[0] ?? 0);
      case "ROUND": {
        const d = xs[1] ?? 0;
        const f = 10 ** d;
        return Math.round((xs[0] ?? 0) * f) / f;
      }
      default:
        throw new FormulaError(`Unsupported function ${name}`);
    }
  };

  // expr := term (("+"|"-") term)*; term := power (("*"|"/") power)*; power := unary ("^" unary)*
  const expr = (): Value => {
    let v = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = take().v;
      const r = term();
      v = num(v) + (op === "+" ? num(r) : -num(r));
    }
    return v;
  };
  const term = (): Value => {
    let v = power();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = take().v;
      const r = num(power());
      if (op === "/" && r === 0) throw new FormulaError("Division by zero");
      v = op === "*" ? num(v) * r : num(v) / r;
    }
    return v;
  };
  const power = (): Value => {
    let v = unary();
    while (peek()?.t === "op" && peek()!.v === "^") {
      take();
      v = num(v) ** num(unary());
    }
    return v;
  };
  const unary = (): Value => {
    if (peek()?.t === "op" && (peek()!.v === "-" || peek()!.v === "+")) {
      const op = take().v;
      const v = num(unary());
      return op === "-" ? -v : v;
    }
    let v = atom();
    while (peek()?.t === "op" && peek()!.v === "%") {
      take();
      v = num(v) / 100;
    }
    return v;
  };
  const atom = (): Value => {
    const t = take();
    if (!t) throw new FormulaError("Formula ends early");
    if (t.t === "num") return t.v;
    if (t.t === "ref") {
      if (peek()?.t === "op" && peek()!.v === ":") {
        take();
        const b = take();
        if (!b || b.t !== "ref") throw new FormulaError("Bad range");
        const bText = parseRef(b.v).sheet ? b.v : (parseRef(t.v).sheet ? `${t.v.split("!")[0]}!${b.v}` : b.v);
        return range(t.v, bText);
      }
      return cell(t.v);
    }
    if (t.t === "fn") {
      const args: Value[] = [];
      if (!(peek()?.t === "op" && peek()!.v === ")")) {
        args.push(expr());
        while (peek()?.t === "op" && peek()!.v === ",") {
          take();
          args.push(expr());
        }
      }
      expectOp(")");
      return call(t.v, args);
    }
    if (t.v === "(") {
      const v = expr();
      expectOp(")");
      return v;
    }
    throw new FormulaError(`Unexpected "${t.v}"`);
  };
  const num = (v: Value): number => {
    if (Array.isArray(v)) throw new FormulaError("A range can only be used inside a function");
    return v;
  };

  const out = num(expr());
  if (p < toks.length) throw new FormulaError(`Unexpected "${(toks[p] as { v: unknown }).v}"`);
  if (!Number.isFinite(out)) throw new FormulaError("Result is not a number");
  return out;
}

// Every cell a formula reads, for dependency checks: "Sheet!B2", ranges expanded.
export function references(formula: string, defaultSheet: string): string[] {
  const toks = lex(formula.replace(/^=/, ""));
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "ref") continue;
    const a = parseRef(t.v);
    const sheet = a.sheet ?? defaultSheet;
    const next = toks[i + 1];
    if (next?.t === "op" && next.v === ":" && toks[i + 2]?.t === "ref") {
      const b = parseRef((toks[i + 2] as { v: string }).v);
      for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++)
        for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) out.push(`${sheet}!${refText({ col, row })}`);
      i += 2;
    } else out.push(`${sheet}!${refText(a)}`);
  }
  return out;
}
