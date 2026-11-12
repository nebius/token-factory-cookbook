// Which folders a read covers (like DeepWiki's include/exclude filters): "only" these folders or globs, "skip"
// those. A scoped read is its own read, stored apart from the full one, so the same commit can be read both ways.
// Folders match themselves and everything under them; "*" matches within a folder, "**" across folders.

export type Scope = { only: string[]; skip: string[] };

const clean = (list: string[]) =>
  [...new Set(list.map((p) => p.trim().replace(/^\.?\//, "").replace(/\/+$/, "")).filter((p) => p && p !== "." && !p.includes("..")))].sort().slice(0, 40);

/** The canonical form, or null for "everything". */
export function normalScope(s: Partial<Scope> | null | undefined): Scope | null {
  const only = clean(s?.only ?? []);
  const skip = clean(s?.skip ?? []);
  return only.length || skip.length ? { only, skip } : null;
}

/** One string for requests and storage keys: "only=src,lib;skip=docs". */
export function scopeString(s: Scope | null): string | undefined {
  if (!s) return undefined;
  return [s.only.length ? `only=${s.only.join(",")}` : "", s.skip.length ? `skip=${s.skip.join(",")}` : ""].filter(Boolean).join(";");
}

export function parseScope(text: string | null | undefined): Scope | null {
  if (!text) return null;
  const parts = Object.fromEntries(text.split(";").map((p) => p.split("=")).filter((p) => p.length === 2)) as Record<string, string>;
  return normalScope({ only: parts.only?.split(",") ?? [], skip: parts.skip?.split(",") ?? [] });
}

/** A short, stable id for storage keys (FNV-1a, so it runs the same in the browser and on the server). */
export function scopeHash(s: Scope): string {
  let h = 0x811c9dc5;
  for (const ch of scopeString(s)!) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const toRegex = (glob: string) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}(/.*)?$`);

/** Whether a file is in the read. */
export function inScope(path: string, s: Scope | null): boolean {
  if (!s) return true;
  const hit = (p: string) => (p.includes("*") ? toRegex(p).test(path) : path === p || path.startsWith(`${p}/`));
  return (!s.only.length || s.only.some(hit)) && !s.skip.some(hit);
}

/** "src, lib only · without docs", for the header and lists. */
export function scopeLabel(s: Scope | null): string | null {
  if (!s) return null;
  return [s.only.length ? `${s.only.join(", ")} only` : "", s.skip.length ? `without ${s.skip.join(", ")}` : ""].filter(Boolean).join(" · ");
}

/** The page address for a scope: ?only=a,b&skip=c. */
export function scopeQuery(s: Scope | null): string {
  if (!s) return "";
  const q = new URLSearchParams();
  if (s.only.length) q.set("only", s.only.join(","));
  if (s.skip.length) q.set("skip", s.skip.join(","));
  return `?${q.toString()}`;
}
