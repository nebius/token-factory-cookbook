import { describe, expect, it } from "vitest";
import { groupsOf, homeOf, plainLabel } from "./architecture";
import { PALETTE, SUPPORT } from "./palette";

const node = (id: string, kind: string, files: string[], layer?: string) => ({ id, label: id, kind, files, layer }) as Parameters<typeof groupsOf>[0][number];

describe("groupsOf", () => {
  it("groups by the read's layers, with supporting layers last and grey", () => {
    const { by, groups, color } = groupsOf([node("ci", "tooling", ["a"], "Build & tests"), node("api", "entry", ["a"], "Entry points"), node("db", "data", ["a"], "Storage"), node("api2", "entry", ["a"], "Entry points")]);
    expect(by).toBe("layer");
    expect(groups.map((g) => [g.title, g.nodes])).toEqual([
      ["Entry points", ["api", "api2"]],
      ["Storage", ["db"]],
      ["Build & tests", ["ci"]],
    ]);
    expect([color.get("api"), color.get("db"), color.get("ci")]).toEqual([PALETTE[0], PALETTE[1], SUPPORT]);
  });

  it("falls back to kinds, and to one unnamed group when every module has the same kind", () => {
    expect(groupsOf([node("a", "core", ["x"]), node("b", "tests", ["y"])]).groups.map((g) => g.title)).toEqual(["Core", "Tests"]);
    const flat = groupsOf([node("a", "core", ["x"]), node("b", "core", ["y"])]);
    expect(flat.by).toBeNull();
    expect(flat.groups).toHaveLength(1);
  });

  it("never cycles the palette: groups past it go grey", () => {
    const many = Array.from({ length: PALETTE.length + 2 }, (_, i) => node(`m${i}`, "core", ["x"], `Layer ${i}`));
    const { color } = groupsOf(many);
    expect(color.get(`m${PALETTE.length}`)).toBe(SUPPORT);
    expect(new Set(many.slice(0, PALETTE.length).map((n) => color.get(n.id))).size).toBe(PALETTE.length);
  });
});

describe("homeOf", () => {
  it("takes the deepest folder most files share", () => {
    expect(homeOf(["src/router.ts", "src/router/smart/router.ts", "src/router/regexp/router.ts"])).toBe("src/router/");
    expect(homeOf(["src/hono.ts", "src/hono-base.ts", "src/preset/quick.ts"])).toBe("src/");
    expect(homeOf(["package.json", "vite.config.ts"])).toBe("");
  });
});

it("plainLabel drops code ticks and the clamp's ellipsis", () => expect(plainLabel("`Hono` builds a…")).toBe("Hono builds a"));
