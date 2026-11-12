// Which tour steps you've seen, kept in this browser per repo commit (like CodeTour's checkmarks). Private to the
// visitor and best effort: without storage (a private window), everything still works, just unticked.
type Seen = Record<string, number[]>;
const keyOf = (repo: string) => `codetrail:seen:${repo}`;

export function readSeen(repo: string): Seen {
  try {
    const raw = localStorage.getItem(keyOf(repo));
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Seen) : {};
  } catch {
    return {};
  }
}

/** Marks one step seen; returns the updated record (the same object when nothing changed). */
export function markSeen(repo: string, seen: Seen, tourId: string, step: number): Seen {
  if (seen[tourId]?.includes(step)) return seen;
  const next = { ...seen, [tourId]: [...(seen[tourId] ?? []), step].sort((a, b) => a - b) };
  try {
    localStorage.setItem(keyOf(repo), JSON.stringify(next));
  } catch {
    // No storage: the ticks last until the page closes.
  }
  return next;
}

/** Forgets every step seen in this repo's tours. */
export function resetSeen(repo: string): Seen {
  try {
    localStorage.removeItem(keyOf(repo));
  } catch {
    // No storage: nothing was kept.
  }
  return {};
}

/** A note shown once per repo, then remembered as dismissed. */
export function noteDismissed(id: string): boolean {
  try {
    return localStorage.getItem(`codetrail:note:${id}`) === "1";
  } catch {
    return false;
  }
}

export function dismissNote(id: string) {
  try {
    localStorage.setItem(`codetrail:note:${id}`, "1");
  } catch {
    // No storage: it shows again next time.
  }
}

/** "✓ seen", "3/9 seen", or nothing yet. */
export function seenLabel(seen: number[] | undefined, steps: number): string | null {
  const n = new Set(seen ?? []).size;
  if (!n) return null;
  return n >= steps ? "✓ seen" : `${n}/${steps} seen`;
}
