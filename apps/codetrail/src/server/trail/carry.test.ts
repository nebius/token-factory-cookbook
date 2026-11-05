import { describe, expect, it } from "vitest";
import type { Step, Tour } from "@/lib/schemas";
import { carryTour } from "./carry";

const before = ["import a from 'a';", "", "export function start() {", "  listen(3000);", "}", "", "function stop() {", "  close();", "}"].join("\n");
const nodes = [{ id: "core", files: ["src/app.ts"] }];
const step = (over: Partial<Step>): Step => ({ node: "core", title: "t", file: "src/app.ts", startLine: 3, endLine: 5, anchor: "export function start() {", narration: "n", corrected: false, ...over });
const tour = (steps: Step[]) => ({ id: "x", question: "q", title: "T", summary: "", steps, check: { corrected: 0, dropped: 0 }, calls: [] }) as Tour;

describe("carryTour", () => {
  it("keeps unchanged steps where they are", () => {
    const t = carryTour(tour([step({})]), new Map([["src/app.ts", before]]), new Map([["src/app.ts", before]]), nodes, "abc");
    expect(t.steps[0]).toMatchObject({ startLine: 3, endLine: 5 });
    expect(t.steps[0].stale).toBeUndefined();
    expect(t.carriedFrom).toEqual({ sha: "abc", moved: 0, stale: 0 });
  });

  it("moves a step with its code when lines were added above it", () => {
    const after = ["import a from 'a';", "import b from 'b';", "import c from 'c';", "", "export function start() {", "  listen(8080);", "}"].join("\n");
    const t = carryTour(tour([step({}), step({ startLine: 7, endLine: 9, anchor: "function stop() {" })]), new Map([["src/app.ts", before]]), new Map([["src/app.ts", after]]), nodes, "abc");
    expect(t.steps[0]).toMatchObject({ startLine: 5, endLine: 7 });
    expect(t.steps[1]).toMatchObject({ startLine: 7, endLine: 7, stale: true });
    expect(t.carriedFrom).toEqual({ sha: "abc", moved: 1, stale: 1 });
  });

  it("keeps the anchor's place inside the range, marks steps of deleted files stale, and leaves text steps alone", () => {
    const after = ["", "", "", "// new", "import a from 'a';", "", "export function start() {", "  listen(3000);", "}"].join("\n");
    const inner = step({ startLine: 2, endLine: 5 });
    const text = step({ file: "", startLine: 0, endLine: 0, anchor: "", node: "" });
    const t = carryTour(tour([inner, text, step({ file: "gone.ts" })]), new Map([["src/app.ts", before]]), new Map([["src/app.ts", after]]), nodes, "abc");
    expect(t.steps[0]).toMatchObject({ startLine: 6, endLine: 9 });
    expect(t.steps[1]).toEqual(text);
    expect(t.steps[2].stale).toBe(true);
  });
});
