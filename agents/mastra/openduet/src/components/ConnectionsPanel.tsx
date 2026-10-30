"use client";

import clsx from "clsx";
import { ArrowUpRight, Check, Plug, Search, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useConnections } from "@/lib/client/use-connections";
import type { ComposioApp } from "@/lib/shared/types";
import { useApp } from "./OpenDuetApp";
import { Button, Drawer, Field, inputClass } from "./ui";

function AppLogo({ app, size = 28 }: { app: { name: string; logo?: string }; size?: number }) {
  return app.logo ? (
    // Logos come from Composio's CDN.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={app.logo} alt="" width={size} height={size} className="shrink-0 rounded-lg bg-white/90 object-contain p-1" />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-lg bg-raised-2 text-[12px] font-semibold" style={{ width: size, height: size }}>
      {app.name.slice(0, 1)}
    </span>
  );
}

function AppRow({ app, onChanged }: { app: ComposioApp; onChanged: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { redirectUrl } = await api.connectApp(app.slug);
      // Sign-in happens on Composio's page; it sends you back here when done.
      window.location.href = redirectUrl;
    } catch (error) {
      toast(error instanceof Error ? error.message : `Couldn't start connecting ${app.name}.`);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${app.name}? Bots lose access to it until you connect it again.`)) return;
    setBusy(true);
    try {
      await api.disconnectApp(app.slug);
      toast(`${app.name} disconnected.`);
      onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : `Couldn't disconnect ${app.name}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <AppLogo app={app} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{app.name}</span>
        {app.connected && (
          <span className="flex items-center gap-1 text-[12px] text-ok">
            <Check size={12} /> Connected
          </span>
        )}
      </span>
      {app.connected ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={disconnect}>
          Disconnect
        </Button>
      ) : (
        <Button size="sm" variant="secondary" disabled={busy} onClick={connect}>
          {busy ? "Opening…" : "Connect"}
        </Button>
      )}
    </li>
  );
}

const GITHUB_PRESET = { name: "GitHub", url: "https://api.githubcopilot.com/mcp/" };

function AddServerForm({ onAdded }: { onAdded: () => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ name: "", url: "", token: "", headerName: "", headerValue: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const headers = form.headerName.trim() ? { [form.headerName.trim()]: form.headerValue } : undefined;
      const { server } = await api.addMcpServer({ name: form.name, url: form.url, token: form.token || undefined, headers });
      // Check it straight away so a typo in the URL or token shows up now, not mid-chat.
      try {
        const { tools } = await api.testMcpServer(server.id);
        toast(`${server.name} added: ${tools} tools. Switch it on for a bot in its Details.`);
      } catch (error) {
        toast(`${server.name} added, but the test failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      setForm({ name: "", url: "", token: "", headerName: "", headerValue: "" });
      onAdded();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl bg-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium">Add an MCP server</span>
        <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, ...GITHUB_PRESET }))}>
          Use GitHub preset
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="GitHub" />
        </Field>
        <Field label="Server URL">
          <input className={inputClass} value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…/mcp" />
        </Field>
      </div>
      <Field
        label="Token"
        hint={form.url.includes("githubcopilot") ? "A GitHub personal access token with the scopes you want bots to have." : "Sent as Authorization: Bearer <token>. Stored on the server only."}
      >
        <input className={inputClass} type="password" value={form.token} onChange={(e) => set("token", e.target.value)} placeholder="Optional" autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Extra header (optional)">
          <input className={inputClass} value={form.headerName} onChange={(e) => set("headerName", e.target.value)} placeholder="Header name" />
        </Field>
        <Field label="Value">
          <input className={inputClass} type="password" value={form.headerValue} onChange={(e) => set("headerValue", e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" disabled={saving || !form.name.trim() || !form.url.trim()} onClick={save}>
          {saving ? "Adding…" : "Add and test"}
        </Button>
      </div>
    </div>
  );
}

export function ConnectionsPanel({ onClose }: { onClose: () => void }) {
  const { state, toast } = useApp();
  const { data, error, reload, loading } = useConnections(state.connectionsVersion);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComposioApp[] | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // Search Composio's whole catalog, debounced.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = window.setTimeout(() => {
      api
        .searchApps(q)
        .then(({ apps }) => setResults(apps))
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const test = async (id: string, name: string) => {
    setTesting(id);
    try {
      const { tools } = await api.testMcpServer(id);
      toast(`${name} is reachable: ${tools} tools.`);
    } catch (e) {
      toast(`${name}: ${e instanceof Error ? e.message : "couldn't connect"}`);
    } finally {
      setTesting(null);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name}? Bots that use it lose access.`)) return;
    try {
      await api.removeMcpServer(id);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove it.");
    }
  };

  const apps = query.trim() ? (results ?? []) : (data?.composio.apps ?? []);

  return (
    <Drawer title="Connections" onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-mute">
        Connect apps once, then choose which bots can use each one in the bot&apos;s Details. Actions that change something ask you first, unless the bot has full
        access.
      </p>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-medium text-mute">
            <Plug size={13} /> Apps via Composio
          </h3>
          <a href="https://composio.dev" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[12px] text-faint hover:text-ink">
            composio.dev <ArrowUpRight size={12} />
          </a>
        </div>

        {loading && <p className="rounded-2xl bg-raised px-4 py-6 text-center text-[13px] text-mute">Loading…</p>}
        {error && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}

        {data && !data.composio.enabled && (
          <div className="rounded-2xl bg-raised px-4 py-4">
            <p className="text-[14px] font-medium">Connect Slack, GitHub, Gmail and 1,000+ apps</p>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">
              Add <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">COMPOSIO_API_KEY</code> to <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">.env</code> and
              restart. Composio handles each app&apos;s sign-in, so you never paste app passwords here.
            </p>
          </div>
        )}

        {data?.composio.enabled && (
          <>
            {data.composio.error && <p className="mb-2 rounded-2xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{data.composio.error}</p>}
            <label className="mb-2 flex h-10 items-center gap-2 rounded-full bg-raised px-3.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent">
              <Search size={15} className="text-faint" aria-hidden />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value.trim()) setResults(null);
                }}
                placeholder="Search all apps"
                aria-label="Search apps"
                className="min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
              />
            </label>
            <ul className={clsx("divide-y divide-line rounded-2xl bg-raised", apps.length === 0 && "hidden")}>
              {apps.map((app) => (
                <AppRow key={app.slug} app={app} onChanged={reload} />
              ))}
            </ul>
            {query.trim() && results && results.length === 0 && <p className="px-1 py-3 text-[13px] text-mute">No apps match.</p>}
          </>
        )}
      </section>

      <section className="mt-7">
        <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-mute">
          <Server size={13} /> Your MCP servers
        </h3>
        {data && data.mcpServers.length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-2xl bg-raised">
            {data.mcpServers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{s.name}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {s.url}
                    {s.hasToken ? " · token set" : ""}
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={testing === s.id} onClick={() => test(s.id, s.name)}>
                  {testing === s.id ? "Testing…" : "Test"}
                </Button>
                <button aria-label={`Remove ${s.name}`} onClick={() => remove(s.id, s.name)} className="rounded-full p-2 text-faint hover:bg-raised-2 hover:text-danger">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddServerForm onAdded={reload} />
      </section>
    </Drawer>
  );
}
