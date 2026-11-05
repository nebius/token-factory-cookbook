/** URL slug from a device name: "Brushless DC Motor" → "brushless-dc-motor". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "device"
  );
}

const FILLER = new Set(["a", "an", "the", "of", "for", "generic", "typical", "standard", "basic", "simple"]);

/** Cache key for a device name: order, case, plurals and filler words don't matter. */
export function nameKey(name: string): string {
  return slugify(name)
    .split("-")
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .sort()
    .join("-");
}
