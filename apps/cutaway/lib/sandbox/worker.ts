import { evaluatePart } from "./evaluate";
import type { BuiltPart, WorkerMessage, WorkerRequest } from "./types";

type Scope = {
  postMessage(msg: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};
const scope = self as unknown as Scope;
const send = scope.postMessage.bind(scope);

// Builders get no network or storage even if they climb out of their parameter shadowing.
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches"]) {
  try {
    Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* some names are not redefinable; the parameter shadowing still covers them */
  }
}

function transferables(part: BuiltPart): Transferable[] {
  const out: Transferable[] = [];
  for (const m of part.meshes) {
    out.push(m.position.buffer, m.normal.buffer);
    if (m.index) out.push(m.index.buffer);
  }
  return out;
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== "build") return;
  for (const p of req.parts) {
    send({ type: "start", id: p.id } satisfies WorkerMessage);
    const part = evaluatePart(p.id, p.code, req.sizeMm);
    send({ type: "part", part } satisfies WorkerMessage, transferables(part));
  }
  send({ type: "done" } satisfies WorkerMessage);
};
