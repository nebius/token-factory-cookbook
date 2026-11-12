// "Signatures only": when a repo is bigger than the budget, lower-priority files still go in, reduced to their
// imports, exports and declarations. Original line numbers are kept, so a tour step can still point at them.

const DECL =
  /^\s*(import\b|export\b|from\s+\S+\s+import\b|package\b|use\s|mod\s|pub\s|module\b|require\(|const\s+\w+\s*=\s*require\(|(async\s+)?function\b|(export\s+)?(default\s+)?(abstract\s+)?class\b|interface\b|type\s+\w+\s*=|enum\b|struct\b|trait\b|impl\b|fn\s|def\s|async\s+def\s|func\s|(public|private|protected|static|internal)\s|@\w+|#\s*(include|define)\b|[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{\s*$|(const|let|var)\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>)/;

export function signatures(text: string): { lines: [number, string][]; total: number } {
  const all = text.split("\n");
  const lines: [number, string][] = [];
  all.forEach((l, i) => {
    if (DECL.test(l) && l.trim().length < 240) lines.push([i + 1, l]);
  });
  return { lines, total: all.length };
}

/** A file block for the prompt: kept lines with their real numbers, "…" where code was left out. */
export function signatureBlock(path: string, text: string): string | null {
  const { lines, total } = signatures(text);
  if (lines.length === 0) return null;
  const out: string[] = [];
  let prev = 0;
  for (const [n, l] of lines) {
    if (n > prev + 1) out.push("…");
    out.push(`${n}| ${l}`);
    prev = n;
  }
  if (prev < total) out.push("…");
  return `=== ${path} (${total} lines, signatures only) ===\n${out.join("\n")}\n`;
}
