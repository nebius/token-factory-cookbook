import type { BuiltPart, WorkerMessage, WorkerRequest } from "./types";

export type WorkerLike = {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerMessage }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

export const PART_TIMEOUT_MS = 4000;

export function browserWorker(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

/**
 * Build parts in a sandboxed worker, one at a time. A part that runs past the time limit
 * (an endless loop, say) kills the worker; it is marked failed and a fresh worker takes the rest.
 */
export function runParts(
  parts: { id: string; code: string }[],
  sizeMm: [number, number, number],
  onPart: (part: BuiltPart) => void,
  opts: { createWorker?: () => WorkerLike; timeoutMs?: number } = {},
): Promise<BuiltPart[]> {
  const create = opts.createWorker ?? browserWorker;
  const timeoutMs = opts.timeoutMs ?? PART_TIMEOUT_MS;
  const results = new Map<string, BuiltPart>();

  const failed = (id: string, message: string): BuiltPart => ({
    id,
    ok: false,
    meshes: [],
    issues: [{ severity: "error", partId: id, message }],
    triangles: 0,
  });

  return new Promise((resolve) => {
    const finish = () => resolve(parts.map((p) => results.get(p.id) ?? failed(p.id, "not built")));

    const launch = (queue: { id: string; code: string }[]) => {
      if (queue.length === 0) return finish();
      const worker = create();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let current: string | null = null;

      const stop = () => {
        if (timer) clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      };
      const remaining = () => queue.filter((p) => !results.has(p.id));

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "start") {
          current = msg.id;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            stop();
            const r = failed(msg.id, `builder ran longer than ${timeoutMs / 1000}s (endless loop?)`);
            results.set(msg.id, r);
            onPart(r);
            launch(remaining());
          }, timeoutMs);
        } else if (msg.type === "part") {
          if (timer) clearTimeout(timer);
          current = null;
          results.set(msg.part.id, msg.part);
          onPart(msg.part);
        } else if (msg.type === "done") {
          stop();
          finish();
        }
      };
      worker.onerror = (err) => {
        stop();
        const id = current ?? remaining()[0]?.id;
        if (id && !results.has(id)) {
          const r = failed(id, `sandbox crashed: ${typeof ErrorEvent !== "undefined" && err instanceof ErrorEvent ? err.message : "worker error"}`);
          results.set(id, r);
          onPart(r);
        }
        launch(remaining());
      };
      worker.postMessage({ type: "build", parts: queue, sizeMm });
    };

    launch(parts);
  });
}
