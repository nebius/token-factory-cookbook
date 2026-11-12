import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { runParts, type WorkerLike } from "./run";
import type { BuiltMesh, BuiltPart, WorkerMessage } from "./types";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "lib", "sandbox");
const OUT_DIR = path.join(ROOT, ".sandbox");
const OUT = path.join(OUT_DIR, "runner.mjs");

let building: Promise<string> | null = null;

/** Bundle the sandbox runner (three.js + kit + checks) into one file, rebuilding when its sources change. */
export function ensureRunner(): Promise<string> {
  if (building) return building;
  building = (async () => {
    const newest = Math.max(...["node-runner.ts", "evaluate.ts", "kit.ts", "types.ts"].map((f) => fs.statSync(path.join(SOURCE, f)).mtimeMs));
    if (fs.existsSync(OUT) && fs.statSync(OUT).mtimeMs >= newest) return OUT;
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [path.join(SOURCE, "node-runner.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: OUT,
      logLevel: "silent",
    });
    return OUT;
  })().finally(() => {
    building = null;
  });
  return building;
}

function decode<T extends Float32Array | Uint32Array>(s: string, Ctor: new (b: ArrayBuffer) => T): T {
  const b = Buffer.from(s, "base64");
  const ab = new ArrayBuffer(b.length);
  new Uint8Array(ab).set(b);
  return new Ctor(ab);
}

type Encoded = Omit<BuiltPart, "meshes"> & { meshes: { material: BuiltMesh["material"]; position: string; normal: string; index: string | null }[] };

/** A sandbox child process that speaks the same messages as the browser Web Worker. */
function childWorker(runner: string): WorkerLike {
  const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${path.dirname(runner)}`, runner], { stdio: ["pipe", "pipe", "pipe"] });
  let ended = false;
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      child.stdin.write(JSON.stringify(msg) + "\n");
    },
    terminate() {
      ended = true;
      child.kill("SIGKILL");
    },
  };
  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg: WorkerMessage | { type: "part"; part: Encoded };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "part") {
      const e = msg.part as unknown as Encoded;
      const part: BuiltPart = {
        ...e,
        meshes: e.meshes.map((m) => ({ material: m.material, position: decode(m.position, Float32Array), normal: decode(m.normal, Float32Array), index: m.index ? decode(m.index, Uint32Array) : null })),
      };
      w.onmessage?.({ data: { type: "part", part } });
    } else w.onmessage?.({ data: msg as WorkerMessage });
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + String(d)).slice(-2000)));
  child.on("exit", (code) => {
    if (!ended) w.onerror?.(new Error(`sandbox exited (${code}) ${stderr.trim()}`));
  });
  return w;
}

/** Build parts on the server in the sandbox child process, with the same per-part time limit as the browser. */
export async function buildOnServer(parts: { id: string; code: string }[], sizeMm: [number, number, number], onPart?: (p: BuiltPart) => void): Promise<BuiltPart[]> {
  if (!parts.length) return [];
  const runner = await ensureRunner();
  return runParts(parts, sizeMm, onPart ?? (() => {}), { createWorker: () => childWorker(runner), timeoutMs: 6000 });
}
