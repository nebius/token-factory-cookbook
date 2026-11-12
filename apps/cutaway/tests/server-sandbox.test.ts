import { describe, expect, it } from "vitest";
import { buildOnServer } from "@/lib/sandbox/server";
import { deskFan } from "./fixture";

const SIZE: [number, number, number] = [340, 480, 300];
const ok = "return kit.mesh(kit.box(10,10,10));";

describe("server sandbox (child process)", () => {
  it("builds every desk fan part", async () => {
    const { parts } = deskFan();
    const res = await buildOnServer(parts, SIZE);
    expect(res.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
    expect(res.every((r) => r.meshes.length > 0 && r.meshes[0].position instanceof Float32Array)).toBe(true);
  }, 60_000);

  it("kills an endless loop and keeps going", async () => {
    const res = await buildOnServer([{ id: "a", code: ok }, { id: "spin", code: "while (true) {}" }, { id: "c", code: ok }], SIZE);
    expect(res.map((r) => [r.id, r.ok])).toEqual([["a", true], ["spin", false], ["c", true]]);
    expect(res[1].issues[0].message).toMatch(/longer than/);
  }, 60_000);

  it("blocks imports, file writes and process tricks, even after escaping the function scope", async () => {
    const escape = "const P = (function(){}).constructor('return process')();";
    const res = await buildOnServer(
      [
        { id: "imp", code: "import('node:fs'); return kit.mesh(kit.box(1,1,1));" },
        { id: "fs", code: `${escape} P.getBuiltinModule('fs').writeFileSync('/tmp/cutaway-escape', 'x'); ${ok}` },
        { id: "kill", code: `${escape} P.kill(P.ppid); ${ok}` },
        { id: "net", code: `${escape} P.getBuiltinModule('child_process').execSync('echo hi'); ${ok}` },
      ],
      SIZE,
    );
    expect(res.find((r) => r.id === "fs")!.ok).toBe(false);
    expect(res.find((r) => r.id === "kill")!.ok).toBe(false);
    expect(res.find((r) => r.id === "net")!.ok).toBe(false);
    // A dynamic import is async, so the part itself builds; the import is rejected by the hook.
    expect(res.find((r) => r.id === "imp")!.ok).toBe(true);
  }, 60_000);
});
