"use client";

import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { notificationsOn, notificationsSupported, setNotifications } from "@/lib/client/notify";
import { setThemePreference, themePreference, type ThemePreference } from "@/lib/client/theme";
import { useApp } from "./OpenDuetApp";
import { Drawer, Segmented, Toggle } from "./ui";

function AppearancePicker() {
  const [theme, setTheme] = useState<ThemePreference>("system");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read after mount
    setTheme(themePreference());
  }, []);
  const change = (next: ThemePreference) => {
    setTheme(next);
    setThemePreference(next);
  };
  return (
    <Segmented
      value={theme}
      onChange={change}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ]}
    />
  );
}

function NotificationsToggle() {
  const { toast } = useApp();
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read after mount
    setOn(notificationsOn());
    setSupported(notificationsSupported());
  }, []);

  const change = async (next: boolean) => {
    const result = await setNotifications(next);
    setOn(result);
    if (next && !result) toast("Notifications are blocked for this site. Allow them in your browser's site settings.");
  };

  return (
    <div className="rounded-2xl bg-raised px-4">
      <Toggle
        label="Desktop notifications"
        hint={
          supported
            ? "When a bot posts a brief, finds something on a check-in, or waits for your OK while you're in another tab."
            : "This browser doesn't support notifications."
        }
        checked={on}
        disabled={!supported}
        onChange={change}
      />
    </div>
  );
}

function KeyRow({ name, envVar, ok, what, href }: { name: string; envVar: string; ok: boolean; what: string; href: string }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14.5px] font-medium">{name}</span>
        <span className={clsx("flex items-center gap-1.5 text-[12.5px]", ok ? "text-ok" : "text-faint")}>
          <span className={clsx("h-2 w-2 rounded-full", ok ? "bg-ok" : "bg-line-strong")} />
          {ok ? "Connected" : "Not set"}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-mute">{what}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <code className="rounded-md bg-raised-2 px-1.5 py-0.5 font-mono text-[12px] text-mute">{envVar}</code>
        <a className="inline-flex items-center gap-0.5 text-[12.5px] text-mute hover:text-ink" href={href} target="_blank" rel="noopener noreferrer">
          Get a key <ArrowUpRight size={13} />
        </a>
      </div>
    </li>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const status = state.status;
  return (
    <Drawer title="Settings" onClose={onClose}>
      <section>
        <h3 className="text-[12.5px] font-medium text-mute">API keys</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-mute">
          Keys live on the server in <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">.env</code>, never in the browser. Add them,
          then restart <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">pnpm dev</code>.
        </p>
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-raised">
          <KeyRow
            name="Nebius Token Factory"
            envVar="NEBIUS_API_KEY"
            ok={Boolean(status?.keys.nebius)}
            what="The open-source models every bot runs on. Without it, bots use a scripted mock model."
            href="https://tokenfactory.nebius.com"
          />
          <KeyRow name="Tavily" envVar="TAVILY_API_KEY" ok={Boolean(status?.keys.tavily)} what="Web search, page reading and site crawls." href="https://app.tavily.com" />
          <KeyRow
            name="Browserbase"
            envVar="BROWSERBASE_API_KEY"
            ok={Boolean(status?.keys.browserbase)}
            what="Cloud browsers for bots with the Browser tool. Watch them live and take over."
            href="https://www.browserbase.com"
          />
          <KeyRow
            name="Composio"
            envVar="COMPOSIO_API_KEY"
            ok={Boolean(status?.keys.composio)}
            what="Connected apps: Slack, GitHub, Gmail, Notion and 1,000+ more, with sign-in handled by Composio."
            href="https://platform.composio.dev"
          />
          <KeyRow
            name="Jev (TypeSafe)"
            envVar="TYPESAFE_API_KEY"
            ok={Boolean(status?.keys.jev)}
            what="Picks who answers in Auto rooms. Without it, the room's lead answers."
            href="https://typesafe.ai"
          />
        </ul>
      </section>
      <section className="mt-7">
        <h3 className="mb-3 text-[12.5px] font-medium text-mute">Appearance</h3>
        <AppearancePicker />
      </section>
      <section className="mt-7">
        <h3 className="mb-3 text-[12.5px] font-medium text-mute">Notifications</h3>
        <NotificationsToggle />
      </section>
      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Data</h3>
        <p className="mt-1 text-[13px] text-mute">
          Bots, chats and each bot&apos;s <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">MEMORY.md</code> are stored locally in:
        </p>
        <p className="mt-2 rounded-2xl bg-raised px-4 py-3 font-mono text-[12px] break-all text-mute">{status?.dataDir}</p>
      </section>
    </Drawer>
  );
}
