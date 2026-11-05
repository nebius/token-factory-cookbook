// Stop: a request names its run, and "Stop" cancels that run. The model call behind it is aborted only when nobody
// else is waiting on it (see `shared` in trail/service.ts). A closed tab is not a Stop: the call finishes and is
// stored, as before. The signals travel in AsyncLocalStorage, so no function in between needs a new parameter.
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

/** Thrown to a caller that pressed Stop. */
export class CancelledError extends Error {
  constructor() {
    super("Stopped.");
    this.name = "CancelledError";
  }
}

type Signals = { caller?: AbortSignal; call?: AbortSignal };
const als = new AsyncLocalStorage<Signals>();
const runs = new Map<string, AbortController>();

/** The run id a request may carry: the client's random id for this one action. */
export const runIdOf = (body: unknown) => z.object({ runId: z.string().regex(/^[\w-]{8,64}$/).optional() }).catch({}).parse(body).runId;

/** Runs a request's work as `runId`, so a later `cancelRun(runId)` stops waiting for it. */
export function asRun<T>(runId: string | undefined, work: () => Promise<T>): Promise<T> {
  if (!runId) return work();
  const stop = new AbortController();
  runs.set(runId, stop);
  return als.run({ ...als.getStore(), caller: stop.signal }, work).finally(() => runs.delete(runId));
}

/** Stop pressed. False when the run already finished (or never existed here). */
export function cancelRun(runId: string): boolean {
  const stop = runs.get(runId);
  stop?.abort();
  return !!stop;
}

/** The current request's Stop signal, if it named a run. */
export const callerSignal = () => als.getStore()?.caller;

/** The signal the model call itself listens to: aborted when its last waiting caller stopped. */
export const callSignal = () => als.getStore()?.call;

export const withCallSignal = <T>(signal: AbortSignal, work: () => Promise<T>) => als.run({ ...als.getStore(), call: signal }, work);
