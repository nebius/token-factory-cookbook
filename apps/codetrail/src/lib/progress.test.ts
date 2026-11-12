import { beforeEach, describe, expect, it } from "vitest";
import { markSeen, readSeen, seenLabel } from "./progress";

describe("tour progress", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  });

  it("keeps seen steps per repo commit and reads them back", () => {
    let seen = readSeen("o/r@abc");
    seen = markSeen("o/r@abc", seen, "t1", 2);
    seen = markSeen("o/r@abc", seen, "t1", 0);
    expect(markSeen("o/r@abc", seen, "t1", 0)).toBe(seen);
    expect(readSeen("o/r@abc")).toEqual({ t1: [0, 2] });
    expect(readSeen("o/r@other")).toEqual({});
  });

  it("works without storage", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(readSeen("x")).toEqual({});
    expect(markSeen("x", {}, "t", 1)).toEqual({ t: [1] });
  });

  it("labels progress", () => {
    expect(seenLabel(undefined, 5)).toBeNull();
    expect(seenLabel([0, 1], 5)).toBe("2/5 seen");
    expect(seenLabel([0, 1, 2], 3)).toBe("✓ seen");
  });
});
