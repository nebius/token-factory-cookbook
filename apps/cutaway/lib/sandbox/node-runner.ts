// Entry point of the server-side sandbox. Bundled to .sandbox/runner.mjs and run as a child process with
// Node's permission model (no file writes, no child processes, no workers, no native addons). On top of
// that, every import is blocked before any builder runs. One JSON message per line on stdin and stdout.
import { registerHooks } from "node:module";
import { createInterface } from "node:readline";
import { evaluatePart } from "./evaluate";
import type { BuiltPart, WorkerRequest } from "./types";

const out = process.stdout.write.bind(process.stdout);
const send = (msg: unknown) => out(JSON.stringify(msg) + "\n");

registerHooks({
  resolve() {
    throw new Error("imports are blocked in the part sandbox");
  },
});
for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
  try {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* not defined here */
  }
}
const deny = () => {
  throw new Error("not allowed in the part sandbox");
};
for (const name of ["kill", "dlopen", "binding", "chdir"] as const) {
  try {
    Object.defineProperty(process, name, { value: deny, configurable: false, writable: false });
  } catch {
    /* ignore */
  }
}

const b64 = (a: Float32Array | Uint32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");

function encode(part: BuiltPart) {
  return {
    ...part,
    meshes: part.meshes.map((m) => ({ material: m.material, position: b64(m.position), normal: b64(m.normal), index: m.index ? b64(m.index) : null })),
  };
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req: WorkerRequest;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.type !== "build") return;
  for (const p of req.parts) {
    send({ type: "start", id: p.id });
    send({ type: "part", part: encode(evaluatePart(p.id, p.code, req.sizeMm)) });
  }
  send({ type: "done" });
});
