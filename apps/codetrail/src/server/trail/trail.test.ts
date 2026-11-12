import { describe, expect, it } from "vitest";
import { atlasSchema, clampText } from "@/lib/schemas";
import { cleanProgram } from "@/lib/answer-schema";
import { costOf } from "@/server/ai/pricing";
import { cleanModelJson, isPlaceholder } from "@/server/ai/nebius";
import { findAnchor, groundSteps, nodeForFile, resolvePath } from "./ground";

const code = ["import x from 'y';", "", "export function handle(req, res) {", "  const body = parse(req);", "  return res.send(body);", "}", "", "function parse(req) {", "  return req.body;", "}"].join("\n");
const files = new Map([
  ["src/app.ts", code],
  ["src/db/store.ts", "export const store = new Map();"],
]);
const nodes = [
  { id: "app", files: ["src/app.ts"] },
  { id: "data", files: ["src/db/store.ts"] },
];
const step = (over: Partial<Parameters<typeof groundSteps>[0][number]>) => ({
  node: "app",
  title: "Handle",
  file: "src/app.ts",
  startLine: 3,
  endLine: 6,
  anchor: "export function handle(req, res) {",
  narration: "n",
  ...over,
});

describe("groundSteps", () => {
  it("keeps a step whose anchor is inside its range", () => {
    const g = groundSteps([step({})], files, nodes);
    expect(g).toMatchObject({ corrected: 0, dropped: 0, problems: [] });
    expect(g.steps[0]).toMatchObject({ startLine: 3, endLine: 6, corrected: false });
  });

  it("moves a range to where the anchor really is", () => {
    const g = groundSteps([step({ startLine: 1, endLine: 2, anchor: "  return req.body;" })], files, nodes);
    expect(g.corrected).toBe(1);
    expect(g.steps[0].startLine).toBeLessThanOrEqual(9);
    expect(g.steps[0].endLine).toBeGreaterThanOrEqual(9);
  });

  it("accepts an anchor copied with its line-number prefix and odd spacing", () => {
    expect(findAnchor(code, "4|   const body =   parse(req);", 1)).toBe(4);
  });

  it("drops steps with unknown files or anchors and explains why", () => {
    const g = groundSteps([step({ file: "src/nope.ts" }), step({ anchor: "doesNotExist()" })], files, nodes);
    expect(g.steps).toHaveLength(0);
    expect(g.dropped).toBe(2);
    expect(g.problems[0]).toContain("not a file");
    expect(g.problems[1]).toContain("doesn't appear");
  });

  it("fixes a partial path and an unknown module", () => {
    const g = groundSteps([step({ file: "db/store.ts", node: "nope", startLine: 1, endLine: 1, anchor: "export const store = new Map();" })], files, nodes);
    expect(g.steps[0]).toMatchObject({ file: "src/db/store.ts", node: "data" });
  });

  it("caps ranges at 40 lines", () => {
    const long = new Map([["a.ts", Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n")]]);
    const g = groundSteps([step({ file: "a.ts", startLine: 1, endLine: 150, anchor: "line 10" })], long, [{ id: "app", files: ["a.ts"] }]);
    expect(g.steps[0].endLine - g.steps[0].startLine + 1).toBe(40);
  });
});

describe("helpers", () => {
  it("resolvePath needs an exact or unique suffix match", () => {
    expect(resolvePath("./src/app.ts", files)).toBe("src/app.ts");
    expect(resolvePath("app.ts", files)).toBe("src/app.ts");
    expect(resolvePath("other.ts", files)).toBeNull();
  });
  it("nodeForFile falls back to the closest folder", () => {
    expect(nodeForFile("src/db/other.ts", nodes)).toBe("data");
  });
  it("clampText cuts at a sentence when it can", () => {
    expect(clampText("First sentence here. Second one goes on and on.", 30)).toBe("First sentence here.");
    expect(clampText("One. Two three four five.", 12)).toBe("One. Two…");
    expect(clampText("short", 10)).toBe("short");
  });
  it("atlas questions keep only the question", () => {
    const a = atlasSchema.parse({
      summary: "s",
      stack: [],
      nodes: [
        { id: "a", label: "A", kind: "core", purpose: "p", files: ["x"] },
        { id: "b", label: "B", kind: "core", purpose: "p", files: ["y"] },
      ],
      edges: [],
      tours: [{ title: "t", question: "How does it work? First it reads the config, then..." }],
      firstTour: {
        title: "t",
        summary: "s",
        steps: [
          { node: "a", title: "one", file: "x", startLine: 1, endLine: 2, anchor: "a", narration: "n" },
          { node: "b", title: "two", file: "y", startLine: 1, endLine: 2, anchor: "b", narration: "n" },
        ],
      },
    });
    expect(a.tours[0].question).toBe("How does it work?");
  });
  it("cleanModelJson and isPlaceholder", () => {
    expect(JSON.parse(cleanModelJson('<think>{x}</think>```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(isPlaceholder({ a: ["..."] })).toBe(true);
  });
  it("costOf prices cached tokens at the cached rate", () => {
    const prices = { fetchedAt: 0, models: { m: { input: 0.3e-6, cached: 0.006e-6, output: 1.2e-6 } } };
    expect(costOf(prices, "m", { input: 1_000_000, cached: 1_000_000, output: 0 })).toBeCloseTo(0.006);
    expect(costOf(prices, "m", { input: 1_000_000, cached: 0, output: 1_000_000 })).toBeCloseTo(1.5);
  });
});

describe("cleanProgram", () => {
  it("keeps the last program and drops commentary", () => {
    const raw = ['root = Answer("a", "b", [x])', 'x = Callout("info", "one")', "", "Wait, let me fix that.", 'root = Answer("a", "b", [y])', 'y = Callout("warn", "two")'].join("\n");
    expect(cleanProgram(raw)).toBe(['root = Answer("a", "b", [y])', 'y = Callout("warn", "two")'].join("\n"));
  });
  it("leaves a single clean program as it is", () => {
    const one = ['root = Answer("a", "b", [x])', 'x = Callout("info", "one")'].join("\n");
    expect(cleanProgram(one)).toBe(one);
  });
});

describe("cleanProgram with written line breaks", () => {
  it('splits statements separated by a literal "\\n" (seen in a real reply)', () => {
    const raw = 'root = Answer("T", "S", [files, code])\nfiles = FileList([{path: "a.ts", why: "x"}])\\n\\ncode = CodeRef("a.ts", 1, 2, "const a = 1;", "Sets a.")';
    expect(cleanProgram(raw).split("\n")).toEqual(['root = Answer("T", "S", [files, code])', 'files = FileList([{path: "a.ts", why: "x"}])', 'code = CodeRef("a.ts", 1, 2, "const a = 1;", "Sets a.")']);
  });
  it('leaves a "\\n" inside a string alone', () => {
    const raw = 'root = Answer("T", "Line one\\nline two", [n])\nn = Callout("info", "a\\nb")';
    expect(cleanProgram(raw)).toBe(raw);
  });
});
