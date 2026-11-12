// Model calls in flight, shared by everyone asking for the same new thing, and stopped when the last of them
// presses Stop (see server/cancel.ts).
import { callerSignal, CancelledError, withCallSignal } from "@/server/cancel";

type Running = { call: Promise<unknown>; waiting: number; stop: AbortController };
const inflight = new Map<string, Running>();

/**
 * Shares a running call: a second tab (or visitor) asking the same new thing waits for it instead of paying again.
 * A caller that presses Stop stops waiting; when no one is left waiting, the model call itself is aborted. Callers
 * that can't press Stop (no run id: MCP, scripts) keep it running to the end.
 */
export function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  let entry = inflight.get(key);
  if (!entry) {
    const stop = new AbortController();
    const call = withCallSignal(stop.signal, run).finally(() => inflight.get(key) === entry && inflight.delete(key));
    call.catch(() => {}); // Everyone may have stopped waiting; the rejection is theirs to handle, not unhandled.
    entry = { call, waiting: 0, stop };
    inflight.set(key, entry);
  }
  const running = entry;
  running.waiting++;
  const caller = callerSignal();
  if (!caller) return running.call as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    const leave = () => {
      running.waiting--;
      if (running.waiting === 0) {
        running.stop.abort();
        // The next person to ask starts a fresh call rather than joining this stopped one.
        if (inflight.get(key) === running) inflight.delete(key);
      }
      reject(new CancelledError());
    };
    if (caller.aborted) return leave();
    caller.addEventListener("abort", leave, { once: true });
    (running.call as Promise<T>).then(resolve, reject).finally(() => caller.removeEventListener("abort", leave));
  });
}
