import { describe, expect, it } from "vitest";
import { checkCustomSteps, customTourInput } from "./custom";
import { CODETOUR_PATH, codeTourStep, orderCodeTours } from "./service";

const files = new Map([
  ["src/app.ts", "\n\nexport function start() {\n  listen();\n}\n"],
  ["README.md", "# Hi"],
]);
const atlas = { nodes: [{ id: "core", label: "Core", kind: "core", purpose: "", files: ["src/app.ts"] }] } as Parameters<typeof checkCustomSteps>[2];

describe("checkCustomSteps", () => {
  it("anchors each step on its first non-blank line and assigns its module", () => {
    const input = customTourInput.parse({ title: "My tour", steps: [{ file: "src/app.ts", startLine: 1, endLine: 4, title: "Start" }] });
    const { steps, problems } = checkCustomSteps(input, files, atlas);
    expect(problems).toEqual([]);
    expect(steps[0]).toMatchObject({ node: "core", file: "src/app.ts", startLine: 1, endLine: 4, anchor: "export function start() {", narration: "", corrected: false });
  });

  it("names steps that point at missing files or lines, and clamps a range to the file", () => {
    const input = customTourInput.parse({
      title: "Broken",
      steps: [
        { file: "nope.ts", startLine: 1, endLine: 2, title: "A" },
        { file: "README.md", startLine: 9, endLine: 9, title: "B" },
        { file: "src/app.ts", startLine: 3, endLine: 99, title: "C" },
      ],
    });
    const { steps, problems } = checkCustomSteps(input, files, atlas);
    expect(problems).toEqual(['Step 1 ("A"): nope.ts isn\'t a file in this commit.', 'Step 2 ("B"): README.md has 1 lines; line 9 doesn\'t exist.']);
    expect(steps[0]).toMatchObject({ startLine: 3, endLine: 6 });
  });

  it("keeps text steps (no file) in place, and asks for their text", () => {
    const input = customTourInput.parse({
      title: "With an intro",
      steps: [
        { file: "", startLine: 0, endLine: 0, title: "The idea", narration: "Requests go in, responses come out." },
        { file: "src/app.ts", startLine: 3, endLine: 4, title: "Start" },
        { file: "", startLine: 0, endLine: 0, title: "Empty" },
      ],
    });
    const { steps, problems } = checkCustomSteps(input, files, atlas);
    expect(steps[0]).toMatchObject({ file: "", node: "", startLine: 0, endLine: 0, anchor: "", narration: "Requests go in, responses come out." });
    expect(steps[1]).toMatchObject({ file: "src/app.ts", node: "core" });
    expect(problems).toEqual(['Step 3 ("Empty"): a text step needs some text.']);
  });
});

describe("CodeTour import", () => {
  const nodes = [{ id: "core", files: ["src/app.ts"] }];
  it("finds tours where CodeTour looks, including subfolders and main.tour", () => {
    for (const p of [".tours/a.tour", ".github/tours/b.tour", ".vscode/tours/c.tour", ".tours/basics/d.tour", "main.tour", "pkg/.tours/e.tour"]) expect(CODETOUR_PATH.test(p), p).toBe(true);
    for (const p of ["tours/a.tour", ".tours/a.json", "src/main.tour"]) expect(CODETOUR_PATH.test(p), p).toBe(false);
  });

  it("puts the primary tour first, then orders by title with numbers as numbers", () => {
    const t = (path: string, title: string, isPrimary?: boolean) => ({ path, tour: { title, isPrimary } });
    const order = orderCodeTours([t("a", "10 - Deploy"), t("b", "2 - Routing"), t("c", "Overview", true), t("d", "1 - Setup")]).map((x) => x.tour.title);
    expect(order).toEqual(["Overview", "1 - Setup", "2 - Routing", "10 - Deploy"]);
  });

  it("turns content and folder steps into text steps, and checks file steps against the code", () => {
    expect(codeTourStep({ title: "Welcome", description: "Read me first." }, 0, files, nodes)).toMatchObject({ file: "", title: "Welcome", narration: "Read me first." });
    expect(codeTourStep({ directory: "src", description: "All the code." }, 1, files, nodes)).toMatchObject({ file: "", title: "Step 2", narration: "`src/` All the code." });
    expect(codeTourStep({ file: "src/app.ts", line: 3, description: "Starts it." }, 2, files, nodes)).toMatchObject({ file: "src/app.ts", startLine: 3, node: "core", anchor: "export function start() {" });
    expect(codeTourStep({ file: "src/app.ts", pattern: "^\\s+listen\\(" }, 3, files, nodes)).toMatchObject({ startLine: 4, anchor: "  listen();" });
    expect(codeTourStep({ file: "gone.ts", line: 1 }, 3, files, nodes)).toBeNull();
    expect(codeTourStep({}, 4, files, nodes)).toBeNull();
  });
});
