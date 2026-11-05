// Reads a unified diff (one file's patch, as GitHub's API returns it) into line numbers, so the code panel can
// mark what a pull request changed on the new version of the file. Pure: shared by the browser and the tests.

type PatchLines = {
  /** Lines of the new file that the patch adds. */
  added: Set<number>;
  /** Removed lines, keyed by the new-file line they come after (0 = before the first line). */
  removedAfter: Map<number, number>;
  removed: number;
};

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function patchLines(patch: string): PatchLines {
  const added = new Set<number>();
  const removedAfter = new Map<number, number>();
  let removed = 0;
  let line = 0;
  for (const l of patch.split("\n")) {
    const hunk = l.match(HUNK);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!line || l.startsWith("\\")) continue; // Before the first hunk, or "\ No newline at end of file".
    if (l.startsWith("+")) {
      added.add(line++);
    } else if (l.startsWith("-")) {
      removedAfter.set(line - 1, (removedAfter.get(line - 1) ?? 0) + 1);
      removed++;
    } else {
      line++;
    }
  }
  return { added, removedAfter, removed };
}

/** Line numbers as short ranges for screen readers and tooltips: [3,4,5,9] → "3–5, 9". */
export function lineRanges(lines: Iterable<number>, max = 8): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return out.length > max ? `${out.slice(0, max).join(", ")} and ${out.length - max} more` : out.join(", ");
}
