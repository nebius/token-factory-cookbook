/// <reference lib="webworker" />
import { buildFromModule, SourceError } from './module';

export type WorkerResult = { id: number } & (
  { ok: true; result: ReturnType<typeof buildFromModule>; elapsed: number } |
  { ok: false; error: string; elapsed: number }
);

self.onmessage = (event: MessageEvent<{ id: number; source: string; values?: Record<string, number> }>) => {
  const start = performance.now();
  try {
    const result = buildFromModule(event.data.source, event.data.values);
    self.postMessage({ id: event.data.id, ok: true, result, elapsed: performance.now() - start } satisfies WorkerResult);
  } catch (error) {
    const prefix = error instanceof SourceError ? error.message : 'The generated plan did not match the PlanSpec schema.';
    self.postMessage({ id: event.data.id, ok: false, error: `${prefix} ${(error as Error).message}`, elapsed: performance.now() - start } satisfies WorkerResult);
  }
};
