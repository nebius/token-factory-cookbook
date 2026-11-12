import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluatePart } from "@/lib/sandbox/evaluate";
import { rasterViews } from "@/lib/render/raster";
import { deskFan } from "./fixture";

describe("software renderer", () => {
  it("renders the four review views and a thumbnail as JPEGs that aren't blank", () => {
    const { meta, parts } = deskFan();
    const built = parts.map((p) => evaluatePart(p.id, p.code, meta.device.sizeMm));
    const t0 = Date.now();
    const shots = rasterViews(meta, built, [{ view: "front" }, { view: "iso" }, { view: "iso", explode: 1 }, { view: "iso", clip: true }]);
    const ms = Date.now() - t0;
    expect(shots).toHaveLength(4);
    for (const s of shots) {
      expect(s.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(s.length).toBeGreaterThan(20_000);
    }
    expect(new Set(shots).size).toBe(4);
    expect(ms).toBeLessThan(15_000);
    if (process.env.RASTER_OUT) shots.forEach((s, i) => fs.writeFileSync(`${process.env.RASTER_OUT}/view-${i}.jpg`, Buffer.from(s.split(",")[1], "base64")));
  }, 30_000);
});
