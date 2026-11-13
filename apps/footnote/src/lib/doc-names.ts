// Two issues of one report share most of their name: show what differs ("March 2026", "June 2026").
export function distinctNames(names: string[]): string[] {
  if (names.length < 2) return names;
  let i = 0;
  while (names.every((n) => n[i] !== undefined && n[i] === names[0][i])) i++;
  const cut = names[0].slice(0, i).search(/[,:;–—-]\s*[^,:;–—-]*$|\s\S*$/);
  const at = cut > 0 && i > 8 ? cut : 0;
  return names.map((n) => n.slice(at).replace(/^[\s,:;–—-]+/, "") || n);
}

// "Summary of Economic Projections: March 2026 vs June 2026" rather than repeating the shared name.
export function pairTitle(a: string, b: string): string {
  const [da, db] = distinctNames([a, b]);
  if (da === a) return `${a} vs ${b}`;
  const shared = a.slice(0, a.length - da.length).replace(/[\s,:;–—-]+$/, "");
  return `${shared}: ${da} vs ${db}`;
}
