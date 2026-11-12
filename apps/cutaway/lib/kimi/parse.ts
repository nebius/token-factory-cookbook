import { jsonrepair } from "jsonrepair";

/**
 * Kimi answers in a tagged text format so code and SVG never need JSON escaping:
 *   <meta>{...}</meta>
 *   <part id="rotor">...three.js builder body...</part>
 *   <diagram kind="section" title="...">  <svg ...>...</svg>  </diagram>
 *   <patch>[{"id":"rotor","explode":{...}}]</patch>
 *   <verdict>one sentence</verdict>
 */
export type TaggedBlock =
  | { tag: "meta"; body: string }
  | { tag: "part"; id: string; body: string }
  | { tag: "diagram"; kind: string; title: string; body: string }
  | { tag: "patch"; body: string }
  | { tag: "verdict"; body: string };

const BLOCK = /<(meta|part|diagram|patch|verdict)\b([^>]*)>([\s\S]*?)<\/\1\s*>/g;

function attr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`));
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

/** Remove a ``` fence wrapper the model sometimes adds inside a block. */
export function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[\w-]*\s*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

function toBlock(tag: string, attrs: string, body: string): TaggedBlock | null {
  const b = stripFence(body);
  switch (tag) {
    case "meta":
    case "patch":
    case "verdict":
      return { tag, body: b };
    case "part": {
      const id = attr(attrs, "id");
      return id ? { tag, id, body: b } : null;
    }
    case "diagram":
      return { tag, kind: attr(attrs, "kind"), title: attr(attrs, "title"), body: b };
  }
  return null;
}

export function parseTagged(text: string): TaggedBlock[] {
  const out: TaggedBlock[] = [];
  for (const m of text.matchAll(BLOCK)) {
    const b = toBlock(m[1], m[2], m[3]);
    if (b) out.push(b);
  }
  return out;
}

/** Feeds streamed text and returns blocks as soon as their closing tag arrives. */
export class TaggedStreamParser {
  private buf = "";
  private cursor = 0;

  push(chunk: string): TaggedBlock[] {
    this.buf += chunk;
    const out: TaggedBlock[] = [];
    const re = new RegExp(BLOCK.source, "g");
    re.lastIndex = this.cursor;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const b = toBlock(m[1], m[2], m[3]);
      if (b) out.push(b);
      this.cursor = re.lastIndex;
    }
    return out;
  }

  get text(): string {
    return this.buf;
  }
}

/** Parse a JSON object out of model text: fences, prose around it, trailing commas. */
export function extractJson(text: string): unknown {
  const t = stripFence(text);
  const start = t.indexOf("{");
  const startArr = t.indexOf("[");
  const s = startArr >= 0 && (start < 0 || startArr < start) ? startArr : start;
  if (s < 0) throw new Error("no JSON found in the answer");
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  const slice = end > s ? t.slice(s, end + 1) : t.slice(s);
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(jsonrepair(slice));
  }
}
