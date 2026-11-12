// In-process fan-out of server events to every open SSE connection.
import type { ServerEvent } from "@/lib/shared/types";

type Listener = (event: ServerEvent) => void;

const g = globalThis as unknown as { __openduetBus?: Set<Listener> };
const listeners = (g.__openduetBus ??= new Set());

export function publish(event: ServerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken connection must not stop delivery to the others.
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
