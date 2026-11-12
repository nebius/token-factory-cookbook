import { describe, expect, it } from "vitest";
import { tourToSequence } from "./export-map";
import { matchStored, pickMode, words } from "./match";
import { answerFollowUps, answerGist, answerTitle, threadContext, tourGist, type ThreadTurn } from "./thread";

describe("pickMode", () => {
  it.each([
    ["Walk me through a request", "tour"],
    ["What happens when a route has no handler?", "tour"],
    ["Trace how config is loaded", "tour"],
    ["Which files define routes?", "answer"],
    ["What options does the server take?", "answer"],
  ])("%s → %s", (q, mode) => expect(pickMode(q)).toBe(mode));
});

describe("matchStored", () => {
  const items = [
    { kind: "tour" as const, id: "t1", title: "Request to handler", text: "What happens when an HTTP request hits a Polka app?" },
    { kind: "answer" as const, id: "a1", title: "Where routes are registered", text: "Where are routes registered?" },
    { kind: "docs" as const, id: "core", title: "Server and router", text: "Routing Middleware" },
  ];
  it("finds stored work with the same words, endings ignored", () => {
    expect(words("Routing routes routed")).toEqual(new Set(["rout"]));
    expect(matchStored("how are routes registered in polka", items).map((m) => m.id)).toEqual(["a1"]);
    expect(matchStored("what happens when a request hits the app", items)[0].id).toBe("t1");
  });
  it("needs real overlap", () => {
    expect(matchStored("how is the database migrated", items)).toEqual([]);
    expect(matchStored("routes", items)).toEqual([]);
  });
});

const ANSWER = [
  'root = Answer("Where routes live", "Routes are registered in lib/app.ts.", [files, code, note], ["How are params parsed?", "What if no route matches?"])',
  'files = FileList([{path: "lib/app.ts", why: "Registers routes"}])',
  'code = CodeRef("lib/app.ts", 12, 20, "add(method, path, ...fns) {", "Pushes a route onto the table.")',
  'note = Callout("warn", "Order matters: first match wins.")',
].join("\n");

describe("answers in a thread", () => {
  it("reads the title, follow-ups and a compact gist", () => {
    expect(answerTitle(ANSWER)).toBe("Where routes live");
    expect(answerFollowUps(ANSWER)).toEqual(["How are params parsed?", "What if no route matches?"]);
    expect(answerFollowUps('root = Answer("t", "s", [a])')).toEqual([]);
    const g = answerGist(ANSWER);
    expect(g).toContain("Where routes live; Routes are registered in lib/app.ts.");
    expect(g).toContain("lib/app.ts:L12-20 Pushes a route onto the table.");
    expect(g).toContain("Order matters");
    expect(g).not.toContain("How are params parsed?");
    expect(g).not.toContain("warn");
  });
  it("sums up a tour with its step ranges", () => {
    expect(tourGist({ summary: "It routes.", steps: [{ node: "a", title: "Match", file: "lib/r.ts", startLine: 3, endLine: 9, anchor: "", narration: "", corrected: false }] })).toBe("It routes. Steps: 1. Match (lib/r.ts:L3-9)");
  });
  it("keeps the last 6 turns whole, older ones as one line, within the cap", () => {
    const turn = (i: number, gist = `gist ${i}`): ThreadTurn => ({ question: `Q${i}?`, kind: "answer", refId: `r${i}`, title: `T${i}`, gist });
    const ctx = threadContext(Array.from({ length: 8 }, (_, i) => turn(i + 1)));
    expect(ctx).toContain("- Q: Q1? → T1");
    expect(ctx).toContain("- Q: Q2? → T2");
    expect(ctx).not.toContain("gist 2");
    expect(ctx).toContain("Q: Q8?\nA (answer): gist 8");
    const big = threadContext(Array.from({ length: 6 }, (_, i) => turn(i + 1, "x".repeat(9_000))));
    expect(big.length).toBeLessThan(33_000);
    expect(big).toContain("Q: Q6?");
    expect(threadContext([])).toBe("");
  });
});

describe("tourToSequence", () => {
  it("draws each step as a message from the previous step's module", () => {
    const step = (node: string, title: string, start: number) => ({ node, title, file: "src/x.ts", startLine: start, endLine: start + 2, anchor: "", narration: "", corrected: false });
    const seq = tourToSequence({ steps: [step("http", "Accept; parse", 1), step("router", "Match #route", 5), step("router", "Run", 9)] }, { nodes: [{ id: "http", label: "HTTP server", kind: "entry", purpose: "", files: [] }, { id: "router", label: "Router", kind: "core", purpose: "", files: [] }] });
    expect(seq.split("\n")).toEqual([
      "sequenceDiagram",
      "  autonumber",
      "  participant m_http as HTTP server",
      "  participant m_router as Router",
      "  m_http->>m_http: Accept parse (src/x.ts:L1)",
      "  m_http->>m_router: Match route (src/x.ts:L5)",
      "  m_router->>m_router: Run (src/x.ts:L9)",
    ]);
  });
});
