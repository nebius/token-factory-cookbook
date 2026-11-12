import { describe, expect, it } from "vitest";
import { shortcutAllowed } from "./keys";

/** A stand-in element that matches the given selectors. */
const el = (...matches: string[]) => ({ closest: (sel: string) => (sel.split(",").some((s) => matches.includes(s.trim())) ? {} : null) });

describe("shortcutAllowed", () => {
  it("lets shortcuts through on the page itself", () => {
    expect(shortcutAllowed(" ", el(), false)).toBe(true);
    expect(shortcutAllowed("ArrowRight", null, false)).toBe(true);
  });
  it("never while typing or with a dialog open", () => {
    expect(shortcutAllowed("ArrowRight", el("textarea"), false)).toBe(false);
    expect(shortcutAllowed("/", el(), true)).toBe(false);
  });
  it("leaves Space to a focused button and arrows to tabs, but arrows still step from a button", () => {
    expect(shortcutAllowed(" ", el("button"), false)).toBe(false);
    expect(shortcutAllowed(" ", el("[role=button]"), false)).toBe(false);
    expect(shortcutAllowed("ArrowLeft", el("[role=tab]"), false)).toBe(false);
    expect(shortcutAllowed("ArrowRight", el("button"), false)).toBe(true);
  });
});
