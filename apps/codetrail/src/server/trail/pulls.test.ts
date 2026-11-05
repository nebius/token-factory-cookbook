import { describe, expect, it } from "vitest";
import { lineRanges, patchLines } from "@/lib/diff";
import type { PullFacts, PullFile } from "@/lib/schemas";
import { checkReview, overlayFiles } from "./ground";
import { pullTask, rankChanged } from "./prompts";

const PATCH = ["@@ -1,4 +1,5 @@", " import x from 'y';", "-const a = 1;", "+const a = 2;", "+const b = 3;", " ", " export default a;", "@@ -10,3 +11,2 @@ function f() {", " one", "-two", " three", "\\ No newline at end of file"].join("\n");

describe("patchLines", () => {
  it("maps added lines to the new file and removals to the line they follow", () => {
    const p = patchLines(PATCH);
    expect([...p.added]).toEqual([2, 3]);
    expect([...p.removedAfter]).toEqual([
      [1, 1],
      [11, 1],
    ]);
    expect(p.removed).toBe(2);
  });
  it("handles a new file and an empty patch", () => {
    expect([...patchLines("@@ -0,0 +1,2 @@\n+a\n+b").added]).toEqual([1, 2]);
    expect(patchLines("").added.size).toBe(0);
  });
});

describe("lineRanges", () => {
  it("collapses runs", () => expect(lineRanges([9, 3, 4, 5])).toBe("3–5, 9"));
  it("caps long lists", () => expect(lineRanges([1, 3, 5, 7], 2)).toBe("1, 3 and 2 more"));
});

const file = (path: string, over: Partial<PullFile> = {}): PullFile => ({ path, status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b", ...over });

describe("overlayFiles", () => {
  it("drops deleted and renamed-away files and lays the PR's versions on top", () => {
    const base = new Map([
      ["a.ts", "old a"],
      ["gone.ts", "x"],
      ["old-name.ts", "y"],
      ["same.ts", "z"],
    ]);
    const out = overlayFiles(base, [{ path: "a.ts", text: "new a" }, { path: "new-name.ts", text: "y2" }], [file("a.ts"), file("gone.ts", { status: "removed" }), file("new-name.ts", { status: "renamed", previous: "old-name.ts" })]);
    expect([...out].sort()).toEqual([
      ["a.ts", "new a"],
      ["new-name.ts", "y2"],
      ["same.ts", "z"],
    ]);
    expect(base.get("a.ts")).toBe("old a");
  });
});

describe("checkReview", () => {
  const files = new Map([["src/app.ts", "line one\nconst token = req.headers.auth;\nreturn token;"]]);
  it("moves a note to the quoted line and marks it checked", () => {
    const [n] = checkReview([{ kind: "risk", text: "Unchecked header.", file: "app.ts", line: 9, anchor: "const token = req.headers.auth;" }], files);
    expect(n).toEqual({ kind: "risk", text: "Unchecked header.", file: "src/app.ts", line: 2, checked: true });
  });
  it("keeps notes it can't verify, unmarked", () => {
    const [missing, general] = checkReview(
      [
        { kind: "test", text: "No test.", file: "src/nope.ts", line: 3, anchor: "x" },
        { kind: "question", text: "Why now?", file: "", line: 0, anchor: "" },
      ],
      files,
    );
    expect(missing).toMatchObject({ file: "src/nope.ts", checked: false });
    expect(general).toMatchObject({ file: null, line: null, checked: false });
  });
});

describe("pull task", () => {
  it("reads source before tests and docs, and skips deleted and lock files", () => {
    const ranked = rankChanged([file("README.md", { additions: 90 }), file("test/a.test.ts"), file("src/b.ts"), file("src/big.ts", { additions: 50 }), file("pnpm-lock.yaml"), file("src/old.ts", { status: "removed" })]);
    expect(ranked.map((f) => f.path)).toEqual(["src/big.ts", "src/b.ts", "README.md", "test/a.test.ts"]);
  });
  it("fits patches in the budget, most useful first, and names the rest", () => {
    const facts: PullFacts = {
      number: 5,
      title: "Speed up routing",
      body: "Makes it faster.",
      author: "dev",
      state: "open",
      draft: false,
      baseRef: "main",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      headRepo: "fork/repo",
      additions: 2,
      deletions: 1,
      changedFiles: 2,
      htmlUrl: "https://github.com/o/repo/pull/5",
      files: [file("docs/guide.md", { patch: `@@ -1 +1 @@\n+${"x".repeat(4_000)}` }), file("src/router.ts")],
    };
    const t = pullTask(facts, { sha: "c".repeat(40), ref: "main" }, [{ path: "src/router.ts", text: "export const route = 1;", lines: 1 }], [{ id: "core", label: "Core", files: ["src/router.ts"] }], 200);
    expect(t.sent).toEqual({ head: 1, patches: 1, left: ["docs/guide.md"] });
    expect(t.text).toContain("--- src/router.ts");
    expect(t.text).toContain("1| export const route = 1;");
    expect(t.text).toContain("from the fork fork/repo");
    expect(t.text).toContain("- core (Core)");
  });
});
