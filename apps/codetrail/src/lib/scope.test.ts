import { describe, expect, it } from "vitest";
import { inScope, normalScope, parseScope, scopeHash, scopeLabel, scopeQuery, scopeString } from "./scope";

describe("scope", () => {
  it("normalises, round-trips and hashes the same whatever the order", () => {
    const a = normalScope({ only: ["src/", "./lib", "src"], skip: ["docs"] })!;
    const b = normalScope({ only: ["lib", "src"], skip: ["docs/"] })!;
    expect(a).toEqual({ only: ["lib", "src"], skip: ["docs"] });
    expect(scopeString(a)).toBe("only=lib,src;skip=docs");
    expect(parseScope(scopeString(a))).toEqual(a);
    expect(scopeHash(a)).toBe(scopeHash(b));
    expect(scopeHash(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(normalScope({ only: [" ", ".."], skip: [] })).toBeNull();
  });

  it("matches folders, files and globs", () => {
    const s = normalScope({ only: ["packages/*/src", "README.md"], skip: ["**/*.test.ts"] })!;
    expect(inScope("packages/core/src/index.ts", s)).toBe(true);
    expect(inScope("packages/core/src/a.test.ts", s)).toBe(false);
    expect(inScope("packages/core/test/x.ts", s)).toBe(false);
    expect(inScope("README.md", s)).toBe(true);
    expect(inScope("src/x.ts", normalScope({ only: [], skip: ["src"] }))).toBe(false);
    expect(inScope("srcx/a.ts", normalScope({ only: ["src"], skip: [] }))).toBe(false);
    expect(inScope("anything", null)).toBe(true);
  });

  it("labels and links", () => {
    const s = normalScope({ only: ["src"], skip: ["src/legacy"] });
    expect(scopeLabel(s)).toBe("src only · without src/legacy");
    expect(scopeQuery(s)).toBe("?only=src&skip=src%2Flegacy");
  });
});
