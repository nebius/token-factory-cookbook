import { describe, expect, it } from "vitest";
import { AIError } from "@/server/ai/nebius";
import { MAX_ROUNDS, researchContext, researchRounds, roundDone, roundTask } from "./research";

describe("research", () => {
  it("stops a round that reports nothing new, or next to nothing", () => {
    expect(roundDone("NOTHING NEW")).toBe(true);
    expect(roundDone("  nothing new.  ")).toBe(true);
    expect(roundDone("ok")).toBe(true);
    expect(roundDone("- `src/app.ts:12` registers the route with the router before any request arrives.")).toBe(false);
  });

  it("sends the plan and earlier findings with each round", () => {
    const t = roundTask("How are routes matched?", "1. Where routes are stored", ["- src/router.ts:10 stores them"]);
    expect(t).toContain("Research plan:\n1. Where routes are stored");
    expect(t).toContain("Findings, round 1:\n- src/router.ts:10 stores them");
    expect(t).toContain(`Research round 2 of ${MAX_ROUNDS}`);
  });

  it("keeps the plan and the newest findings when the recap runs long", () => {
    const big = "x".repeat(15_000);
    const c = researchContext("PLAN", [`old ${big}`, `new ${big}`]);
    expect(c.startsWith("Research plan:\nPLAN")).toBe(true);
    expect(c).toContain("new x");
    expect(c).not.toContain("old x");
    expect(c.length).toBeLessThanOrEqual(24_000);
  });

  it("runs rounds with the findings so far, and stops when one finds nothing new", async () => {
    const seen: string[][] = [];
    const rounds = await researchRounds(async (n, found) => {
      seen.push([...found]);
      return n === 3 ? "NOTHING NEW" : `- the finding from research round ${n}, at src/app.ts:${n}`;
    });
    expect(rounds).toHaveLength(2);
    expect(seen).toEqual([[], ["- the finding from research round 1, at src/app.ts:1"], ["- the finding from research round 1, at src/app.ts:1", "- the finding from research round 2, at src/app.ts:2"]]);
  });

  it("keeps what was found when a round is cut off, and passes other errors on", async () => {
    const cut = await researchRounds(async (n) => {
      if (n === 2) throw new AIError("The answer was cut off before it finished.", "truncated");
      return "- a finding long enough to count as one, at src/app.ts:4";
    });
    expect(cut).toHaveLength(1);
    await expect(researchRounds(async () => Promise.reject(new AIError("Nebius is down", "provider")))).rejects.toThrow("Nebius is down");
  });
});
