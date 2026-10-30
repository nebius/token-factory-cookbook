import { useEffect, useRef, useState } from "react";
import { eventsUrl } from "./api";
import type { RunEvent } from "./types";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "closed";

/**
 * Live run events over SSE. The browser's EventSource reconnects on its own and sends
 * Last-Event-ID, and the server replays everything after it, so nothing is lost or duplicated.
 */
export function useRunEvents(runId: string | undefined) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    seen.current = new Set();
    setStatus("connecting");
    const source = new EventSource(eventsUrl(runId));
    source.addEventListener("open", () => setStatus("live"));
    source.addEventListener("error", () => setStatus(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting"));
    source.addEventListener("run", (msg) => {
      const event = JSON.parse((msg as MessageEvent).data) as RunEvent;
      if (seen.current.has(event.id)) return;
      seen.current.add(event.id);
      setEvents((prev) => [...prev, event]);
    });
    return () => { source.close(); setStatus("closed"); };
  }, [runId]);

  return { events, status };
}
