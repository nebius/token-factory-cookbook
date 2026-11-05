/// <reference lib="webworker" />
import { buildFromModule, SourceError } from './module';
import { lockDownFunctionConstructors } from './sandbox';

// Before any generated code runs in this worker: no route from a value to the Function constructor,
// and no network or messaging of its own if a generator ever gets past the source check.
lockDownFunctionConstructors();
const post = self.postMessage.bind(self) as (message: WorkerResult) => void;
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'indexedDB', 'caches', 'postMessage'];
for (let target: object | null = self; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
  for (const name of NETWORK_GLOBALS) if (Object.prototype.hasOwnProperty.call(target, name)) Reflect.deleteProperty(target, name);
}

export type WorkerResult = { id: number } & (
  { ok: true; result: ReturnType<typeof buildFromModule>; elapsed: number } |
  { ok: false; error: string; elapsed: number }
);

self.onmessage = (event: MessageEvent<{ id: number; source: string; values?: Record<string, number> }>) => {
  const start = performance.now();
  try {
    const result = buildFromModule(event.data.source, event.data.values);
    post({ id: event.data.id, ok: true, result, elapsed: performance.now() - start } satisfies WorkerResult);
  } catch (error) {
    const prefix = error instanceof SourceError ? error.message : 'The generated plan did not match the PlanSpec schema.';
    post({ id: event.data.id, ok: false, error: `${prefix} ${(error as Error).message}`, elapsed: performance.now() - start } satisfies WorkerResult);
  }
};
