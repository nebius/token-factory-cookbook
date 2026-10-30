"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ConnectionOption, ConnectionsState } from "@/lib/shared/types";

/** Connected apps and MCP servers, refetched whenever the server says they changed. */
export function useConnections(version: number) {
  const [data, setData] = useState<ConnectionsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .connections()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load connections."));
    return () => {
      cancelled = true;
    };
  }, [version, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** What a bot can be given: connected apps, then MCP servers. */
  const options: ConnectionOption[] = data
    ? [
        ...data.composio.apps.filter((a) => a.connected).map((a) => ({ id: `composio:${a.slug}`, name: a.name, kind: "composio" as const, logo: a.logo })),
        ...data.mcpServers.map((s) => ({ id: `mcp:${s.id}`, name: s.name, kind: "mcp" as const })),
      ]
    : [];

  return { data, error, options, reload, loading: !data && !error };
}
