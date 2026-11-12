// Before a question costs anything: which kind of answer it wants, and whether something already stored answers
// it. Plain word matching on what the browser already has (no model, no embeddings, no request).

export type AskMode = "answer" | "tour" | "thorough" | "research";

/** "Walk me through…" and "what happens when…" want a tour; everything else gets a structured answer. */
export function pickMode(question: string): Exclude<AskMode, "thorough"> {
  return /\b(walk (me )?through|what happens (when|if|after|before)|step[- ]by[- ]step|trace|flow of|end[- ]to[- ]end|from .+ to .+|lifecycle|how does .+ (reach|get to|flow|travel|end up))\b/i.test(question)
    ? "tour"
    : "answer";
}

const STOP = new Set(
  "a an and are as at be by can do does did for from how i if in into is it its me my of on or the this that to was what when where which who why will with work works working you your there their they them repo repository code".split(
    " ",
  ),
);

/** Lowercase words with stopwords dropped and simple endings removed ("routes", "routing" → "rout"). */
export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[`'"]/g, "")
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "") || w),
  );
}

export type Stored = { kind: "tour" | "answer" | "docs" | "thread"; id: string; title: string; text: string };

/**
 * Stored work that already covers the question: most of its words appear in the stored item's title or question.
 * Returns the best few, strongest first.
 */
export function matchStored(question: string, items: Stored[], max = 3): (Stored & { score: number })[] {
  const q = words(question);
  if (q.size < 2) return [];
  return items
    .map((it) => {
      const w = words(`${it.title} ${it.text}`);
      const shared = [...q].filter((x) => w.has(x)).length;
      return { ...it, score: shared / q.size, shared };
    })
    .filter((m) => m.shared >= 2 && m.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ shared: _, ...m }) => m);
}
