import { beforeEach, describe, expect, it } from "vitest";
import { openDb, useDb } from "@/lib/db/index";
import { importSeed } from "@/lib/db/seed";
import {
  createTeardown, findReadyByNameKey, getBySlug, getDiagrams, getParts, listLibrary, nextVersion, setPartResults, updateTeardown, upsertParts,
} from "@/lib/db/teardowns";
import { addProgress, getNotes, getProgress, setBookmark, setNote } from "@/lib/db/user";
import { listRuns, logRun } from "@/lib/db/runs";
import { fromResponses } from "@/lib/kimi/replay";
import { nameKey } from "@/lib/slug";
import { readFixture } from "./fixture";

function seedDeskFan() {
  const { meta, parts, diagrams } = fromResponses(readFixture("desk-fan.design.txt"), readFixture("desk-fan.diagrams.txt"));
  const d = openDb(":memory:");
  useDb(d);
  importSeed(d, { slug: "oscillating-desk-fan", provider: "fixture", model: "hand-made", input: { kind: "text", text: "desk fan" }, meta, parts, diagrams });
  return { meta, parts, diagrams };
}

describe("database", () => {
  beforeEach(() => useDb(openDb(":memory:")));

  it("applies migrations to an empty database", () => {
    const d = openDb(":memory:");
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
    expect(tables).toEqual(expect.arrayContaining(["teardowns", "parts", "diagrams", "runs", "notes", "progress", "bookmarks", "identify_cache"]));
  });

  it("round-trips a seeded teardown", () => {
    const { meta, parts, diagrams } = seedDeskFan();
    const t = getBySlug("oscillating-desk-fan")!;
    expect(t.status).toBe("ready");
    expect(t.meta).toEqual(meta);
    expect(getParts(t.id).map((p) => p.code)).toEqual(parts.map((p) => p.code));
    expect(getDiagrams(t.id).map((d) => d.kind).sort()).toEqual(diagrams.map((d) => d.kind).sort());
    expect(findReadyByNameKey(nameKey("Desk fan, oscillating"))?.id).toBe(t.id);
  });

  it("lists the newest ready version once, with progress", () => {
    seedDeskFan();
    const v2 = createTeardown({ slug: "oscillating-desk-fan", version: nextVersion("oscillating-desk-fan"), inputKind: "text", inputHash: "x" });
    expect(listLibrary()).toHaveLength(1);
    expect(listLibrary()[0].version).toBe(1);
    updateTeardown(v2, { status: "ready", name: "Oscillating desk fan", category: "home-appliances" });
    expect(listLibrary()).toHaveLength(1);
    expect(listLibrary()[0].version).toBe(2);
    addProgress("oscillating-desk-fan", { partsOpened: ["rotor", "shaft"], stepsDone: [0], quiz: { "0": 1 } });
    expect(listLibrary()[0]).toMatchObject({ parts_opened: 2, steps_done: 1, quiz_answered: 1 });
    expect(listLibrary({ q: "oscillating" })).toHaveLength(1);
    expect(listLibrary({ category: "aerospace" })).toHaveLength(0);
  });

  it("revises a replaced builder and records results", () => {
    const id = createTeardown({ slug: "draft-1", inputKind: "text", inputHash: "h" });
    upsertParts(id, [{ id: "a", code: "1" }]);
    setPartResults(id, [{ id: "a", ok: false, error: "boom" }]);
    upsertParts(id, [{ id: "a", code: "2" }]);
    expect(getParts(id)[0]).toMatchObject({ code: "2", revision: 1, ok: null, error: null });
  });

  it("stores study data per slug", () => {
    setBookmark("fan", true);
    setNote("fan", "rotor", "induction!");
    setNote("fan", "", "overall note");
    expect(getNotes("fan")).toEqual({ rotor: "induction!", "": "overall note" });
    setNote("fan", "rotor", "  ");
    expect(getNotes("fan")).toEqual({ "": "overall note" });
    addProgress("fan", { partsOpened: ["a"], stepsDone: [2] });
    addProgress("fan", { partsOpened: ["a", "b"], stepsDone: [0] });
    expect(getProgress("fan")).toEqual({ partsOpened: ["a", "b"], stepsDone: [0, 2], quiz: {} });
  });

  it("logs runs", () => {
    logRun({ teardownId: null, kind: "design", provider: "nebius", model: "m", status: "ok", tokensIn: 10, tokensOut: 20, latencyMs: 5 });
    expect(listRuns()[0]).toMatchObject({ kind: "design", tokens_in: 10, tokens_out: 20 });
  });
});
