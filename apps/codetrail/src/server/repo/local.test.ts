import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(join(tmpdir(), "codetrail-local-"));
let local: typeof import("./local");

beforeAll(async () => {
  mkdirSync(join(root, "app/src"), { recursive: true });
  mkdirSync(join(root, "app/node_modules/x"), { recursive: true });
  writeFileSync(join(root, "app/README.md"), "# App\n\nA tiny app for tests.\n");
  writeFileSync(join(root, "app/src/index.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "app/node_modules/x/index.js"), "module.exports = 1;\n");
  writeFileSync(join(root, "app/pnpm-lock.yaml"), "lockfileVersion: 9\n");
  mkdirSync(join(root, ".hidden"));
  process.env.LOCAL_ROOT = root;
  process.env.AUTH_MODE = "none";
  local = await import("./local");
});

describe("local folders", () => {
  it("lists folders directly inside LOCAL_ROOT, hidden ones left out", async () => {
    expect((await local.listLocal()).map((f) => f.name)).toEqual(["app"]);
  });
  it("refuses anything outside LOCAL_ROOT", async () => {
    for (const bad of ["..", "../etc", "app/src", ".hidden", "nope"]) await expect(local.localInfo(bad)).rejects.toThrow();
  });
  it("reads like a tarball: dependencies and lockfiles left out, README as the description", async () => {
    const info = await local.localInfo("app");
    expect(info).toMatchObject({ owner: "_local", repo: "app", description: "A tiny app for tests.", htmlUrl: "", private: true });
    expect(info.sha).toMatch(/^[0-9a-f]{40}$/);
    const snap = await local.readLocal("app");
    expect(snap.files.map((f) => f.path).sort()).toEqual(["README.md", "src/index.ts"]);
    expect(snap.skipped).toContainEqual({ path: "pnpm-lock.yaml", reason: "lockfile" });
  });
  it("gets a new fingerprint when a file changes", async () => {
    const before = (await local.localInfo("app")).sha;
    writeFileSync(join(root, "app/src/index.ts"), "export const a = 2; // edited\n");
    utimesSync(join(root, "app/src/index.ts"), new Date(), new Date(Date.now() + 5_000));
    expect((await local.localInfo("app")).sha).not.toBe(before);
  });
});
