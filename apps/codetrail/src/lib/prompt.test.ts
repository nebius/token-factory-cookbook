import { describe, expect, it } from "vitest";
import { promptFor } from "./prompt";
import type { Atlas } from "./schemas";

const atlas = {
  summary: "A tiny server.",
  nodes: [
    { id: "core", label: "Core", kind: "core", purpose: "Handles requests.", files: ["src/core.ts"] },
    { id: "url", label: "URL parser", kind: "util", purpose: "Parses URLs.", files: ["src/url.ts"] },
  ],
  edges: [{ from: "core", to: "url", label: "parses with", verified: true }],
} as unknown as Atlas;
const at = { owner: "lukeed", repo: "polka", sha: "c36cf8b0123456789" };
const files = { fileSizes: [["src/core.ts", 40, 300], ["src/url.ts", 20, 100]] as [string, number, number][], imports: [[0, 1]] as [number, number][], importLines: [3] };

describe("promptFor", () => {
  it("starts with the repo and commit and the architecture as Mermaid, and ends asking for a question", () => {
    const p = promptFor(atlas, at);
    expect(p).toMatch(/^I'm working in the GitHub repo lukeed\/polka \(https:\/\/github.com\/lukeed\/polka\/tree\/c36cf8b0123456789\), at commit c36cf8b01234\./);
    expect(p).toContain("```mermaid\nflowchart TD");
    expect(p).not.toContain("click ");
    expect(p.trimEnd().endsWith("My question:")).toBe(true);
  });

  it("gives a module's files and links with the import line behind each", () => {
    const p = promptFor(atlas, at, { module: "core" }, files);
    expect(p).toContain("## Module: Core");
    expect(p).toContain("- src/core.ts");
    expect(p).toContain("- uses URL parser (parses with): confirmed by imports at src/core.ts:3");
  });

  it("lists a tour's steps as file:lines, and skips the location of text-only steps", () => {
    const tour = { title: "A request", summary: "", steps: [{ title: "Intro", file: "", startLine: 0, endLine: 0, narration: "First,\n\nthe idea." }, { title: "Parse", file: "src/url.ts", startLine: 4, endLine: 9, narration: "Parses." }] };
    const p = promptFor(atlas, at, { tour: tour as never });
    expect(p).toContain("1. Intro\n   First, the idea.");
    expect(p).toContain("2. Parse (src/url.ts:4-9)");
  });

  it("names a local folder without a GitHub link", () => {
    expect(promptFor(atlas, { ...at, owner: "_local", repo: "app" })).toMatch(/^I'm working in the local folder "app"/);
  });
});
