import { describe, expect, it } from "vitest";
import { answerToMarkdown } from "./answer-md";
import { ANSWER_EXAMPLE, type StoredAnswer } from "./answer-schema";

const answer = (text: string, checks: StoredAnswer["checks"]): StoredAnswer => ({ id: "a1", question: "Where are requests routed?", text, checks, calls: [], at: 0 });
const at = { owner: "o", repo: "r", sha: "abcdef1234" };

describe("answerToMarkdown", () => {
  it("turns each block into Markdown, linking checked references at the commit with their lines", () => {
    const md = answerToMarkdown(
      answer(ANSWER_EXAMPLE, { refs: { "lib/router.ts:12": { file: "lib/router.ts", startLine: 12, endLine: 14, corrected: true } }, files: { "lib/router.ts": "lib/router.ts", "lib/app.ts": null } }),
      at,
      { "lib/router.ts": Array.from({ length: 20 }, (_, i) => `line ${i + 1}`) },
    );
    expect(md).toContain("# Where requests are routed");
    expect(md).toContain("> Where are requests routed?");
    expect(md).toContain("- [`lib/router.ts`](https://github.com/o/r/blob/abcdef1234/lib/router.ts): Matches paths to handlers");
    expect(md).toContain("- `lib/app.ts`: Registers routes");
    expect(md).toContain("[`lib/router.ts:12-14`](https://github.com/o/r/blob/abcdef1234/lib/router.ts#L12-L14)");
    expect(md).toContain("```ts\nline 12\nline 13\nline 14\n```");
    expect(md).toContain("## Ask next\n\n- How are route params parsed?");
  });

  it("leaves a reference that didn't hold up unlinked, and renders tables and sequences", () => {
    const text = `root = Answer("T", "S", [t, s, c], [])
t = Table(["Route", "Handler"], [["/a|b", "x"]])
s = Sequence([{from: "app", to: "router", message: "match"}])
c = CodeRef("lib/x.ts", 5, 9, "x", "Gone.")`;
    const md = answerToMarkdown(answer(text, { refs: { "lib/x.ts:5": null }, files: {} }), at);
    expect(md).toContain("| Route | Handler |\n| --- | --- |\n| /a\\|b | x |");
    expect(md).toContain("1. app → router: match");
    expect(md).toContain("```mermaid\nsequenceDiagram\n  app->>router: match\n```");
    expect(md).toContain("`lib/x.ts:5` (not found in the code, left unlinked): Gone.");
  });
});
